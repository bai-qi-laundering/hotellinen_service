const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let billingReceiptItems,financeItemSnapshot;test.before(async()=>{({billingReceiptItems,financeItemSnapshot}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('logistics-items.js','utf8'))));});
const source=fs.readFileSync('finance.html','utf8');
const helpers=source.slice(source.indexOf('function distinctShipmentRows('),source.indexOf('async function fetchRecordsForSelectedHotels()'));
const fetchCode=source.slice(source.indexOf('async function fetchRecordsForSelectedHotels()'),source.indexOf('// 💰 系統1：財務載入'));
const reportCode=source.slice(source.indexOf('function buildInvoiceReport()'),source.indexOf('function escapeReportHTML('));
const plain=x=>JSON.parse(JSON.stringify(x));
function context(docs=[]){
 const elements={startDate:{value:'2026-10-12'},endDate:{value:'2026-10-12'},invoiceTargetCompany:{value:'飯店A'}};
 const ctx=vm.createContext({billingReceiptItems,financeItemSnapshot,document:{getElementById:id=>elements[id],querySelectorAll:()=>[{value:'飯店A 房務'}]},getLogisticsDocsForPeriod:async()=>docs,ensureEffectivePrices:async()=>{},syncMasterDataFromSheet:async()=>{},ensurePricingRules:async()=>{},ensureLogisticsItemOrder:async()=>{},standardizeDate:s=>s,logisticsMasterItems:[{}],rawLogisticsData:[],invoiceCustomerKeyForRecord:r=>r.parentCompany,reportRecordPrice:r=>r.savedPrice == null?18:Number(r.savedPrice),compareLogisticsItems:()=>0,rebateForReport:()=>({amount:0,percent:0}),managementFeeForReport:()=>({amount:0,percent:0}),alert(){},console});
 vm.runInContext(helpers+fetchCode+reportCode,ctx);return ctx;
}
const receipt=(id,qty,price=18)=>({id,data:()=>({date:'2026-10-12',hotelKeyword:'飯店A',deptName:'房務',items:[{itemName:'浴巾',actualQty:String(qty),price,manualFinancePrice:true}]})});
test('actual finance loader counts separate same-day same-item receipts, deduplicates reread of same source only',async()=>{
 const a=receipt('morning',100),b=receipt('afternoon',50),ctx=context([a,b,a]);const rows=await ctx.fetchRecordsForSelectedHotels();assert.equal(rows.length,2);assert.deepEqual(plain(rows.map(r=>r.qty)),[100,50]);assert.equal(new Set(rows.map(r=>r.rowId)).size,2);ctx.rawLogisticsData=rows;const report=ctx.buildInvoiceReport();const dept=report.depts['飯店A 房務'];assert.equal(dept.records.length,2);assert.equal(Object.values(dept.summary)[0].qty,150);assert.equal(report.grandTotal,2700);assert.equal(report.tax,135);assert.equal(report.afterRebate+report.tax,2835);
});
test('duplicate item names in different source rows remain independent',async()=>{
 const doc={id:'same-receipt',data:()=>({date:'2026-10-12',hotelKeyword:'飯店A',deptName:'房務',items:[{itemName:'浴巾',actualQty:'100'},{itemName:'浴巾',actualQty:'50'}]})};const ctx=context([doc]);const rows=await ctx.fetchRecordsForSelectedHotels();assert.equal(rows.length,2);assert.equal(rows.reduce((s,r)=>s+r.qty,0),150);assert.deepEqual(plain(rows.map(r=>r.receiptOrder)),[0,1]);
});
test('different shipment prices retain separate summary prices and both amounts',async()=>{
 const ctx=context([receipt('first',100,18),receipt('second',50,20)]);ctx.rawLogisticsData=await ctx.fetchRecordsForSelectedHotels();const report=ctx.buildInvoiceReport();assert.equal(Object.keys(report.depts['飯店A 房務'].summary).length,2);assert.equal(report.grandTotal,2800);assert.equal(report.depts['飯店A 房務'].records.length,2);
});
test('report defensively avoids billing a reread row twice but never deduplicates by date/name/quantity',()=>{
 const ctx=context();const a={docId:'A',receiptOrder:0,parentCompany:'飯店A',hotel:'飯店A 房務',date:'2026-10-12',item:'浴巾',qty:100,savedPrice:18};ctx.rawLogisticsData=[a,{...a},{...a,docId:'B'}];const report=ctx.buildInvoiceReport();assert.equal(report.depts['飯店A 房務'].records.length,2);assert.equal(report.grandTotal,3600);
});
test('multi-shipment date metadata distinguishes source documents while preserving legacy rows without IDs',()=>{
 const ctx=context();assert.equal(ctx.shipmentCountsByDate([{date:'2026-10-12',docId:'A'},{date:'2026-10-12',docId:'B'},{date:'2026-10-12',docId:'A'}]).get('2026-10-12'),2);assert.equal(ctx.distinctShipmentRows([{date:'2026-10-12',item:'浴巾',qty:50},{date:'2026-10-12',item:'浴巾',qty:50}]).length,2);
});

