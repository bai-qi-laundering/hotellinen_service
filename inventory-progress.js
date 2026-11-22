/* A dashboard lamp describes the selected batch, regardless of the recheck day. */
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
  let stopped=false;
  const batches=[...new Set(configs.map(c=>c.batchDate).filter(Boolean))].sort();
  const stops=[],snapshots=new Map();
  if(!batches.length){onChange(new Set());return()=>{stopped=true;};}
  function paint(){
   if(stopped||snapshots.size!==Math.ceil(batches.length/30))return;
   const rows=[...snapshots.values()].flat();
   const byBatch=new Map();
   for(const row of rows){
    const key=JSON.stringify([row.hotel,day(row.date)]);
    if(!byBatch.has(key))byBatch.set(key,[]);
    byBatch.get(key).push(row);
   }
   const lit=new Set();
   for(const config of configs){
    const batchRows=byBatch.get(JSON.stringify([config.hotel,config.batchDate]))||[];
    const requiredItems=required(config.items,config.room);
    const a=config.items.findIndex(n=>n.includes('床單')),b=config.items.findIndex(n=>n.includes('抹布'));
    const beddingRange=config.room&&a>=0&&b>=a;
    const items=beddingRange?requiredItems:[...new Set([...requiredItems,...batchRows.map(r=>r.item).filter(item=>item&&!item.startsWith('_MANUAL_'))])];
    if(completed(batchRows,items))lit.add(config.base);
   }
   onChange(lit);
  }
  for(let offset=0;offset<batches.length;offset+=30){
   const key=offset/30,dates=batches.slice(offset,offset+30);
   stops.push(api.onSnapshot(api.query(api.collection(db,'inventory_records'),api.where('date','in',dates)),snapshot=>{
    if(stopped)return;
    snapshots.set(key,snapshot.docs.map(d=>d.data()));paint();
   },onError));
  }
  return()=>{stopped=true;stops.forEach(stop=>stop());snapshots.clear();};
 }
 const api={quantity,day,required,completed,watch};
 root.InventoryProgress=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
