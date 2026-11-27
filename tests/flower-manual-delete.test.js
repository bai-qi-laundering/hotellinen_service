import test from 'node:test';
import assert from 'node:assert/strict';
import '../flower-receipts.js';
const {identity,collapse}=globalThis.FlowerReceipts;
const snap=(id,data)=>({id,data:()=>data});
test('11/18 花季 A館 alias cannot reintroduce deleted logistics item',()=>{
 const date='2026-11-18';
 const deleted=snap('canonical',{date,hotelKeyword:'花季',deptName:'A館 房務',manualItemDeleted:true,
  deletedBackupItems:[{itemName:'浴巾',originalQty:'9'}],
  items:[{itemName:'床單',originalQty:'3'}]});
 const alias=snap('alias',{date,hotelKeyword:'花季Ａ館',deptName:'房務',
  items:[{itemName:'浴巾',originalQty:'9'},{itemName:'床單',originalQty:'3'}],driverSig:'signed'});
 const result=[...collapse(new Map([[alias.id,alias],[deleted.id,deleted]])).values()];
 assert.equal(result.length,1);
 const data=result[0].data();
 assert.deepEqual(data.items.map(x=>x.itemName),['床單']);
 assert.equal(data.manualItemDeleted,true);
 assert.equal(data.deletedBackupItems[0].itemName,'浴巾');
 assert.deepEqual(identity('花季Ａ館','房務'),identity('花季','A館 房務'));
});
test('a previously deleted canonical item stays hidden even when an alias still has it',()=>{
 const date='2026-11-18';
 const deleted=snap('canonical',{date,hotelKeyword:'花季',deptName:'A館 房務',items:[],
  manualDeletedReceipt:true,deletedBackupItems:[{itemName:'中毛巾',originalQty:'12'}]});
 const alias=snap('alias',{date,hotelKeyword:'花季Ａ館',deptName:'房務',
  items:[{itemName:'中毛巾',originalQty:'12'},{itemName:'浴巾',originalQty:'4'}]});
 const data=[...collapse(new Map([[alias.id,alias],[deleted.id,deleted]])).values()][0].data();
 assert.deepEqual(data.items.map(i=>i.itemName),['浴巾']);
 assert.equal(data.manualItemDeleted,true);
});
test('older partial deletion without backup uses edited receipt as authoritative',()=>{
 const date='2026-11-18';
 const edited=snap('canonical',{date,hotelKeyword:'花季',deptName:'A館 房務',manualItemDeleted:true,
  deletedBackupItems:[],items:[{itemName:'浴巾'}]});
 const alias=snap('alias',{date,hotelKeyword:'花季Ａ館',deptName:'房務',items:[{itemName:'中毛巾'},{itemName:'浴巾'}]});
 const data=[...collapse(new Map([[edited.id,edited],[alias.id,alias]])).values()][0].data();
 assert.deepEqual(data.items.map(i=>i.itemName),['浴巾']);
});
test('older whole deletion without backup suppresses alias copy',()=>{
 const date='2026-11-18';
 const deleted=snap('canonical',{date,hotelKeyword:'花季',deptName:'A館 房務',manualDeletedReceipt:true,
  deletedBackupItems:[],items:[]});
 const alias=snap('alias',{date,hotelKeyword:'花季Ａ館',deptName:'房務',items:[{itemName:'中毛巾'}]});
 const data=[...collapse(new Map([[deleted.id,deleted],[alias.id,alias]])).values()][0].data();
 assert.equal(data.manualDeletedReceipt,true);
});
test('a fully deleted alias group stays tombstoned for inventory repair',()=>{
 const date='2026-11-18',a=snap('a',{date,hotelKeyword:'花季',deptName:'C館 房務',items:[],manualDeletedReceipt:true}),
 b=snap('b',{date,hotelKeyword:'花季Ｃ館',deptName:'房務',items:[],manualDeletedReceipt:true});
 const result=[...collapse(new Map([[a.id,a],[b.id,b]])).values()];
 assert.equal(result.length,1);assert.equal(result[0].data().manualDeletedReceipt,true);
});
