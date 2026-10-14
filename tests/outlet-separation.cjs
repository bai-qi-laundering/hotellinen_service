const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const base={hotel:'洲際',department:'餐廳',item:'口布',unit:'條',defaultQuantity:'',order:''};
const template=[{baseName:'洲際',deptName:'餐廳',hotel:'洲際 餐廳',item:'口布'}];
test('settings allow identical item under distinct outlets but reject a duplicate within one outlet',()=>{
 const rows=core.settings([{...base,outlet:'SEEDS'},{...base,outlet:'湛露'}],template);
 assert.deepEqual(rows.map(r=>r.outlet),['SEEDS','湛露']);
 assert.notEqual(core.submissionId('洲際','餐廳','2026-10-14','SEEDS'),core.submissionId('洲際','餐廳','2026-10-14','湛露'));
 assert.throws(()=>core.settings([{...base,outlet:'SEEDS'},{...base,outlet:'SEEDS'}],template),/重複/);
 assert.throws(()=>core.settings([{...base},{...base,outlet:'SEEDS'}],template),/不能同時啟用/);
 assert.equal(core.outletItem('湛露','口布'),'【湛露】口布');
});
test('plant receives and signs each restaurant independently under the same item name',async()=>{
 const sources={};for(const [outlet,quantity] of [['SEEDS','18'],['湛露','12']]){
  const id=core.submissionId('洲際','餐廳','2026-10-14',outlet);
  sources[id]={hotel:'洲際',department:'餐廳',inventoryHotel:'洲際 餐廳',outlet,sourceDate:'2026-10-14',targetDate:'2026-10-15',items:[{item:'口布',quantity,unit:'條'}]};
 }
 const tables={sendwash_records:sources,inventory_records:{}},inputs={};let writes=0;
 const api={doc:(_,name,id)=>({name,id}),collection:(_,name)=>({name}),where(){},query:c=>c,onSnapshot:(q,fn)=>{fn({forEach:visit=>Object.entries(tables[q.name]).forEach(([id,data])=>visit({id,data:()=>structuredClone(data)}))});return()=>{};},runTransaction:async(_,fn)=>{const pending=[];const result=await fn({get:async r=>({exists:()=>!!tables[r.name]?.[r.id],data:()=>structuredClone(tables[r.name]?.[r.id])}),set:(r,d)=>pending.push([r,d]),update:(r,d)=>pending.push([r,d])});pending.forEach(([r,d])=>{tables[r.name][r.id]={...tables[r.name][r.id],...d};writes++;});return result;}};
 const nav={children:[],dataset:{},replaceChildren(){this.children=[];},append(e){this.children.push(e)},classList:{toggle(){}}};
 const context=vm.createContext({window:{SendwashCore:core},userInputs:inputs,apiFixture:api,renderItems(){},showMessage(){},showToast(){},document:{getElementById:id=>id==='outletTabs'?nav:null,createElement:()=>({setAttribute(){}})}});
 vm.runInContext(fs.readFileSync('sendwash-verification.js','utf8').replace("await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')",'apiFixture'),context);
 context.window.setSendwashSettings(core.settings([{...base,outlet:'SEEDS'},{...base,outlet:'湛露'}],template));
 await context.window.startSendwashVerification({});await context.window.attachSendwashListener(['2026-10-15']);
 context.window.prepareSendwashInputs('2026-10-15','洲際 餐廳');
 const keys=context.window.sendwashPendingItems('2026-10-15','洲際 餐廳');assert.deepEqual([...keys],['【SEEDS】口布','【湛露】口布']);
 assert.equal(inputs['2026-10-15']['洲際 餐廳']['【SEEDS】口布'].count,'18');
 const visible=context.window.filterSendwashOutlets('2026-10-15','洲際 餐廳',['口布',...keys]);assert.deepEqual([...visible],['【SEEDS】口布']);assert.equal(nav.children[1].textContent,'湛露');
 nav.scrollLeft=170;nav.children[1].onclick();const second=context.window.filterSendwashOutlets('2026-10-15','洲際 餐廳',['口布',...keys]);assert.deepEqual([...second],['【湛露】口布']);assert.equal(nav.scrollLeft,170);
 for(const [outlet,actual] of [['SEEDS','18'],['湛露','11']]){
  const item=core.outletItem(outlet,'口布'),u=inputs['2026-10-15']['洲際 餐廳'][item];
  await context.window.persistPendingSendwash('2026-10-15','洲際 餐廳',item,{date:'2026-10-15',hotel:'洲際 餐廳',item,count:actual,doubleCount:'',signature:'signature-'+outlet,note:''},u.sendwashPending,u.sendwashLoadedCount,u.sendwashLoadedDoubleCount);
 }
 assert.equal(Object.keys(tables.inventory_records).length,2);
 const a=tables.inventory_records[core.inventoryId('2026-10-15','洲際 餐廳','【SEEDS】口布')],b=tables.inventory_records[core.inventoryId('2026-10-15','洲際 餐廳','【湛露】口布')];
 assert.equal(a.sourceItem,'口布');assert.equal(a.count,'18');assert.equal(b.count,'11');assert.equal(b.outlet,'湛露');assert.notEqual(a.signature,b.signature);
 assert(Object.values(tables.sendwash_records).every(r=>r.receivedItems.口布));assert.equal(writes,4);
});
test('driver gets one restaurant item with exact signed counts, including zero and partial second checks',async()=>{
 const code=fs.readFileSync('logistics-items.js','utf8');const module=await import('data:text/javascript,'+encodeURIComponent(code));
 const map={},keys=new Set();module.addInventoryQuantity(map,keys,'餐廳_口布',{itemName:'口布',originalQty:'18'},'SEEDS');module.addInventoryQuantity(map,keys,'餐廳_口布',{itemName:'口布',originalQty:'11'},'湛露');
 assert.equal(Object.keys(map).length,1);assert.equal(map['餐廳_口布'].originalQty,'29');
 module.addInventoryQuantity(map,keys,'餐廳_口布',{itemName:'口布',originalQty:'0'},'WARA');assert.equal(map['餐廳_口布'].originalQty,'29');
 const rows=[{hotel:'洲際',department:'餐廳',outlet:'SEEDS',targetDate:'2026-10-15',items:[{item:'口布'}],receivedItems:{口布:{signature:'a'}}},{hotel:'洲際',department:'餐廳',outlet:'湛露',targetDate:'2026-10-15',items:[{item:'口布'}]}];
 assert.deepEqual(module.unreceivedOutletItems(rows,'2026-10-15','洲際','餐廳'),['湛露／口布']);
 assert.deepEqual(module.unreceivedOutletItems(rows,'2026-10-16','洲際','餐廳'),[]);
 const log=fs.readFileSync('logistics.html','utf8');assert(log.includes('d.outlet && d.sourceItem'));assert(log.includes('addInventoryQuantity(inventoryMap'));
});