test('InterContinental settlement bills signed receipt totals once, excluding old department details',async()=>{
 const signed={date:'2026-10-12',hotelKeyword:'洲際',deptName:'餐廳',clientSig:'H',driverSig:'D',items:[{itemName:'【湛露】黃口布',actualQty:'20'},{itemName:'口布',originalQty:'30',actualQty:'28',price:8,manualFinancePrice:true},{itemName:'【WARA】口布',actualQty:'10'},{itemName:'方巾',actualQty:'5',price:3,manualFinancePrice:true},{itemName:'【CLUB】雞尾酒巾',actualQty:'5'}]};
 const ctx=context([{id:'signed',data:()=>signed}]);ctx.document.querySelectorAll=()=>[{value:'洲際 餐廳'}];ctx.document.getElementById('invoiceTargetCompany').value='洲際';
 const rows=await ctx.fetchRecordsForSelectedHotels();assert.deepEqual(plain(rows.map(r=>[r.item,r.qty,r.savedPrice])),[['口布',28,8],['方巾',5,3]]);ctx.rawLogisticsData=rows;
 const report=ctx.buildInvoiceReport();assert.equal(report.grandTotal,239);assert.equal(Object.keys(report.depts).length,1);assert.equal(report.depts['洲際 餐廳'].records.length,2);assert.equal(signed.items.length,5,'loading does not mutate the signed document');
});
test('legacy outlet-only receipts combine variants per shipment and separate same-day shipments remain billable',async()=>{
 const base={date:'2026-10-12',hotelKeyword:'洲際',deptName:'餐廳'};
 const a={id:'morning',data:()=>({...base,items:[{itemName:'【CLUB】方巾',actualQty:'3',price:2},{itemName:'【CLUB】雞尾酒巾',actualQty:'7',price:2},{itemName:'【湛露】黃口布',actualQty:'10',price:8},{itemName:'【湛露】白口布',actualQty:'0',price:8}]})};
 const b={id:'afternoon',data:()=>({...base,items:[{itemName:'口布',actualQty:'5',price:9}]})};
 const ctx=context([a,b,a]);ctx.document.querySelectorAll=()=>[{value:'洲際 餐廳'}];const rows=await ctx.fetchRecordsForSelectedHotels();assert.deepEqual(plain(rows.map(r=>[r.docId,r.item,r.qty])),[['morning','方巾',10],['morning','口布',10],['afternoon','口布',5]]);
});
test('finance normalization retains signed zero and does not change other hotels or InterContinental housekeeping',()=>{
 const items=[{itemName:'口布',actualQty:'0'},{itemName:'【湛露】黃口布',actualQty:'99'}];assert.deepEqual(billingReceiptItems({hotelKeyword:'洲際',deptName:'餐廳',items}).map(i=>[i.itemName,i.actualQty]),[['口布','0']]);
 for(const receipt of [{hotelKeyword:'H2O',deptName:'餐廳',items},{hotelKeyword:'洲際',deptName:'房務',items},{hotelKeyword:'洲際',deptName:'制服',items}])assert.equal(billingReceiptItems(receipt),items);
});
test('financial rename targets the canonical total after normalization and retains price and signatures',async()=>{
 const {applyFinanceItemNames}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('logistics-items.js','utf8')));
 const receipt={hotelKeyword:'洲際',deptName:'餐廳',clientSig:'H',driverSig:'D',items:[{itemName:'【湛露】黃口布',actualQty:'99'},{itemName:'口布',inventoryItemName:'口布',originalQty:'30',actualQty:'28',price:8,manualFinancePrice:true,auntNote:'保留'}]};
 const items=applyFinanceItemNames(billingReceiptItems(receipt),[{receiptOrder:0,originalItemName:'口布',sourceItemName:'口布',newItemName:'餐巾',newPrice:9}]);
 assert.equal(items.length,1);assert.equal(items[0].itemName,'餐巾');assert.equal(items[0].actualQty,'28');assert.equal(items[0].price,8);assert.equal(items[0].auntNote,'保留');assert.equal(receipt.clientSig,'H');assert.equal(receipt.items.length,2);
});
test('October 16 legacy total plus department structure bills only canonical quantities including SEEDS mats',async()=>{
 const items=[{itemName:'【SEEDS(大地)】餐墊',actualQty:'164',originalQty:'164'},{itemName:'【CLUB】口布',actualQty:'33'},{itemName:'口布',actualQty:'232',originalQty:'232',price:8.5},{itemName:'餐墊',actualQty:'164',originalQty:'164'}],ctx=context([{id:'old-total',data:()=>({date:'2026-10-12',hotelKeyword:'洲際',deptName:'餐廳',items})}]);
 ctx.document.querySelectorAll=()=>[{value:'洲際 餐廳'}];const rows=await ctx.fetchRecordsForSelectedHotels();assert.deepEqual(plain(rows.map(i=>[i.item,i.qty])),[['口布',396]]);
 const blank=billingReceiptItems({hotelKeyword:'洲際',deptName:'餐廳',items:[{itemName:'【大地】餐墊',actualQty:'2',originalQty:'2'},{itemName:'口布',actualQty:'',originalQty:'10'},{itemName:'餐墊',actualQty:'',originalQty:'2'}]});assert.equal(blank.find(i=>i.itemName==='口布').actualQty,'0');
});

