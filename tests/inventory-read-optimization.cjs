const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const loadBrowserModule=file=>{const context=vm.createContext({module:{exports:{}}});vm.runInContext(fs.readFileSync(file,'utf8'),context);return context.module.exports;};
const progress=loadBrowserModule('inventory-progress.js'),lock=loadBrowserModule('inventory-date-lock.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const names=['床單','被套','枕套','浴巾','抹布','浴袍'];
const batch=(date='2026-11-23')=>names.map(item=>({date,hotel:'喜達絲 房務',item,count:'0',doubleCount:'0',doubleSignature:'sig',doubleSignDate:'2026-11-22 12:00:00'}));
function fixture(){
 const targets=[],writes=[];let stops=0;
 const api={collection:(_,name)=>({name}),where:(field,op,value)=>({field,op,value}),query:(collection,...filters)=>({collection,filters}),onSnapshot:(query,...args)=>{const [callback,error]=typeof args[0]==='function'?args:[args[1],args[2]];const target={query,callback,error,stopped:false};targets.push(target);return()=>{target.stopped=true;stops++;};},writeBatch:()=>({set:(ref,data,options)=>writes.push({ref,data,options}),commit:async()=>{}})};
 const emit=(target,rows)=>target.callback({metadata:{fromCache:false,hasPendingWrites:false},docs:rows.map((row,i)=>({id:''+i,ref:'ref'+i,data:()=>row}))});
 return {api,targets,writes,emit,get stops(){return stops;}};
}
test('dashboard includes 床單 through 抹布 and accepts zero rechecks',()=>{
 assert.deepEqual(plain(progress.required(names)),names.slice(0,5));
 assert.equal(progress.completed(batch(),progress.required(names)),'2026-11-22');
 assert.equal(progress.completed(batch().filter(r=>r.item!=='床單'),progress.required(names)),'');
 const rows=batch();rows[0].doubleCount='';assert.equal(progress.completed(rows,progress.required(names)),'');
});
test('dashboard watches selected batch even when rechecks happen on another day',()=>{
 const f=fixture();let lit;
 const stop=progress.watch(f.api,{},'2026-11-22',[{base:'喜達絲',hotel:'喜達絲 房務',batchDate:'2026-11-23',room:true,items:names}],value=>lit=value);
 assert.deepEqual(plain(f.targets[0].query.filters.map(x=>[x.field,x.op,x.value])),[['date','in',['2026-11-23']]]);
 const mixed=batch();mixed[0].doubleSignDate='2026-11-21 23:00:00';f.emit(f.targets[0],mixed);assert(lit.has('喜達絲'));
 f.emit(f.targets[0],batch('2026-11-22'));assert(!lit.has('喜達絲'),'a completed older batch cannot light the selected batch');
 const broken=mixed.map(r=>r.item==='床單'?{...r,doubleSignature:''}:r);f.emit(f.targets[0],broken);assert(!lit.has('喜達絲'));
 f.emit(f.targets[0],[...mixed,batch('2026-11-22')[0]]);assert(lit.has('喜達絲'));
 f.emit(f.targets[0],[]);assert.equal(lit.size,0);
 stop();f.emit(f.targets[0],mixed);assert.equal(lit.size,0);assert(f.targets[0].stopped);
});
test('all-item departments include temporary recorded items before lighting',()=>{
 const f=fixture();let lit;
 const stop=progress.watch(f.api,{},'2026-11-22',[{base:'餐廳',hotel:'餐廳 餐飲',batchDate:'2026-11-23',room:false,items:['口布']}],value=>lit=value);
 const row={date:'2026-11-23',hotel:'餐廳 餐飲',item:'口布',doubleCount:'0',doubleSignature:'sig',doubleSignDate:'2026-11-22 12:00:00'};
 f.emit(f.targets[0],[row,{...row,item:'臨時布品',doubleSignature:''}]);assert(!lit.has('餐廳'));
 f.emit(f.targets[0],[row,{...row,item:'臨時布品'}]);assert(lit.has('餐廳'));
 stop();
});
test('喜達絲 only explicit records lock; 床單 through 抹布 release without signatures',async()=>{
 const f=fixture();let date;
 const config=names.map(item=>({hotel:'喜達絲 房務',item}));
 const controller=lock.watch(f.api,{},config,d=>date=d);
 assert.deepEqual(f.targets[0].query.filters,[{field:'inventoryDateLockActive',op:'==',value:true}]);
 const first={...batch()[0],inventoryDateLockActive:true,inventoryDateLockEnteredAt:10,doubleSignature:''};
 f.emit(f.targets[0],[first]);assert.equal(f.targets.length,2);
 f.emit(f.targets[1],[first]);await controller.ready;assert.equal(date,'2026-11-23');
 assert.equal(f.writes.length,0);
 f.emit(f.targets[1],batch().map(r=>({...r,doubleSignature:'',doubleSignDate:'',doubleCount:''})));
 assert.equal(date,'');assert.equal(f.writes.length,1);
 assert.deepEqual(plain(f.writes[0].data),{inventoryDateLockActive:false});
 assert.deepEqual(plain(f.writes[0].options),{merge:true});
 assert(!JSON.stringify(f.targets).includes('logistics_records'));
 controller.stop();assert(f.targets.every(t=>t.stopped));
});
test('all required items are necessary; imported quantities alone do not start a lock',()=>{
 assert.equal(lock.date(batch(),batch(),names),'');
 assert(!lock.covered(batch().filter(r=>r.item!=='床單'),lock.required(names)));
 assert(lock.covered(batch().filter(r=>r.item!=='浴袍'),lock.required(names)));
});
test('production page scopes detail and sendwash to selected hotel/date, without a ten-day preload',()=>{
 const html=fs.readFileSync('index.html','utf8'),sendwash=fs.readFileSync('sendwash-verification.js','utf8');
 assert(!html.includes('offset = -2'));
 assert.match(html,/where\("date", "in", dates\), where\('hotel','==',hotel\)/);
 assert.match(sendwash,/where\('inventoryHotel','==',inventoryHotel\)/);
 assert(!html.includes("query(collection(db,'logistics_records'),where('hotelKeyword','==','喜達絲'))"));
});
test('ordinary logistics lookup reads only receipts and leaves signed quantities intact',async()=>{
 const source=fs.readFileSync('boss_admin.html','utf8');
 const body=source.slice(source.indexOf('window.loadLogData = async function()'),source.indexOf('let outletCorrectionDialog')).replace(/;\s*$/,'');
 const raw=[{id:'signed',date:'2026-11-22',hotelKeyword:'喜達絲',deptName:'房務',clientSig:'client-image',driverSig:'driver-image',items:[{itemName:'床單',originalQty:'100',actualQty:'97'}]}, {id:'unsigned',date:'2026-11-22',hotelKeyword:'鉑麗',deptName:'房務',items:[{itemName:'浴巾',originalQty:'0',actualQty:'2'}]}];
 const before=JSON.stringify(raw),queries=[],elements={};
 for(const [id,value]of Object.entries({logStartDate:'2026-11-01',logEndDate:'2026-11-22',logFetchHotel:''}))elements[id]={value};
 elements.logTableBody={};elements.logLoadBtn={};
 const context={window:{},document:{getElementById:id=>elements[id]},ensureMasterData:async()=>{},loadDriverSchedule:async()=>{},readAdminPeriod:async(name)=>{queries.push(name);assert.equal(name,'logistics_records');return[{forEach:cb=>raw.forEach(r=>cb({id:r.id,data:()=>r}))}];},latestInvRawDataMap:{},deletedReceiptTombstones:new Map(),FlowerReceipts:{collapse:m=>m},logRecords:[],standardizeDate:d=>d,isRestaurantDept:()=>false,uniqueLogItems:x=>x,planDriverWritebacks:()=>[],driverScheduleContext:()=>({}),getItemSortIndex:()=>0,populateLogDropdowns(){},applyLogFilters(){},showToast(){},lastLogFetchKey:'',console};
 vm.createContext(context);vm.runInContext(body,context);await context.window.loadLogData();
 assert.equal(JSON.stringify(raw),before);assert.deepEqual(queries,['logistics_records']);
 assert.equal(context.logRecords[0].clientSig,'client-image');assert.equal(context.logRecords[0].driverSig,'driver-image');
 assert.equal(context.logRecords[0].items[0].bqQty,'100');assert.equal(context.logRecords[0].items[0].actualQty,'97');
 assert.equal(context.logRecords[1].items[0].actualQty,'2');assert(!elements.logTableBody.innerHTML.includes('讀取失敗'));
});
