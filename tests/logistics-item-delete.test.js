import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {wasManuallyDeleted,mergeReceiptAfterDeletion} from '../logistics-items.js';

test('a removed inventory item remains absent when logistics reloads it', () => {
 const receipt={manualItemDeleted:true,items:[{itemName:'浴巾',originalQty:'8',actualQty:'8'}],
  deletedBackupItems:[{itemName:'床單',inventoryItemName:'床單',originalQty:'5'}]};
 const fromInventory=[{itemName:'床單',originalQty:'5'}, {itemName:'浴巾',originalQty:'8'}];
 assert.deepEqual(fromInventory.filter(item=>!wasManuallyDeleted(receipt,item)).map(item=>item.itemName),['浴巾']);
 assert.equal(wasManuallyDeleted({...receipt,manualItemDeleted:false},fromInventory[0]),false);
 assert.throws(()=>mergeReceiptAfterDeletion(receipt,fromInventory),/後台刪除/);
 assert.deepEqual(mergeReceiptAfterDeletion(receipt,[{itemName:'浴巾',originalQty:'8',actualQty:'8',loadedActualQty:'8'}]).map(i=>i.itemName),['浴巾']);
});
test('a manually removed whole receipt cannot be signed from stale inventory', () => {
 assert.throws(()=>mergeReceiptAfterDeletion({manualDeletedReceipt:true,items:[]},[{itemName:'床單'}]),/後台刪除/);
});
test('logistics screen applies deletion marks on reload and on both signing paths', () => {
 const html=fs.readFileSync(new URL('../logistics.html',import.meta.url),'utf8');
 assert.match(html,/wasManuallyDeleted\(savedDept, invItem\)\) continue/);
 assert.match(html,/manuallyDeletedDepts\.has\(invItem\.deptName\)\) continue/);
 assert.equal((html.match(/mergeReceiptAfterDeletion\(/g)||[]).length,3);
 assert.equal(html.includes('mergeSignedItems('),false);
});