test('actual rename UI accepts an existing name and records separate row identity for saving',async()=>{
 const {applyFinanceItemNames}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('logistics-items.js','utf8')));
 const items=[{itemName:'嬰兒地墊',originalQty:'1',actualQty:'1',price:3},{itemName:'地墊',originalQty:'2',actualQty:'2',price:7}];
 const rows=items.map((i,receiptOrder)=>({docId:'same',receiptOrder,item:i.itemName,originalItemName:i.itemName,sourceItemName:i.itemName,date:'2026-10-01',qty:Number(i.actualQty),sourceRowSnapshot:financeItemSnapshot(i)})),alerts=[];
 const ctx=vm.createContext({window:{},rawLogisticsData:rows,pendingUpdatesArray:[],crypto:{randomUUID:()=> 'new-row-1'},document:{getElementById:()=>({classList:{remove(){},add(){}},innerHTML:''})},getPrice:()=>7,recalculateFinanceUI(){},alert:msg=>alerts.push(msg),customPricesDirty:false});
 vm.runInContext(source.slice(source.indexOf('function registerPendingUpdate('),source.indexOf('window.markPriceChanged =')),ctx);
 ctx.window.markItemChanged('same',0,'飯店A 房務','地墊',{value:'',style:{},closest:()=>({querySelector:()=>({style:{}})})});
 assert.deepEqual(alerts,[]);assert.equal(rows[0].item,'地墊');assert.equal(ctx.pendingUpdatesArray.length,1);
 const saved=applyFinanceItemNames(items,plain(ctx.pendingUpdatesArray));assert.deepEqual(saved.map(i=>[i.itemName,i.actualQty,i.price]),[['地墊','1',3],['地墊','2',7]]);assert.equal(saved[0].financeItemId,'new-row-1');assert.equal(saved[0].inventoryItemName,'嬰兒地墊');
 const f=context([{id:'same',data:()=>({date:'2026-10-12',hotelKeyword:'飯店A',deptName:'房務',items:saved})}]);const loaded=await f.fetchRecordsForSelectedHotels();assert.equal(loaded.length,2);assert.equal(loaded.reduce((s,r)=>s+r.qty,0),3);
});
test('duplicate source names can be renamed separately, retried, and renamed after server rows reorder',async()=>{
 const {applyFinanceItemNames}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('logistics-items.js','utf8'))),items=[{itemName:'地墊',actualQty:'1',price:3},{itemName:'地墊',actualQty:'2',price:7}];
 const updates=items.map((i,receiptOrder)=>({receiptOrder,financeItemId:'row-'+receiptOrder,sourceRowSnapshot:financeItemSnapshot(i),originalItemName:i.itemName,sourceItemName:i.itemName,newItemName:'防滑墊'}));
 const saved=applyFinanceItemNames(items,updates);assert.deepEqual(saved.map(i=>[i.financeItemId,i.itemName,i.actualQty]),[['row-0','防滑墊','1'],['row-1','防滑墊','2']]);assert.deepEqual(applyFinanceItemNames(saved,updates),saved);
 const again={...updates[1],originalItemName:'防滑墊',newItemName:'地墊'};const reordered=applyFinanceItemNames([...saved].reverse(),[again]);assert.equal(reordered[0].financeItemId,'row-1');assert.equal(reordered[0].itemName,'地墊');assert.equal(reordered[1].itemName,'防滑墊');
 const changed=items.map(i=>({...i,actualQty:'99'}));assert.throws(()=>applyFinanceItemNames(changed,[updates[0]]),/重新載入/);assert.equal(changed[0].itemName,'地墊');
 const identical=[{itemName:'同名',actualQty:'1'},{itemName:'同名',actualQty:'1'}];const both=applyFinanceItemNames(identical,identical.map((i,receiptOrder)=>({receiptOrder,financeItemId:'same-'+receiptOrder,sourceRowSnapshot:financeItemSnapshot(i),originalItemName:'同名',sourceItemName:'同名',newItemName:'改名'})));assert.equal(new Set(both.map(i=>i.financeItemId)).size,2);
});
