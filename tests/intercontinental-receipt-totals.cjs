const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const loadModule=()=>import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('logistics-items.js','utf8')));
async function receiptFixture(inventory,receipts){
 const module=await loadModule(),source=fs.readFileSync('logistics.html','utf8');let displayed;
 const context=vm.createContext({...module,console,window:{},currentHotel:'洲際',currentDate:'2026-10-17',signatureSaving:false,dataReady:false,fetchSequence:0,db:{},document:{getElementById:()=>({innerHTML:'',classList:{remove(){},add(){}}})},collection:(_,name)=>name,where(){},query:name=>name,getDocsFromServer:async name=>({forEach:visit=>(name==='inventory_records'?inventory:receipts).forEach(data=>visit({data:()=>structuredClone(data)}))}),withReadTimeout:p=>p,finishBoot(){},showToastMsg(){},processAndRenderData:data=>displayed=structuredClone(data),loadingHtml:'loading'});
 vm.runInContext(source.slice(source.indexOf('        function extractQty(obj)'),source.indexOf('        const loadingHtml')),context);
 vm.runInContext(source.slice(source.indexOf('        async function fetchData('),source.indexOf('        function processAndRenderData(')),context);await context.fetchData();return{displayed,context,module};
}
const detailed=[{itemName:'【大地】口布',originalQty:'18',actualQty:'18'},{itemName:'【WARA】口布',originalQty:'12',actualQty:'12'}];
test('actual receipt loader shows one total with metadata and legacy encoded rows, never total plus outlet detail',async()=>{
 const inventory=[{hotel:'洲際 餐廳',item:'【大地】口布',outlet:'大地',sourceItem:'口布',doubleCount:'18'},{hotel:'洲際 餐廳',item:'【WARA】口布',doubleCount:'12'},{hotel:'洲際 餐廳',item:'口布',doubleCount:'30'}];
 const total={itemName:'口布',inventoryItemName:'口布',originalQty:'30',actualQty:'29',price:8,manualFinancePrice:true};
 const f=await receiptFixture(inventory,[{deptName:'餐廳',items:[total,...detailed],clientSig:'hotel',driverSig:'driver'}]);assert.equal(f.displayed.length,1);assert.equal(f.displayed[0].itemName,'口布');assert.equal(f.displayed[0].originalQty,'30');assert.equal(f.displayed[0].actualQty,'29');assert.equal(f.displayed[0].price,8);assert.equal(f.displayed[0].clientSig,'hotel');assert.equal(f.displayed[0].driverSig,'driver');
});
test('unsaved receipt adds only outlet quantities and ignores the old aggregate inventory fallback',async()=>{
 const f=await receiptFixture([{hotel:'洲際 餐廳',item:'口布',count:'99'},{hotel:'洲際 餐廳',item:'【大地】口布',count:'18'},{hotel:'洲際 餐廳',item:'【WARA】口布',count:'12'}],[]);assert.equal(f.displayed.length,1);assert.equal(f.displayed[0].originalQty,'30');assert.equal(f.displayed[0].actualQty,'30');
});
test('legacy saved details without inventory become a single total while explicit zero stays zero',async()=>{
 const f=await receiptFixture([],[{deptName:'餐廳',items:[{...detailed[0],actualQty:'0'},{...detailed[1],actualQty:'7'}]}]);assert.equal(f.displayed.length,1);assert.equal(f.displayed[0].itemName,'口布');assert.equal(f.displayed[0].originalQty,'30');assert.equal(f.displayed[0].actualQty,'7');assert.equal(f.displayed[0].loadedActualQty,'7');
});
test('signing normalized totals cannot reinsert the legacy breakdown and retains financial rename, price, and notes',async()=>{
 const {receiptTotalItems,mergeSignedItems}=await loadModule();
 const total={itemName:'餐巾',inventoryItemName:'口布',price:8,originalQty:'30',actualQty:'29',auntNote:'備註'};
 const original=[total,...detailed],view=receiptTotalItems(original,'洲際');const saved=mergeSignedItems(view,[{...total,loadedActualQty:'29',actualQty:'28'}]);assert.equal(saved.length,1);assert.equal(saved[0].itemName,'餐巾');assert.equal(saved[0].price,8);assert.equal(saved[0].auntNote,'備註');assert.equal(saved[0].actualQty,'28');assert.equal(original.length,3,'reading/signing preparation does not mutate original documents');
});
test('other hotels retain their existing row identities and totals; ordinary same-name rows are not removed',async()=>{
 const {receiptTotalItems,receiptInventoryIdentity}=await loadModule();assert.equal(receiptTotalItems(detailed,'其他飯店'),detailed);assert.equal(receiptInventoryIdentity({},'【大地】口布','其他飯店').itemName,'【大地】口布');const duplicates=[{itemName:'口布',actualQty:'2'},{itemName:'口布',actualQty:'3'}];assert.equal(receiptTotalItems(duplicates,'洲際').length,2);
});
