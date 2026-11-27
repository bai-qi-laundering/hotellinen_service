import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { customerOf, rowsForPeriod, statementHotelKey } from '../lib/auto-close.js';
import { signatureCoverage } from '../lib/billing-run.js';
import { statementCustomerKey } from '../lib/logistics-items.js';

const branch = globalThis.FlowerBranch;
const canonical = { hotelKeyword: '花季', deptName: 'A館 房務', building: 'A' };
const canonicalC = { hotelKeyword: '花季', deptName: 'C館 房務', building: 'C' };

function snapshot(id, data) {
    return { id, data: () => data };
}

function receipt(id, hotelKeyword, deptName, items, extra = {}) {
    return {
        id,
        data: {
            date: '2026-11-19',
            hotelKeyword,
            deptName,
            items,
            timestamp: extra.timestamp || '',
            ...extra,
        },
    };
}

test('fullwidth, halfwidth and alias labels for 花季 A館 and C館 share one identity', () => {
    const aLabels = [
        ['花季Ａ館', '房務'],
        ['花季A館', '房務'],
        ['花季', 'Ａ館 房務'],
        ['花季', 'A館 房務'],
        ['花季', 'A館房務'],
        ['花季', 'Ａ館房務部'],
        ['花季　Ａ館', '房務'],
        ['花季 A館', '房務'],
        ['花季Ａ館', ''],
        ['花季A館房務', ''],
    ];
    for (const [hotel, dept] of aLabels) assert.deepEqual(branch.identity(hotel, dept), canonical, `${hotel} / ${dept}`);
    const cLabels = [
        ['花季Ｃ館', '房務'],
        ['花季C館', '房務'],
        ['花季', 'Ｃ館 房務'],
        ['花季', 'C館 房務'],
        ['花季', 'C館房務'],
        ['花季Ｃ館', '房務部'],
        ['花季 C館', '房務'],
    ];
    for (const [hotel, dept] of cLabels) assert.deepEqual(branch.identity(hotel, dept), canonicalC, `${hotel} / ${dept}`);
    assert.equal(branch.inventoryHotel('花季Ａ館 房務'), '花季A館 房務');
    assert.equal(branch.inventoryHotel('花季Ｃ館'), '花季C館 房務');
});

test('C館 is not renamed to B館, and B館 is not folded into A or C', () => {
    assert.equal(branch.identity('花季Ｃ館', '房務').deptName, 'C館 房務');
    assert.equal(branch.identity('花季B館', '房務'), null);
    assert.equal(branch.identity('花季Ｂ館', '房務'), null);
    assert.equal(branch.identity('花季', 'B館 房務'), null);
    assert.equal(branch.identity('花季', 'Ｂ館 房務'), null);
    assert.equal(branch.batchKey('花季B館'), null);
    assert.equal(branch.batchKey('花季Ｂ館 房務'), null);
    assert.equal(statementHotelKey('花季B館'), '花季B館');
    assert.equal(statementHotelKey('花季Ｂ館'), '花季Ｂ館');
    assert.equal(branch.logisticsLookupKeywords('花季').includes('花季B館'), false);
    assert.equal(branch.logisticsLookupKeywords('花季').includes('花季Ｂ館'), false);
});

test('回洗 aliases fold together and stay out of 房務', () => {
    assert.deepEqual(branch.identity('花季Ａ館', '回洗'), { hotelKeyword: '花季', deptName: 'A館 回洗', building: 'A' });
    assert.deepEqual(branch.identity('花季', 'Ａ館 回洗'), { hotelKeyword: '花季', deptName: 'A館 回洗', building: 'A' });
    const folded = branch.collapse(new Map([
        ['a', snapshot('a', { date: '2026-11-19', hotelKeyword: '花季Ａ館', deptName: '回洗', items: [{ itemName: '浴巾', actualQty: 2 }] })],
        ['c', snapshot('c', { date: '2026-11-19', hotelKeyword: '花季', deptName: 'Ａ館 回洗', items: [{ itemName: '浴巾', actualQty: 2 }] })],
        ['room', snapshot('room', { date: '2026-11-19', hotelKeyword: '花季', deptName: 'A館 房務', items: [{ itemName: '浴巾', actualQty: 2 }] })],
    ]));
    assert.equal(folded.size, 2);
    const labels = [...folded.values()].map(doc => doc.data().deptName).sort();
    assert.deepEqual(labels, ['A館 回洗', 'A館 房務']);
    const rows = rowsForPeriod([
        receipt('a', '花季Ａ館', '回洗', [{ itemName: '浴巾', actualQty: 2 }]),
        receipt('room', '花季', 'A館 房務', [{ itemName: '浴巾', actualQty: 9 }]),
    ], '花季', '2026-10-26', '2026-11-25');
    assert.deepEqual(rows.map(row => row.qty), [9]);
    assert.equal(rows[0].hotel, '花季 A館 房務');
});

