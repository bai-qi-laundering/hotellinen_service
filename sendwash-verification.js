/* Sendwash supplies quantities to the existing per-item signature/calculator flow. */
(function(){
 const core=window.SendwashCore,records=new Map();let db,api,unsubscribe,ready=false,sequence=0,settings=[],activeOutlet=new Map();
 window.setSendwashSettings=rows=>{settings=Array.isArray(rows)?rows:[];};
 const itemKey=(record,item)=>core.outletItem(record.outlet || '',item);
 const sourceItem=(record,key)=>record.outlet ? record.items.find(i=>itemKey(record,i.item)===key)?.item : key;
 window.startSendwashVerification=async database=>{db=database;api=await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');ready=true;};
 const pending=(date,hotel,item)=>[...records.values()].filter(r=>r.targetDate===date&&r.inventoryHotel===hotel&&!r.acceptedAt&&r.items.some(x=>itemKey(r,x.item)===item&&!r.receivedItems?.[x.item]));
 window.sendwashOutletDisplay=item=>{
  const row=[...records.values()].find(r=>r.outlet&&r.items.some(x=>itemKey(r,x.item)===item));
  return row ? sourceItem(row,item) : item;
 };
 window.filterSendwashOutlets=(date,hotel,items)=>{
  const names=[...new Set([...settings.filter(r=>r.inventoryHotel===hotel&&r.outlet).map(r=>r.outlet),...[...records.values()].filter(r=>r.targetDate===date&&r.inventoryHotel===hotel&&r.outlet).map(r=>r.outlet)])];
  const nav=document.getElementById('outletTabs');if(!nav)return items;
  nav.classList.toggle('hidden',!names.length);if(!names.length){nav.replaceChildren();return items;}
  const choices=[...names,''];let selected=activeOutlet.get(hotel);if(!choices.includes(selected))selected=names[0];activeOutlet.set(hotel,selected);
  const key=JSON.stringify([date,hotel,names,selected]);if(nav.dataset?.key!==key){const scroll=nav.scrollLeft;nav.replaceChildren();choices.forEach(outlet=>{const button=document.createElement('button');button.type='button';button.textContent=outlet||'原登記';button.className='flex-none whitespace-nowrap px-5 py-3 rounded-xl font-bold text-lg '+(outlet===selected?'bg-blue-600 text-white':'bg-blue-50 text-blue-800');button.setAttribute('aria-pressed',String(outlet===selected));button.onclick=()=>{activeOutlet.set(hotel,outlet);renderItems(true);};nav.append(button);});nav.scrollLeft=scroll;if(nav.dataset)nav.dataset.key=key;}
  return items.filter(item=>selected ? item.startsWith(`【${selected}】`) : !names.some(name=>item.startsWith(`【${name}】`)));
 };
 window.attachSendwashListener=async dates=>{
  const request=++sequence;if(!ready){await window.sendwashVerificationReady;if(!ready)return;}if(request!==sequence)return;
  if(unsubscribe)unsubscribe();records.clear();
  unsubscribe=api.onSnapshot(api.query(api.collection(db,'sendwash_records'),api.where('targetDate','in',dates)),snap=>{records.clear();snap.forEach(d=>records.set(d.id,{...d.data(),id:d.id}));renderItems(true);},error=>showMessage('送洗對點單無法載入：'+error.message));
 };
 window.sendwashPendingItems=(date,hotel)=>[...new Set([...records.values()].filter(r=>r.targetDate===date&&r.inventoryHotel===hotel&&!r.acceptedAt).flatMap(r=>r.items.filter(i=>!r.receivedItems?.[i.item]).map(i=>itemKey(r,i.item))))];
 window.sendwashCard=()=>null; // All items render through index.html's original two-column card.
 window.prepareSendwashInputs=(date,hotel)=>{
  if(!userInputs[date])userInputs[date]={};if(!userInputs[date][hotel])userInputs[date][hotel]={};
  for(const item of window.sendwashPendingItems(date,hotel)){
   const old=userInputs[date][hotel][item] || {};
   if(old.isSaving || old.hasSigned || old.doubleHasSigned || (!old.sendwashPending && (old.signature || old.doubleSignature)))continue;
   const sources=pending(date,hotel,item).filter(r=>!old.sendwashSources?.[r.id]);if(!sources.length)continue;
   const loadedCount=old.sendwashPending ? old.sendwashLoadedCount : (old.count ?? '');
   const loadedDoubleCount=old.sendwashPending ? old.sendwashLoadedDoubleCount : (old.doubleCount ?? '');
   userInputs[date][hotel][item]={...old,countSource:'sendwash',count:String(Number(loadedCount || 0)+sources.reduce((n,r)=>n+Number(r.items.find(x=>itemKey(r,x.item)===item).quantity),0)),doubleCount:loadedDoubleCount,sendwashLoadedCount:loadedCount,sendwashLoadedDoubleCount:loadedDoubleCount,sendwashPending:sources.map(r=>({id:r.id,quantity:core.quantity(r.items.find(x=>itemKey(r,x.item)===item).quantity)})),note:old.note ?? sources.find(r=>r.notes?.[sourceItem(r,item)] !== undefined)?.notes[sourceItem(r,item)] ?? ''};
  }
 };
 window.savePendingSendwashNote=async(date,hotel,item,value)=>{
  const sources=pending(date,hotel,item);if(!sources.length)return;
  try{await api.runTransaction(db,async tx=>{
   const refs=sources.map(r=>api.doc(db,'sendwash_records',r.id)),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));
   refs.forEach((ref,i)=>{if(!snaps[i].exists())throw new Error('來源單已不存在');const latest=snaps[i].data(),key=sourceItem(latest,item);if(latest.acceptedAt || latest.receivedItems?.[key])throw new Error('此品項已點收，請重新載入後編輯備註');tx.update(ref,{notes:{...(latest.notes || {}),[key]:value}});});
  });showToast('✅ 備註已儲存');}catch(error){showMessage(error.message);}
 };
 window.persistPendingSendwash=async(date,hotel,item,payload,expectedSources,expectedCount,expectedDoubleCount)=>{
  if(!ready)throw new Error('連線中，請稍後重試');
  const count=core.quantity(payload.count);
  const recordRef=api.doc(db,'inventory_records',core.inventoryId(date,hotel,item));
  return api.runTransaction(db,async tx=>{
   const inv=await tx.get(recordRef),old=inv.exists()?inv.data():{};
   if(inv.exists()&&(old.date!==date||old.hotel!==hotel||old.item!==item))throw new Error('品項來源不一致，請重新載入');
   // A successful receipt can leave a stale pending flag in local storage.
   // Read the saved signatures before deciding this is a first receipt.
   const received=expectedSources.length>0&&expectedSources.every(r=>old.sendwashSources?.[r.id]);
   if(received){
    const unchanged=String(old.count)===count&&String(old.doubleCount ?? '')===String(payload.doubleCount ?? '')&&(!payload.signature||old.signature===payload.signature)&&(!payload.doubleSignature||old.doubleSignature===payload.doubleSignature)&&String(old.note ?? '')===String(payload.note ?? '');
    if(unchanged&&old.countSource==='sendwash'&&old.signature&&(!payload.doubleCount||old.doubleSignature))return old;
    const updated=core.sendwashInventoryPatch(old,payload,String(old.count)===count?old.count:expectedCount,expectedDoubleCount);
    const value={...updated,timestamp:new Date().toISOString()};tx.set(recordRef,value,{merge:true});return {...old,...value};
   }
   if(!payload.signature || payload.signature==='CACHED')throw new Error('簽名尚未成功儲存，請點開簽名重新簽署後儲存');
   if(payload.doubleSignature || payload.doubleCount!=='')throw new Error('請先儲存廠內實點，再另做複點確認');
   const refs=expectedSources.map(r=>api.doc(db,'sendwash_records',r.id)),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));
   if(old.doubleSignature)throw new Error('此品項已完成複點，廠內數量已鎖定');
   if(inv.exists()&&old.countSource!=='sendwash'&&[old.count,old.doubleCount,old.signature,old.doubleSignature].some(v=>v!==undefined&&v!==null&&v!==''))throw new Error('已有人工點收資料，請先核對，系統不會覆蓋');
   if(String(old.count ?? '')!==String(expectedCount ?? '')||String(old.doubleCount ?? '')!==String(expectedDoubleCount ?? ''))throw new Error('此品項數量已由其他人更新，請重新載入後確認');
   const sources={...(old.sendwashSources || {})},time=new Date().toISOString();
   const updates=snaps.map((snap,i)=>{
    if(!snap.exists())throw new Error('來源單已不存在');const latest=snap.data(),expected=expectedSources[i];
    const key=sourceItem(latest,item),row=latest.items.find(r=>r.item===key);
    // Compare the selected item's quantity, never serialized object key order or unrelated items.
    if(latest.targetDate!==date||latest.inventoryHotel!==hotel||!row||core.quantity(row.quantity)!==expected.quantity)throw new Error('飯店已修改此品項數量，請重新載入後確認');
    if(latest.acceptedAt||latest.receivedItems?.[key]||sources[expected.id])throw new Error('此品項已由其他人點收，請重新載入');
    sources[expected.id]={declared:expected.quantity,receivedAt:time};
    const receivedItems={...(latest.receivedItems || {}),[key]:{signature:payload.signature,receivedAt:time,aggregateActual:count}};
    return {receivedItems,notes:{...(latest.notes || {}),[key]:payload.note || ''},...(latest.items.every(r=>receivedItems[r.item])?{acceptedAt:time,receivedAt:time}:{} )};
   });
   const outlet=snaps[0]?.data()?.outlet || '';
   const value={...payload,...(outlet?{outlet,sourceItem:sourceItem(snaps[0].data(),item)}:{}),count,doubleCount:'',doubleSignature:'',doubleSignDate:'',countSource:'sendwash',sendwashStage:'received',sendwashSources:sources,timestamp:time};
   tx.set(recordRef,value,{merge:true});refs.forEach((ref,i)=>tx.update(ref,updates[i]));return {...old,...value};
  });
 };
})();


