import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptPatch} from '../receipt-quantity-sync.js';

test('newly counted items become formal receipt quantities even after signing', () => {
    const record={driverSig:'signed',items:[{itemName:'床單',originalQty:'4',actualQty:'4'}]};
    const patch=receiptPatch(record,'枕套','12');
    assert.equal(patch.items[1].actualQty,'12');
    assert.equal(patch.items[1].originalQty,'12');
    assert.deepEqual(record.items,[{itemName:'床單',originalQty:'4',actualQty:'4'}]);
});

test('inventory correction follows normal actual quantity but preserves back office corrections', () => {
    const normal={items:[{itemName:'床單',originalQty:'4',actualQty:'4',price:20}]};
    assert.deepEqual(receiptPatch(normal,'床單','8').items[0],{itemName:'床單',originalQty:'8',actualQty:'8',price:20});
    const corrected={items:[{itemName:'床單',originalQty:'4',actualQty:'3',price:20}]};
    assert.deepEqual(receiptPatch(corrected,'床單','8').items[0],{itemName:'床單',originalQty:'8',actualQty:'3',price:20});
});

test('deleted receipts and deliberately removed items stay removed', () => {
    assert.equal(receiptPatch({manualDeletedReceipt:true},'床單','8'),null);
    assert.equal(receiptPatch({manualItemDeleted:true,items:[]},'床單','8'),null);
});
