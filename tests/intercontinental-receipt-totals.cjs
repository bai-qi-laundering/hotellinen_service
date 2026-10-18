const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const loadModule=()=>import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('logistics-items.js','utf8')));
async function receiptFixture(inventory,receipts,settings=[],hotel='洲際'){
 const module=await loadModule(),source=fs.readFileSync('logistics.html','utf8');let displayed;const elements=new Map(),reads=[];const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,innerHTML:'',classList:{remove(){},add(){}}});return elements.get(id);};
 const context=vm.createContext({...module,console:{...console,warn(){}},window:{},sendwashSettings:settings,currentHotel:hotel,currentDate:'2026-10-17',signatureSaving:false,dataReady:false,fetchSequence:0,db:{},document:{getElementById:element},collection:(_,name)=>name,where(){},query:name=>name,getDocsFromServer:async name=>{reads.push(name);return{forEach:visit=>(name==='inventory_records'?inventory:receipts).forEach(data=>visit({data:()=>structuredClone(data)}))};},withReadTimeout:p=>p,finishBoot(){},showToastMsg(){},processAndRenderData:data=>displayed=structuredClone(data),loadingHtml:'loading'});
 vm.runInContext(source.slice(source.indexOf('        function escapeHtml('),source.indexOf('        function finishBoot(')),context);
 vm.runInContext(source.slice(source.indexOf('        function extractQty(obj)'),source.indexOf('        const loadingHtml')),context);
 vm.runInContext(source.slice(source.indexOf('        async function fetchData('),source.indexOf('        function processAndRenderData(')),context);await context.fetchData();return{displayed,context,module,elements,reads};
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
test('receipt displays one top total and separate read-only outlet details below, without more database reads',async()=>{
 const inventory=[{hotel:'洲際 餐廳',item:'【大地】口布',doubleCount:'18'},{hotel:'洲際 餐廳',item:'【WARA】口布',doubleCount:'12'},{hotel:'洲際 餐廳',item:'【大地】小毛巾',doubleCount:'0'},{hotel:'洲際 餐廳',item:'口布',doubleCount:'99'},{hotel:'洲際 餐廳',item:'【大地】桌裙',outlet:'大地',sourceItem:'桌裙',count:'',doubleCount:'3',sendwashSupplemental:true}];
 const settings=[{hotel:'洲際',department:'餐廳',outlet:'WARA',item:'口布'},{hotel:'洲際',department:'餐廳',outlet:'大地',item:'小毛巾'},{hotel:'洲際',department:'餐廳',outlet:'大地',item:'口布'}];
 const f=await receiptFixture(inventory,[],settings),html=f.elements.get('outletDetails').innerHTML;
 assert.equal(f.displayed.filter(row=>row.itemName==='口布').length,1);assert.equal(f.displayed.find(row=>row.itemName==='口布').originalQty,'30');assert.equal(f.elements.get('receiptTotalsHeading').hidden,false);assert.equal(f.elements.get('outletDetails').hidden,false);assert(html.includes('各餐廳部門明細'));assert(html.includes('WARA'));assert(html.includes('大地'));assert(html.includes('>18</td>'),html);assert(html.includes('>12</td>'));assert(html.includes('>0</td>'));assert(html.includes('桌裙'));assert(html.includes('>3</td>'));assert(!/<(?:input|button)\b/.test(html));assert(!html.includes('onclick='));assert.deepEqual(f.reads.sort(),['inventory_records','logistics_records']);
 assert.deepEqual(f.context.outletDetailGroups.map(group=>group.outlet),['WARA','大地']);assert.deepEqual(f.context.outletDetailGroups[1].items.map(row=>row.itemName),['小毛巾','口布','桌裙']);
 const source=fs.readFileSync('logistics.html','utf8');assert(source.indexOf('id="receiptTotalsHeading"')<source.indexOf('id="departmentsContainer"'));assert(source.indexOf('id="departmentsContainer"')<source.indexOf('id="outletDetails"'));
});
test('details prefer live plant records, supplement missing legacy outlets and escape notes safely',async()=>{
 const note='<script>alert("x")</script>';
 const f=await receiptFixture([{hotel:'洲際 餐廳',item:'【大地】口布',doubleCount:'18',note}],[{deptName:'餐廳',items:[{itemName:'口布',actualQty:'30'}, {...detailed[0],actualQty:'99'},detailed[1]]}]);
 const groups=f.context.outletDetailGroups;assert.equal(groups.find(group=>group.outlet==='大地').items[0].quantity,'18');assert.equal(groups.find(group=>group.outlet==='WARA').items[0].quantity,'12');assert(!groups.some(group=>group.items.some(item=>item.quantity==='99')));const html=f.elements.get('outletDetails').innerHTML;assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));
});
test('other hotel pages remain unchanged and no invented department quantities appear when only a total exists',async()=>{
 const other=await receiptFixture([{hotel:'其他飯店 餐廳',item:'口布',count:'5'}],[],[],'其他飯店');assert.equal(other.elements.get('receiptTotalsHeading').hidden,true);assert.equal(other.elements.get('outletDetails').hidden,true);
 const f=await receiptFixture([],[{deptName:'餐廳',items:[{itemName:'口布',actualQty:'30'}]}]);assert.equal(f.context.outletDetailGroups.length,0);assert(f.elements.get('outletDetails').innerHTML.includes('尚無各部門'));assert.equal(f.displayed[0].actualQty,'30');
});
test('optional breakdown errors never block the total signing page',async()=>{
 const f=await receiptFixture([{hotel:'洲際 餐廳',item:'【大地】口布',doubleCount:'1.5'}],[]);assert.equal(f.context.dataReady,true);assert(f.elements.get('outletDetails').innerHTML.includes('仍可在上方簽收總數'));assert.equal(f.displayed[0].originalQty,'1.5');
});

