const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
vm.runInThisContext(fs.readFileSync('scoped-reads.js','utf8'));
const S=ScopedReads,api={collection:(_,name)=>name,where:(field,op,value)=>({field,op,value}),query:(name,...filters)=>({name,filters})};
const template=[{baseName:'花季',deptName:'Ｃ館 房務',hotel:'花季Ｃ館 房務'},{baseName:'富野汽旅',deptName:'房務',hotel:'富野汽旅 房務'},{baseName:'鉑麗',deptName:'房務',hotel:'鉑麗 房務'}];
assert.equal(S.norm(' 花季 Ｃ館　房務 '),S.norm('花季C館房務'));
assert(S.names(template,'鉑','inventory').includes('鉑麗 房務'));
assert(S.names(template,'富野','logistics').includes('富野'));
assert(S.names(template,'富野','logistics').includes('富野汽旅'));
assert(S.names(template,'花季','logistics').includes('花季Ｃ館'));
assert.deepEqual(S.queries(api,{},'x','2026-11-15','2026-11-18',{field:'hotel',values:[]}),[]);
assert.throws(()=>S.dates('2026-11-18','2026-11-15'));
const days=S.dates('2026-01-31','2026-02-01');assert(days.includes('2026/2/1'));assert(!days.includes('2026-02-02'));
for(const field of ['hotel','hotelKeyword','customerKey']){
 const plans=S.queries(api,{},'records','2026-11-15','2026-11-18',{field,values:Array.from({length:47},(_,i)=>'hotel'+i)});
 assert(plans.length);
 for(const query of plans){
  assert(query.filters.some(f=>f.field===field));
  const date=query.filters.find(f=>f.field==='date');assert(date);assert(!date.value.some(v=>v.includes('11-19')));
  assert(query.filters.reduce((n,f)=>n*(f.op==='in'?f.value.length:1),1)<=30);
 }
}
(async()=>{
 let calls=0; const result=await S.read({...api,getDocsFromServer:async()=>{calls++;throw Error('offline')}},{},'records','2026-11-18','2026-11-18',{field:'hotel',values:['鉑麗 房務']}).catch(e=>e.message);
 assert.equal(result,'offline');assert.equal(calls,1,'failed reads must never retry an unfiltered collection');
 console.log('Scoped query plans, aliases, date boundaries and no broad fallback: PASS');
})();
