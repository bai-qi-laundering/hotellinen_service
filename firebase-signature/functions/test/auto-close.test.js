import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signatureAdded,closingPeriod,taipeiDate,rowsForPeriod,createInvoiceEngine,commitOnce,caseDocumentId} from '../lib/auto-close.js';
const options=(rows=[])=>({logisticsMasterItems:[{hotel:'富野 房務',item:'床單'}],pricingRules:{holidays:[],rebates:[],managementFees:[]},effectivePriceRules:[],sheetPrices:{},customPrices:{},sheetClients:{富野:{name:'富野股份有限公司',taxId:'12345678'}},rawLogisticsData:rows});
test('either first signature triggers; quantity edits, replacement signatures and deletion do not',()=>{
 assert.equal(signatureAdded({}, {clientSig:'url'}),true);
 assert.equal(signatureAdded({}, {driverSig:'url'}),true);
 assert.equal(signatureAdded({clientSig:'old'}, {clientSig:'new'}),false);
 assert.equal(signatureAdded({clientSig:'url'}, {clientSig:'url',items:[]}),false);
 assert.equal(signatureAdded({driverSig:'url'}, {}),false);
});
test('closing dates include both endpoints, month end and leap year; saved groups override defaults',()=>{
 assert.deepEqual(closingPeriod('富野','2026-01-25'),{startDate:'2025-12-26',endDate:'2026-01-25'});
 assert.equal(closingPeriod('富野','2026-10-24'),null);
 assert.deepEqual(closingPeriod('日航','2026-10-31'),{startDate:'2026-10-01',endDate:'2026-10-31'});
 assert.equal(closingPeriod('日航','2026-10-30'),null);
 assert.deepEqual(closingPeriod('日航','2028-02-29'),{startDate:'2028-02-01',endDate:'2028-02-29'});
 assert.equal(closingPeriod('富野','2026-10-25',{富野:'month'}),null);
 assert.equal(closingPeriod('富野','2026-10-25',{富野:''}),null);
 assert.equal(taipeiDate('2026-10-24T16:00:00Z'),'2026-10-25');
});
test('receipt rows match finance quantity fallback, deletion, rewashes, customer scope and period boundaries',()=>{
 const docs=[{id:'a',data:{date:'2026-9-26',hotelKeyword:'富野',deptName:'房務',items:[{itemName:'床單',actualQty:0,originalQty:9},{itemName:'床單',actualQty:'',originalQty:3,price:10},{itemName:'回洗床單',actualQty:2},{itemName:'床單',actualQty:2,deletedInLogistics:true}]}},
 {id:'b',data:{date:'2026-10-25',hotelKeyword:'富野',deptName:'房務',items:[{itemName:'床單',actualQty:2,price:10}]}},
 {id:'c',data:{date:'2026-10-26',hotelKeyword:'富野',items:[{itemName:'床單',actualQty:99}]}},
 {id:'d',data:{date:'2026-10-25',hotelKeyword:'日航',items:[{itemName:'床單',actualQty:99}]}}];
 const rows=rowsForPeriod(docs,'富野','2026-09-26','2026-10-25');
 assert.deepEqual(rows.map(r=>r.qty),[3,2]);
 const snapshot=createInvoiceEngine(options(rows)).build('富野','2026-09-26','2026-10-25');
 assert.equal(snapshot.totals.grandTotal,50);assert.equal(snapshot.totals.tax,3);assert.equal(snapshot.departments[0].summary[0].qty,5);
});
test('dated price, holiday rounding, rebate, management fee and tax follow finance formulas',()=>{
 const row={docId:'a',receiptOrder:0,date:'2026-10-25',parentCompany:'富野',hotel:'富野 房務',item:'床單',qty:10,savedPrice:5};
 const o=options([row]);
 o.effectivePriceRules=[{key:'富野 房務_床單',start:'2026-10-01',price:12.34}];
 o.pricingRules={holidays:[{hotel:'富野',start:'2026-10-25',end:'2026-10-25',percent:10}],rebates:[{hotel:'富野',percent:10}],managementFees:[{hotel:'富野',percent:5}]};
 const s=createInvoiceEngine(o).build('富野','2026-09-26','2026-10-25');
 assert.equal(s.totals.grandTotal,136);assert.equal(s.totals.rebate.amount,14);
 assert.equal(s.totals.managementFee.amount,7);assert.equal(s.totals.afterRebate,129);assert.equal(s.totals.tax,6);
});
function fakeDb(){
 const data=new Map();let chain=Promise.resolve();
 return {data,collection:name=>({doc:id=>({key:name+'/'+id})}),runTransaction:work=>{
  const run=chain.then(async()=>{const writes=[];const result=await work({get:async ref=>({exists:data.has(ref.key),data:()=>data.get(ref.key)}),create:(ref,value)=>{if(data.has(ref.key))throw Error('exists');writes.push([ref.key,value])}});
  writes.forEach(([k,v])=>data.set(k,v));return result;});chain=run.catch(()=>{});return run;
 }};
}
test('concurrent signatures and event redelivery create only one case; later manual changes stay untouched',async()=>{
 const db=fakeDb(),row={docId:'a',receiptOrder:0,date:'2026-10-25',parentCompany:'富野',hotel:'富野 房務',item:'床單',qty:2,savedPrice:10};
 const snapshot=createInvoiceEngine(options([row])).build('富野','2026-09-26','2026-10-25');
 const id=await caseDocumentId('富野',snapshot.startDate,snapshot.endDate);
 const args={db,id,snapshot,eventId:'e1',receiptId:'r',eventTime:'2026-10-25T10:00:00Z'};
 assert.deepEqual((await Promise.all(Array.from({length:8},()=>commitOnce(args)))).sort(),['already_completed','already_completed','already_completed','already_completed','already_completed','already_completed','already_completed','created']);
 const item=db.data.get('statement_cases/'+id);item.latestVersion=7;
 assert.equal(await commitOnce(args),'already_completed');assert.equal(item.latestVersion,7);
});
test('a manual case existing before auto generation is preserved and marked skipped',async()=>{
 const db=fakeDb();db.data.set('statement_cases/id',{latestVersion:4});
 const result=await commitOnce({db,id:'id',snapshot:{},eventId:'e',receiptId:'r',eventTime:'t'});
 assert.equal(result,'skipped_existing');assert.equal(db.data.get('statement_cases/id').latestVersion,4);
 assert.equal(db.data.get('statement_auto_runs/id').status,'skipped_existing');
});
test('failed transaction leaves no completion marker and can be retried',async()=>{
 const db=fakeDb();
 await assert.rejects(commitOnce({db,id:'x',snapshot:{},eventId:'e',receiptId:'r',eventTime:'t'}));
 assert.equal(db.data.size,0);
});