test('same-day same-building receipts fold to one and do not add quantities', () => {
    const docs = [
        receipt('half', '花季', 'A館 房務', [{ itemName: '浴巾', actualQty: 10 }, { itemName: '浴衣', actualQty: '' , originalQty: 4 }], { timestamp: '2026/11/19 上午 9:00:00' }),
        receipt('full', '花季', 'Ａ館 房務', [{ itemName: '浴巾', actualQty: 10 }], { timestamp: '2026/11/19 上午 8:00:00' }),
        receipt('alias', '花季Ａ館', '房務', [{ itemName: '浴巾', actualQty: '10' }, { itemName: '方巾', actualQty: 3 }], { timestamp: '2026/11/19 上午 7:00:00' }),
    ];
    const folded = branch.foldForBilling(docs);
    assert.equal(folded.length, 1);
    assert.equal(folded[0].data.hotelKeyword, '花季');
    assert.equal(folded[0].data.deptName, 'A館 房務');
    const qty = Object.fromEntries(folded[0].data.items.map(item => [item.itemName, branch.billedQty(item)]));
    assert.deepEqual(qty, { 浴巾: 10, 浴衣: 4, 方巾: 3 });
    const rows = rowsForPeriod(docs, '花季', '2026-10-26', '2026-11-25');
    assert.deepEqual(rows.map(row => [row.item, row.qty]), [['浴巾', 10], ['浴衣', 4], ['方巾', 3]]);
    assert.equal(rowsForPeriod(docs, '花季Ａ館', '2026-10-26', '2026-11-25').length, 0);
    assert.equal(customerOf(folded[0].data), '花季');
    const coverage = signatureCoverage(docs, '花季', '2026-10-26', '2026-11-25');
    assert.equal(coverage.signedReceiptCount + coverage.unsignedReceiptCount, 1);
});

test('quantity disagreements stop billing instead of keeping or adding a side', () => {
    const docs = [
        receipt('half', '花季', 'A館 房務', [{ itemName: '抹布', actualQty: 50 }]),
        receipt('full', '花季', 'Ａ館 房務', [{ itemName: '抹布', actualQty: '', originalQty: 52 }]),
    ];
    assert.throws(() => branch.collapse(new Map(docs.map(doc => [doc.id, snapshot(doc.id, doc.data)]))), /抹布.*50.*52.*核對/);
    assert.throws(() => rowsForPeriod(docs, '花季', '2026-10-26', '2026-11-25'), /不會把數量相加/);
    assert.throws(() => signatureCoverage(docs, '花季', '2026-10-26', '2026-11-25'), /核對/);
    const cDocs = [
        receipt('c1', '花季Ｃ館', '房務', [{ itemName: '足巾', actualQty: 12 }]),
        receipt('c2', '花季', 'C館 房務', [{ itemName: '足巾', actualQty: 13 }]),
    ];
    assert.throws(() => branch.foldForBilling(cDocs), /C館 房務「足巾」/);
});

test('a deleted alias is ignored and a deleted line does not look like a quantity conflict', () => {
    const folded = branch.foldForBilling([
        receipt('live', '花季', 'A館 房務', [{ itemName: '浴巾', actualQty: 10 }]),
        receipt('gone', '花季Ａ館', '房務', [{ itemName: '浴巾', actualQty: 99 }], { manualDeletedReceipt: true }),
        receipt('deleted-line', '花季', 'Ａ館 房務', [{ itemName: '浴巾', actualQty: 1, deletedInLogistics: true }]),
    ]);
    assert.equal(folded.length, 1);
    assert.equal(branch.billedQty(folded[0].data.items[0]), 10);
});

