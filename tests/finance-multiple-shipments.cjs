const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('finance.html','utf8');
const helpers=source.slice(source.indexOf('function distinctShipmentRows('),source.indexOf('async function fetchRecordsForSelectedHotels()'));
const fetchCode=source.slice(source.indexOf('async function fetchRecordsForSelectedHotels()'),source.indexOf('// 💰 系統1：財務載入'));
const reportCode=source.slice(source.indexOf('function buildInvoiceReport()'),source.indexOf('function escapeReportHTML('));
const plain=x=>JSON.parse(JSON.stringify(x));
function context(docs=[]){
 const elements={startDate:{value:'2026-10-12'},endDate:{value:'2026-10-12'},invoiceTargetCompany:{value:'飯店A'}};
 const ctx=vm.createContext({document:{getElementById:id=>elements[id],querySelectorAll:()=>[{value:'飯店A 房務'}]},getLogisticsDocsForPeriod:async()=>docs,ensureEffectivePrices:async()=>{},syncMasterDataFromSheet:async()=>{},ensurePricingRules:async()=>{},ensureLogisticsItemOrder:async()=>{},standardizeDate:s=>s,logisticsMasterItems:[{}],rawLogisticsData:[],invoiceCustomerKeyForRecord:r=>r.parentCompany,reportRecordPrice:r=>r.savedPrice == null?18:Number(r.savedPrice),compareLogisticsItems:()=>0,rebateForReport:()=>({amount:0,percent:0}),managementFeeForReport:()=>({amount:0,percent:0}),alert(){},console});
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
