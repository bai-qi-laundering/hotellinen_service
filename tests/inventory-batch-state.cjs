const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({module:{exports:{}},Date});
vm.runInContext(fs.readFileSync('inventory-batch-state.js','utf8'),context);
const batch=context.module.exports;
const plain=value=>JSON.parse(JSON.stringify(value));

test('one physical hotel state covers 花季 A/C and all its departments',()=>{
 assert.equal(batch.key('花季Ａ館 房務'),'花季');
 assert.equal(batch.key('花季 C館 制服'),'花季');
 assert.equal(batch.key('承億休閒'),'承億');
 assert.equal(batch.key('承億健身房'),'承億');
 assert.equal(batch.key('日航休閒中心'),'日航');
 assert.equal(batch.key('日航休閒'),'日航');
 assert.equal(batch.key('捷中正 房務'),'捷中正房務');
});
test('the next daily previous-day document follows the signed receipt',()=>{
 const target=day=>batch.day(new Date(new Date(day+'T12:00:00').getTime()-86400000).toISOString());
 assert.equal(batch.nextDate('2026-11-21',target),'2026-11-22');
});
test('daily schedule advances only once after the signed receipt',()=>{
 const target=day=>batch.day(new Date(new Date(day+'T12:00:00').getTime()+86400000).toISOString());
 assert.equal(batch.nextDate('2026-11-24',target),'2026-11-25');
});
test('fixed delivery schedule can still choose a later valid day',()=>{
 const target=day=>day==='2026-11-24'?'2026-11-26':'2026-11-28';
 assert.equal(batch.nextDate('2026-11-24',target),'2026-11-26');
});
test('one signature advances once; the other signature on the same car does not unlock',()=>{
 const first=batch.signedPatch(null,{date:'2026-11-23',id:'receipt-A'},1);
 assert.deepEqual(plain(first),{latestSignedReceiptDate:'2026-11-23',latestSignedReceiptId:'receipt-A',lockedDate:'',updatedAt:1});
 assert.equal(batch.signedPatch({...first,lockedDate:'2026-11-24'},{date:'2026-11-23',id:'receipt-B'},2),null);
 assert.equal(batch.signedPatch(first,{date:'2026-11-22',id:'older'},2),null);
 assert.equal(batch.signedPatch({...first,lockedDate:'2026-11-24'},{date:'2026-11-24',id:'next'},3).lockedDate,'');
});
test('the first save locks; a stale device cannot write yesterday after another receipt',()=>{
 const target=day=>day;
 const state={latestSignedReceiptDate:'2026-11-22',lockedDate:''};
 assert.equal(batch.validate(state,'2026-11-23',target).lockedDate,'2026-11-23');
 assert.equal(batch.validate({...state,lockedDate:'2026-11-23'},'2026-11-23',target),null);
 assert.throws(()=>batch.validate({...state,latestSignedReceiptDate:'2026-11-23'},'2026-11-23',target),/目前只能寫入 2026-11-24/);
 assert.throws(()=>batch.validate(null,'2026-11-23',target),/尚未建立已簽收批次/);
});
test('receipt and all inventory save routes use the shared state',()=>{
 const sign=fs.readFileSync('logistics.html','utf8'),inventory=fs.readFileSync('index.html','utf8'),sendwash=fs.readFileSync('sendwash-verification.js','utf8');
 assert.match(sign,/const batchSnapshot=needsBatch\?await tx\.get\(batchRef\)/);
 assert.match(sign,/if\(patch\)tx\.set\(batchRef,patch/);
 assert.match(inventory,/window\.inventoryBatchGuard\(tx,dateStr,category\)/);
 assert.match(inventory,/if\(InventoryDateLock\.hotel\(hotel\)\)return \(\)=>\{\}/);
 assert.match(sendwash,/window\.inventoryBatchGuard\(tx,date,hotel\)/);
});