test('A館 and C館 do not fold into each other, and batch locks stay separate', () => {
    const rows = rowsForPeriod([
        receipt('a', '花季Ａ館', '房務', [{ itemName: '浴巾', actualQty: 10 }]),
        receipt('c', '花季Ｃ館', '房務', [{ itemName: '浴巾', actualQty: 7 }]),
    ], '花季', '2026-10-26', '2026-11-25');
    assert.deepEqual(rows.map(row => [row.hotel, row.qty]), [['花季 A館 房務', 10], ['花季 C館 房務', 7]]);
    assert.equal(branch.batchKey('花季Ａ館 房務'), '花季A館');
    assert.equal(branch.batchKey('花季Ｃ館 房務'), '花季C館');
    assert.equal(branch.batchKey('花季Ａ館 回洗'), '花季A館');
    assert.equal(branch.batchKey('花季'), null);
    assert.equal(branch.batchKey('花季 餐廳'), null);
    assert.notEqual(branch.batchKey('花季Ａ館'), branch.batchKey('花季Ｃ館'));
    assert.equal(statementHotelKey('花季Ａ館'), '花季');
    assert.equal(statementHotelKey('花季Ｃ館'), '花季');
    assert.equal(statementHotelKey('花季'), '花季');
    assert.equal(statementCustomerKey('花季Ａ館', '花季Ａ館 房務', '房務'), '花季');
    assert.equal(statementCustomerKey('花季Ｃ館', '花季Ｃ館 房務', '房務'), '花季');
    assert.equal(statementCustomerKey('花季', '花季 A館 房務', 'A館 房務'), '花季');
    const names = branch.logisticsLookupKeywords('花季');
    for (const name of ['花季', '花季A館', '花季Ａ館', '花季 C館', '花季Ｃ館']) assert.ok(names.includes(name), name);
});

test('富野 folding still flags a real quantity conflict and still ignores an unsigned copy', () => {
    const conflict = [
        snapshot('signed', { date: '2026-11-01', hotelKeyword: '富野', deptName: '汽旅 房務', clientSig: 'signed', items: [{ itemName: '床單', actualQty: 3 }] }),
        snapshot('other', { date: '2026-11-01', hotelKeyword: '富野汽旅', deptName: '房務', clientSig: 'also', items: [{ itemName: '床單', actualQty: 4 }] }),
    ];
    assert.throws(() => branch.collapse(new Map(conflict.map(doc => [doc.id, doc]))), /富野/);
    const unsigned = [
        snapshot('signed', { date: '2026-11-01', hotelKeyword: '富野', deptName: '汽旅 房務', clientSig: 'signed', items: [{ itemName: '床單', actualQty: 3 }] }),
        snapshot('draft', { date: '2026-11-01', hotelKeyword: '富野汽旅', deptName: '房務', items: [{ itemName: '床單', actualQty: 4 }] }),
    ];
    const folded = branch.collapse(new Map(unsigned.map(doc => [doc.id, doc])));
    assert.equal(folded.size, 1);
    assert.equal(Number([...folded.values()][0].data().items[0].actualQty), 3);
    const flowerUnsigned = [
        receipt('signed', '花季', 'A館 房務', [{ itemName: '浴巾', actualQty: 10 }], { clientSig: 'signed' }),
        receipt('draft', '花季Ａ館', '房務', [{ itemName: '浴巾', actualQty: 11 }]),
    ];
    assert.throws(() => branch.foldForBilling(flowerUnsigned), /花季/);
});

test('new writes use the canonical 花季 name', () => {
    assert.deepEqual(branch.canonicalWrite('花季Ａ館', '房務'), canonical);
    assert.deepEqual(branch.canonicalWrite('花季', 'Ｃ館 房務'), canonicalC);
    assert.deepEqual(branch.canonicalWrite('承億', '房務'), { hotelKeyword: '承億', deptName: '房務', building: '' });
});

test('the browser FlowerReceipts wrapper delegates to the shared module', () => {
    const context = vm.createContext({});
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    vm.runInContext(fs.readFileSync(path.join(root, 'firebase-signature/functions/lib/flower-branch.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'flower-receipts.js'), 'utf8'), context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.FlowerReceipts.identity('花季Ａ館', '房務'))), canonical);
    assert.throws(() => context.FlowerReceipts.collapse(new Map([
        ['a', snapshot('a', { date: '2026-11-19', hotelKeyword: '花季', deptName: 'A館 房務', items: [{ itemName: '浴巾', actualQty: 1 }] })],
        ['b', snapshot('b', { date: '2026-11-19', hotelKeyword: '花季Ａ館', deptName: '房務', items: [{ itemName: '浴巾', actualQty: 2 }] })],
    ])), /核對/);
});
