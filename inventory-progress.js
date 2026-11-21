/* Completion is indexed by the actual recheck day, independently of document date. */
(function(root){
 const quantity=v=>v!==undefined&&v!==null&&String(v).trim()!=='';
 const day=v=>{const m=String(v||'').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';};
 function required(items,room=true){
  const names=[...new Set(items)].filter(Boolean);
  if(!room)return names;
  const start=names.findIndex(n=>n.includes('床單')),end=names.findIndex(n=>n.includes('抹布'));
  return start>=0&&end>=start?names.slice(start,end+1):names;
 }
 function completed(rows,items){
  const records=new Map(rows.map(r=>[r.item,r]));
  if(!items.length)return '';
  let latest='';
  for(const item of items){const r=records.get(item);if(!r?.doubleSignature||!quantity(r.doubleCount))return '';latest=[latest,day(r.doubleSignDate)||day(r.date)].sort().pop();}
  return latest;
 }
 function watch(api,db,date,configs,onChange,onError=console.error){
  let stopped=false,today=[],fallback=new Map();
  const byHotel=new Map(configs.map(c=>[c.hotel,c]));
  const groupKey=r=>JSON.stringify([day(r.date),r.hotel]);
  function paint(){
   if(stopped)return;
   const groups=new Map();
   for(const r of today)if(byHotel.has(r.hotel)&&r.doubleSignature){const key=groupKey(r);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
   const lit=new Set(),needed=new Set();
   for(const [key,rows] of groups){
    const config=byHotel.get(rows[0].hotel),items=required(config.items,config.room);
    if(completed(rows,items)===date){lit.add(config.base);continue;}
    needed.add(key);
    let state=fallback.get(key);
    if(!state){
     state={rows:[],stop:()=>{}};fallback.set(key,state);
     const [documentDate,hotel]=JSON.parse(key);
     state.stop=api.onSnapshot(api.query(api.collection(db,'inventory_records'),api.where('date','==',documentDate),api.where('hotel','==',hotel)),snapshot=>{
      if(stopped||fallback.get(key)!==state)return;state.rows=snapshot.docs.map(d=>d.data());paint();
     },onError);
    }
    if(completed(state.rows,items)===date)lit.add(config.base);
   }
   for(const [key,state] of fallback)if(!needed.has(key)){state.stop();fallback.delete(key);}
   onChange(lit);
  }
  const stop=api.onSnapshot(api.query(api.collection(db,'inventory_records'),api.where('doubleSignDate','>=',date+' 00:00:00'),api.where('doubleSignDate','<=',date+' 23:59:59')),snapshot=>{today=snapshot.docs.map(d=>d.data());paint();},onError);
  return ()=>{stopped=true;stop();for(const state of fallback.values())state.stop();fallback.clear();};
 }
 const api={quantity,day,required,completed,watch};
 root.InventoryProgress=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
