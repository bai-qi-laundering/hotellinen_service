const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8'),batch=require('../inventory-batch-state.js');
test('H2O uniform date follows selected day and saving never reads or changes hotel batch state',async()=>{
 const targetCode=source.slice(source.indexOf('function getTargetDateStr('),source.indexOf('let hotelPress = null;'));
 const guardCode=source.slice(source.indexOf('window.inventoryBatchGuard=async function'),source.indexOf('// The receipt items are the same formal quantities'));
 const context={window:{},InventoryBatchState:batch,InventoryDateLock:{hotel:()=>false},
  activeBatchFor:()=>({base:'H2O',latestSignedReceiptDate:'2026-11-26',lockedDate:'2026-11-30'}),
  batchScheduleBase:x=>x,getDefaultDept:()=> '房務',deliverySchedules:[],todayHotels:['H2O'],yesterdayHotels:[],
  normalizeScheduleName:x=>x,normalizeScheduleDept:x=>x,getLocalDateString:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),
  masterData:[{baseName:'H2O',deptName:'制服',hotel:'H2O 制服'},{baseName:'H2O',deptName:'房務',hotel:'H2O 房務'}],
  db:{},doc:(_db,col,id)=>({col,id}),Date};
 vm.createContext(context);vm.runInContext(targetCode+'\n'+guardCode,context);
 assert.equal(vm.runInContext("getTargetDateStr('H2O','2026-11-28','制服')",context),'2026-11-28');
 assert.equal(vm.runInContext("getTargetDateStr('H2O','2026-11-28','房務')",context),'2026-11-30');
 let reads=0;
 const tx={get:async()=>{reads++;return {exists:()=>true,data:()=>({latestSignedReceiptDate:'2026-11-26',lockedDate:'2026-11-30'})}},set:()=>{}};
 const write=await context.window.inventoryBatchGuard(tx,'2026-11-28','H2O 制服');write();
 assert.equal(reads,0);
 await assert.rejects(context.window.inventoryBatchGuard(tx,'2026-11-28','H2O 房務'),/目前只能寫入 2026-11-30/);
 assert.equal(reads,1);
});
