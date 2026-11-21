/* Only explicit quantity entry starts a batch; 床單 through 抹布 records release it. */
(function(root){
 const norm=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
 const hotel=v=>norm(v)==='喜達絲'||norm(v)==='喜達絲房務';
 const quantity=v=>v!==undefined&&v!==null&&String(v).trim()!=='';
 const day=v=>{const m=String(v||'').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';};
 function required(items){const names=[...new Set(items)],a=names.findIndex(n=>n.includes('床單')),b=names.findIndex(n=>n.includes('抹布'));return a>=0&&b>=a?names.slice(a,b+1):names;}
 function covered(rows,items){return items.length>0&&items.every(item=>rows.some(r=>r.item===item&&(quantity(r.count)||quantity(r.doubleCount))));}
 function date(active,rows,items){return [...new Set(active.filter(r=>hotel(r.hotel)&&r.inventoryDateLockActive&&r.inventoryDateLockEnteredAt&&(quantity(r.count)||quantity(r.doubleCount))).map(r=>day(r.date)))].sort().find(d=>!covered(rows.filter(r=>day(r.date)===d),required(items)))||'';}
 function watch(api,db,template,onChange,onError=console.error){
  let stopped=false,entries=[],scopes=new Map(),resolveReady,rejectReady,readyDone=false;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const fail=e=>{if(stopped)return;if(!readyDone)rejectReady(e);onError(e);};
  function update(){
   if(stopped)return;
   const needed=new Set(),pending=[];
   for(const entry of entries){const r=entry.data;if(!hotel(r.hotel))continue;const key=JSON.stringify([day(r.date),r.hotel]);needed.add(key);let state=scopes.get(key);
    if(!state){state={rows:[],loaded:false,clearing:false,stop:()=>{}};scopes.set(key,state);const [d,h]=JSON.parse(key);
     state.stop=api.onSnapshot(api.query(api.collection(db,'inventory_records'),api.where('date','==',d),api.where('hotel','==',h)),{includeMetadataChanges:true},snapshot=>{
      if(stopped||scopes.get(key)!==state||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)return;
      state.rows=snapshot.docs.map(x=>x.data());state.loaded=true;update();
     },fail);
    }
    if(!state.loaded){pending.push(r);continue;}
    const names=required(template.filter(t=>t.hotel===r.hotel).map(t=>t.item));
    if(covered(state.rows,names)){
     if(!state.clearing){state.clearing=true;const batch=api.writeBatch(db);for(const doc of entries.filter(x=>day(x.data.date)===day(r.date)&&x.data.hotel===r.hotel))batch.set(doc.ref,{inventoryDateLockActive:false},{merge:true});batch.commit().catch(e=>{state.clearing=false;fail(e);});}
    }else pending.push(r);
   }
   for(const [key,state]of scopes)if(!needed.has(key)){state.stop();scopes.delete(key);}
   if([...scopes.values()].some(s=>!s.loaded))return;
   onChange(pending.map(r=>day(r.date)).sort()[0]||'');
   if(!readyDone){readyDone=true;resolveReady();}
  }
  const stop=api.onSnapshot(api.query(api.collection(db,'inventory_records'),api.where('inventoryDateLockActive','==',true)),{includeMetadataChanges:true},snapshot=>{
   if(stopped||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)return;
   entries=snapshot.docs.map(d=>({ref:d.ref,data:d.data()}));update();
  },fail);
  return {ready,stop(){stopped=true;stop();for(const s of scopes.values())s.stop();scopes.clear();}};
 }
 const api={hotel,day,quantity,required,covered,date,watch};if(typeof module==='object'&&module.exports)module.exports=api;else root.InventoryDateLock=api;
})(typeof window==='object'?window:globalThis);
