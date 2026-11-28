import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../flower-receipts.js';
const code=fs.readFileSync(new URL('../boss_admin.html',import.meta.url),'utf8');
const start=code.indexOf('window.deleteLogItem = async function');
const end=code.indexOf('window.restoreLogItemsFromInv = async function',start);
const block=code.slice(start,end).split('        // ★ 3.')[0];

test('11/18 花季 aliases are both updated in one delete and stay absent on refresh',async()=>{
 const date='2026-11-18',target='中毛巾';
 const docs=new Map([
  ['canonical',{date,hotelKeyword:'花季',deptName:'A館 房務',items:[{itemName:target,originalQty:'8'},{itemName:'浴巾',originalQty:'2'}]}],
  ['alias',{date,hotelKeyword:'花季Ａ館',deptName:'房務',items:[{itemName:target,originalQty:'8'},{itemName:'浴巾',originalQty:'2'}],driverSig:'signed'}]
 ]);
 const snap=id=>({id,ref:{id},exists:()=>docs.has(id),data:()=>structuredClone(docs.get(id))});
 const localRecord={id:'canonical',date,hotelKeyword:'花季',deptName:'A館 房務',hotel:'花季 A館 房務',
  items:[{itemName:target,bqQty:'8',actualQty:'8'},{itemName:'浴巾',bqQty:'2',actualQty:'2'}],driverSig:'signed',clientSig:'signed'};
 const context={window:{},db:{},logRecords:[localRecord],openLogDetailDocIds:new Set(),deletedReceiptTombstones:new Map(),
  customConfirm:async()=>true,customAlert:async msg=>{throw new Error(msg)},
  FlowerReceipts:globalThis.FlowerReceipts,doc:(_db,_collection,id)=>({id}),
  readAdminPeriod:async()=>[[...docs.keys()].map(snap)],standardizeDate:x=>x,
  normalizedLogItemName:x=>String(x||'').normalize('NFKC').replace(/\s+/g,''),
  getLocalTimeString:()=>date,populateLogDropdowns:()=>{},applyLogFilters:()=>{},showToast:()=>{},console,
  runTransaction:async(_db,callback)=>{
   const pending=[];
   await callback({get:async ref=>snap(ref.id),set:(ref,data)=>pending.push([ref.id,data])});
   for(const [id,patch] of pending)docs.set(id,{...docs.get(id),...patch});
  }
 };
 vm.createContext(context);vm.runInContext(block,context);
 await context.window.deleteLogItem('canonical',target,'','',null);
 for(const doc of docs.values()){
  assert.deepEqual(doc.items.map(i=>i.itemName),['浴巾']);
  assert.equal(doc.manualItemDeleted,true);
  assert.equal(doc.deletedBackupItems[0].itemName,target);
 }
 const collapsed=[...globalThis.FlowerReceipts.collapse(new Map([...docs].map(([id,data])=>[id,{id,data:()=>data}]))).values()][0].data();
 assert.deepEqual(collapsed.items.map(i=>i.itemName),['浴巾']);
});
