import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignInventoryHotel, inventoryBases, sameDepartment } from '../hotel-match.js';

const bases = inventoryBases('花季', [
    { baseName: '花季' },
    { baseName: '花季Ａ館' },
    { baseName: '花季Ｃ館' },
    { baseName: '日航' },
    { baseName: '日航休閒中心' },
    { baseName: '承億' },
    { baseName: '承億休閒' },
    { baseName: 'H2O' },
]);

test('較短的飯店不會吞掉名稱開頭相同的另一家', () => {
    assert.deepEqual(assignInventoryHotel('花季 房務', bases), { base: '花季', dept: '房務' });
    assert.deepEqual(assignInventoryHotel('花季Ａ館 房務', bases), { base: '花季Ａ館', dept: '房務' });
    assert.deepEqual(assignInventoryHotel('花季Ｃ館', bases), { base: '花季Ｃ館', dept: '房務' });
    assert.deepEqual(assignInventoryHotel('日航休閒中心 房務', bases), { base: '日航休閒中心', dept: '房務' });
    assert.deepEqual(assignInventoryHotel('日航 房務', bases), { base: '日航', dept: '房務' });
    assert.deepEqual(assignInventoryHotel('承億休閒 房務', bases), { base: '承億休閒', dept: '房務' });
    assert.deepEqual(assignInventoryHotel('H2O 西餐', bases), { base: 'H2O', dept: '西餐' });
    assert.equal(assignInventoryHotel('花季Ａ館 房務', bases).base === '花季', false);
});

test('範本還沒到時，不把黏在一起的較長店名算進這一家', () => {
    const only = inventoryBases('花季', []);
    assert.deepEqual(assignInventoryHotel('花季 房務', only, { allowGlued: false }), { base: '花季', dept: '房務' });
    assert.equal(assignInventoryHotel('花季Ａ館 房務', only, { allowGlued: false }), null);
    assert.deepEqual(assignInventoryHotel('花季房務', only), { base: '花季', dept: '房務' });
});

test('部門只接受同一個名字，不拿「房」去對上「房務」以外的部門', () => {
    assert.equal(sameDepartment('房務', '房務部'), true);
    assert.equal(sameDepartment('西餐', '中餐'), false);
    assert.equal(sameDepartment('房', '房務'), false);
});

test('簽收頁與布品登記不再用包含關係選飯店', () => {
    const logistics = readFileSync(new URL('../logistics.html', import.meta.url), 'utf8');
    const inventory = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(logistics, /assignInventoryHotel/);
    assert.equal(logistics.includes('hotelStr.includes(currentHotel)'), false);
    assert.match(inventory, /data-hotel=/);
    assert.equal(inventory.includes("onclick=\"goToHotel("), false);
    assert.match(inventory, /pointerdown/);
});
