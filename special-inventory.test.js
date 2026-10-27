import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryCatalog, inventoryDocId, buildInventoryWrites, INVENTORY_NOTE } from './special-inventory.js';

const template = [
    { baseName: '驛館', deptName: '房務', hotel: '驛館 房務', item: '床單' },
    { baseName: '驛館', deptName: '回洗', hotel: '驛館 回洗', item: '床單' },
    { baseName: '驛館', deptName: '回洗', hotel: '驛館 回洗', item: '羽毛被' },
    { baseName: '驛館', deptName: '特處', hotel: '驛館 特處', item: '特處床單' },
    { baseName: '驛館', deptName: '特處', hotel: '驛館 特處', item: '頭套/頭巾' },
    { baseName: '好六', deptName: '特處', hotel: '好六 特處', item: '特處被套' },
];

const catalog = inventoryCatalog(template);
const yiguan = catalog.get('驛館');

test('suggestions list each hotel item once, with 特處 names first', () => {
    assert.deepEqual(yiguan.names, ['特處床單', '頭套/頭巾', '床單', '羽毛被']);
    assert.deepEqual(catalog.get('好六').names, ['特處被套']);
    assert.equal(catalog.has('好七'), false);
});

test('doc id matches index.html, including the slash replacement', () => {
    assert.equal(inventoryDocId('2026-10-29', '驛館 特處', '頭套/頭巾'), '2026-10-29_驛館 特處_頭套-頭巾');
});

test('same sheet sums rows that land on one 盤點 item and keeps the other', () => {
    const writes = buildInventoryWrites([
        { id: 'a', officeName: '特處床單', qty: 2, shipDate: '2026-10-29' },
        { id: 'b', officeName: ' 特處床單 ', qty: 3, shipDate: '2026-10-29' },
        { id: 'c', officeName: '床單', qty: 1, shipDate: '2026-10-29' },
    ], yiguan, { signature: 'sig-office', timestamp: '2026/10/27 下午4:00:00' });
    assert.deepEqual(writes, [
        {
            id: '2026-10-29_驛館 特處_特處床單',
            date: '2026-10-29',
            hotel: '驛館 特處',
            item: '特處床單',
            count: '5',
            signature: 'sig-office',
            note: INVENTORY_NOTE,
            timestamp: '2026/10/27 下午4:00:00',
        },
        {
            id: '2026-10-29_驛館 房務_床單',
            date: '2026-10-29',
            hotel: '驛館 房務',
            item: '床單',
            count: '1',
            signature: 'sig-office',
            note: INVENTORY_NOTE,
            timestamp: '2026/10/27 下午4:00:00',
        },
    ]);
});

test('a 特處 name is written to the 特處 department, and a slash stays in the item', () => {
    const writes = buildInventoryWrites([
        { id: 'd', officeName: '頭套/頭巾', qty: 4, shipDate: '2026-10-29' },
    ], yiguan, { signature: 'sig', timestamp: 't' });
    assert.equal(writes[0].id, '2026-10-29_驛館 特處_頭套-頭巾');
    assert.equal(writes[0].hotel, '驛館 特處');
    assert.equal(writes[0].item, '頭套/頭巾');
    assert.equal(writes[0].count, '4');
});

test('a name that is not on that hotel blocks the whole sheet', () => {
    assert.throws(() => buildInventoryWrites([
        { id: 'ok', officeName: '特處床單', qty: 1, shipDate: '2026-10-29' },
        { id: 'bad', officeName: '特處床單單', qty: 1, shipDate: '2026-10-29' },
    ], yiguan, { signature: 'sig', timestamp: 't' }), error => {
        assert.equal(error.message, '品名和盤點不一致');
        assert.deepEqual(error.ids, ['bad']);
        return true;
    });
});

test('an unknown hotel has no valid names', () => {
    assert.throws(() => buildInventoryWrites([
        { id: 'x', officeName: '特處床單', qty: 1, shipDate: '2026-10-29' },
    ], catalog.get('好七'), { signature: 'sig', timestamp: 't' }), /品名和盤點不一致/);
});

test('send still requires a signature and a time', () => {
    const line = [{ id: 'a', officeName: '特處床單', qty: 1, shipDate: '2026-10-29' }];
    assert.throws(() => buildInventoryWrites(line, yiguan, { timestamp: 't' }), /簽名/);
    assert.throws(() => buildInventoryWrites(line, yiguan, { signature: 'sig' }), /時間/);
});