test('colored napkins and wiping cloths bill only canonical totals but preserve subtype breakdown',async()=>{
 const rows=[['湛露','黃口布','10'],['湛露','白口布','0'],['大地','口布','8'],['湛露','擦拭布','3'],['湛露','紅邊擦拭布','4'],['WARA','紅邊擦拭布','5']];
 const f=await receiptFixture(rows.map(([outlet,sourceItem,doubleCount],i)=>({hotel:'洲際 餐廳',item:`【${outlet}】${sourceItem}`,doubleCount,...(i%2?{outlet,sourceItem}:{})})),[]);
 assert.equal(f.displayed.length,2);assert.equal(f.displayed.find(r=>r.itemName==='口布').originalQty,'18');assert.equal(f.displayed.find(r=>r.itemName==='擦拭布').originalQty,'12');
 const detail=f.context.outletDetailGroups.find(g=>g.outlet==='湛露');assert.deepEqual(detail.items.map(r=>[r.itemName,r.quantity]),[['黃口布','10'],['白口布','0'],['擦拭布','3'],['紅邊擦拭布','4']]);
 const signed=f.module.receiptTotalItems(rows.map(([outlet,itemName,actualQty])=>({outlet,sourceItem:itemName,itemName,originalQty:actualQty,actualQty})),'洲際');assert.deepEqual(signed.map(r=>[r.itemName,r.actualQty]),[['口布','18'],['擦拭布','12']]);
});
test('variant mapping is scoped to InterContinental restaurant outlets and legacy saved details stay separate',async()=>{
 const m=await loadModule();for(const [hotel,record,name] of [['其他飯店',{outlet:'湛露',sourceItem:'黃口布'},'黃口布'],['洲際',{outlet:'WARA',sourceItem:'黃口布'},'黃口布'],['洲際',{outlet:'湛露',sourceItem:'紅邊擦拭布',department:'制服'},'紅邊擦拭布']])assert.equal(m.receiptInventoryIdentity(record,'unused',hotel).itemName,name);
 const receipt={deptName:'餐廳',items:[{itemName:'【湛露】黃口布',actualQty:'2'},{itemName:'【湛露】白口布',actualQty:'3'},{itemName:'【湛露】紅邊擦拭布',actualQty:'0'}]};
 assert.deepEqual(m.receiptTotalItems(receipt.items,'洲際').map(r=>[r.itemName,r.actualQty]),[['口布','5'],['擦拭布','0']]);assert.deepEqual(m.outletReceiptDetails([], [receipt],'洲際')[0].items.map(r=>r.itemName),['黃口布','白口布','紅邊擦拭布']);
});

test('CLUB cocktail towels merge only into square towel totals while details remain independent',async()=>{
 const f=await receiptFixture([{hotel:'洲際 餐廳',outlet:'CLUB',sourceItem:'雞尾酒巾',item:'【CLUB】雞尾酒巾',doubleCount:'7'},{hotel:'洲際 餐廳',item:'【CLUB】方巾',doubleCount:'3'},{hotel:'洲際 餐廳',item:'【WARA】方巾',doubleCount:'2'}],[]);
 assert.equal(f.displayed.length,1);assert.equal(f.displayed[0].itemName,'方巾');assert.equal(f.displayed[0].originalQty,'12');
 assert.deepEqual(f.context.outletDetailGroups.find(g=>g.outlet==='CLUB').items.map(r=>[r.itemName,r.quantity]),[['雞尾酒巾','7'],['方巾','3']]);
 const m=f.module;assert.equal(m.receiptInventoryIdentity({},'【WARA】雞尾酒巾','洲際').itemName,'雞尾酒巾');assert.equal(m.receiptInventoryIdentity({outlet:'CLUB',sourceItem:'雞尾酒巾'},'', 'H2O').itemName,'雞尾酒巾');
 const totals=m.receiptTotalItems([{itemName:'【CLUB】方巾',actualQty:'3'},{itemName:'【CLUB】雞尾酒巾',actualQty:'0'}],'洲際');assert.equal(totals.length,1);assert.equal(totals[0].itemName,'方巾');assert.equal(totals[0].actualQty,'3');
});
