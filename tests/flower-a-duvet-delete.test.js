import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../flower-receipts.js';
import {wasManuallyDeleted} from '../logistics-items.js';
const {collapse}=globalThis.FlowerReceipts;
const code=fs.readFileSync(new URL('../boss_admin.html',import.meta.url),'utf8');
const block=code.slice(code.indexOf('window.deleteLogItem = async function'),code.indexOf('window.restoreLogItemsFromInv = async function')).split('        // ★ 3.')[0];
const row=(id,data)=>({id,ref:{id},exists:()=>!!data,data:()=>structuredClone(data)});
function freshView(docs){
 const collapsed=[...collapse(new Map([...docs].map(([id,data])=>[id,row(id,data)]))).values()];
 const receipt=collapsed.find(x=>!x.data().manualDeletedReceipt)?.data();
 return receipt ? (receipt.items || []).map(item=>item.itemName) : [];
}
test('11/18 花季A館 羽被 delete, refresh, and inventory reload',async()=>{
 const date='2026-11-18',item='羽被';
 const docs=new Map([
  ['2026-11-18_花季_A館 房務',{date,hotelKeyword:'花季',deptName:'A館 房務',items:[{itemName:item,inventoryItemName:item,originalQty:'3',actualQty:'3'},{itemName:'浴巾',originalQty:'2',actualQty:'2'}]}],
  ['2026-11-18_花季Ａ館_房務',{date,hotelKeyword:'花季Ａ館',deptName:'房務',items:[{itemName:item,originalQty:'3',actualQty:'3'},{itemName:'浴巾',originalQty:'2',actualQty:'2'}],driverSig:'old'}]
 ]);
 const localRecord={id:'2026-11-18_花季Ａ館_房務',date,hotelKeyword:'花季',deptName:'A館 房務',hotel:'花季 A館 房務',items:[{itemName:item,inventoryItemName:item,bqQty:'3',actualQty:'3'},{itemName:'浴巾',bqQty:'2',actualQty:'2'}],driverSig:'old'};
 const ctx={window:{},db:{},logRecords:[localRecord],openLogDetailDocIds:new Set(),deletedReceiptTombstones:new Map(),customConfirm:async()=>true,customAlert:async msg=>{throw Error(msg)},
  FlowerReceipts:globalThis.FlowerReceipts,doc:(_db,_col,id)=>({id}),readAdminPeriod:async()=>[[...docs].map(([id,data])=>row(id,data))],standardizeDate:x=>x,normalizedLogItemName:x=>String(x||'').normalize('NFKC').replace(/\s+/g,''),getLocalTimeString:()=>date,populateLogDropdowns:()=>{},applyLogFilters:()=>{},showToast:()=>{},console,
  runTransaction:async(_db,fn)=>{const patches=[];await fn({get:async ref=>row(ref.id,docs.get(ref.id)),set:(ref,data)=>patches.push([ref.id,data])});for(const [id,patch] of patches)docs.set(id,{...docs.get(id),...patch})}
 };
 vm.createContext(ctx);vm.runInContext(block,ctx);
 await ctx.window.deleteLogItem(localRecord.id,item,'',item,null);
 assert.deepEqual(freshView(docs),['浴巾']);
 assert.deepEqual([...docs.values()].map(d=>d.items.map(i=>i.itemName)),[['浴巾'],['浴巾']]);
 const receipt=[...collapse(new Map([...docs].map(([id,data])=>[id,row(id,data)]))).values()][0].data();
 assert.equal(wasManuallyDeleted(receipt,{itemName:item}),true);
});
test('existing 11/18 deletion marker without backup still hides 羽被 from a second alias',()=>{
 const date='2026-11-18';
 const docs=new Map([
 ['canonical',{date,hotelKeyword:'花季',deptName:'A館 房務',manualItemDeleted:true,deletedBackupItems:[],items:[{itemName:'浴巾'}]}],
 ['alias',{date,hotelKeyword:'花季Ａ館',deptName:'房務',items:[{itemName:'羽被'},{itemName:'浴巾'}]}]
 ]);
 assert.deepEqual(freshView(docs),['浴巾']);
});
