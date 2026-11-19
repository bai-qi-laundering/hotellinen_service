/* Query planning shared by inventory, logistics, special treatment and finance.
 * An empty matched name list means no results, never an unfiltered retry. */
(function(root){
 const norm=v=>String(v||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
 const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
 function dates(start,end){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw Error('請確認起訖日期');
  const out=new Set(),d=new Date(start+'T00:00:00Z'),last=new Date(end+'T00:00:00Z');
  for(;d<=last;d.setUTCDate(d.getUTCDate()+1)){
   const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,n=d.getUTCDate();
   for(const sep of ['-','/'])for(const mm of new Set([''+m,('0'+m).slice(-2)]))for(const dd of new Set([''+n,('0'+n).slice(-2)]))out.add([y,mm,dd].join(sep));
  }return [...out];
 }
 function variants(v){
  const s=String(v||'').trim(),half=s.normalize('NFKC'),out=new Set([s,half,half.replace(/\s+/g,' '),half.replace(/\s+/g,'')]);
  for(const name of [...out])out.add(name.replace(/[A-Za-z0-9]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0)));
  return [...out].filter(Boolean);
 }
 function names(rows,keyword,kind='inventory'){
  if(!norm(keyword))return null;
  const out=new Set();
  for(const row of rows||[]){
   const base=String(row.baseName||row.hotel||'').trim(),dept=String(row.deptName||'房務').trim(),full=String(row.hotel||base+' '+dept).trim();
   if(![base,full,base+' '+dept].some(s=>norm(s).includes(norm(keyword))))continue;
   for(const label of kind==='logistics'?[base]:[full,base+' '+dept])for(const v of variants(label))out.add(v);
   if(norm(base).startsWith('花季'))for(const v of variants(kind==='logistics'?'花季':full))out.add(v);
   if(norm(base+dept).includes('富野汽旅'))for(const label of kind==='logistics'?['富野','富野汽旅','富野 汽旅']:['富野 汽旅 房務','富野汽旅 房務'])for(const v of variants(label))out.add(v);
  }
  if(norm(keyword).startsWith('花季'))for(const v of variants('花季'))out.add(v);
  // A full hotel name that is no longer in the current template can still be queried.
  for(const v of variants(keyword))out.add(v);
  if(kind==='logistics'&&norm(keyword).startsWith('花季'))for(const branch of ['A','C'])for(const v of variants('花季'+branch+'館'))out.add(v);
  return [...out];
 }
 function queries(api,db,name,start,end,{field='',values=null,dateField='date',timestamps=false,canonicalDates=false}={}){
  if(values&&values.length===0)return [];
  const filters=values?chunks([...new Set(values)],10):[null],result=[];
  for(const group of filters){
   const hotel=group?[api.where(field,group.length===1?'==':'in',group.length===1?group[0]:group)]:[];
   for(const days of chunks(dates(start,end).filter(value=>!canonicalDates||/^\d{4}-\d{2}-\d{2}$/.test(value)),Math.floor(30/(group?.length||1))))result.push(api.query(api.collection(db,name),...hotel,api.where(dateField,'in',days)));
   if(timestamps)result.push(api.query(api.collection(db,name),...hotel,api.where(dateField,'>=',new Date(start+'T00:00:00+08:00')),api.where(dateField,'<=',new Date(end+'T23:59:59.999+08:00'))));
  }return result;
 }
 async function read(api,db,name,start,end,options={}){
  const planned=queries(api,db,name,start,end,options),snaps=[];
  for(const batch of chunks(planned,4))snaps.push(...await Promise.all(batch.map(q=>api.getDocsFromServer(q))));
  return snaps;
 }
 root.ScopedReads={norm,dates,variants,names,queries,read,chunks};
})(typeof window==='object'?window:globalThis);
