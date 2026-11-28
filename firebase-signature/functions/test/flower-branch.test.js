import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { customerOf, rowsForPeriod, statementHotelKey } from '../lib/auto-close.js';
import { dueHotelKeywords } from '../lib/billing-schedule.js';
import { signatureCoverage } from '../lib/billing-run.js';
import { statementCustomerKey } from '../lib/logistics-items.js';
import { catalogPrice } from '../lib/price-catalog.js';

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

test('quantity disagreements keep the signed halfwidth receipt and warn instead of stopping', () => {
    const docs = [
        receipt('alias', '花季Ａ館', '房務', [{ itemName: '抹布', actualQty: 52 }], { driverSig: 'later', timestamp: '2026-11-11 18:00:00' }),
        receipt('half', '花季', 'A館 房務', [{ itemName: '抹布', actualQty: 50 }], { clientSig: 'signed', timestamp: '2026-11-11 08:00:00' }),
        receipt('full', '花季', 'Ａ館 房務', [{ itemName: '抹布', actualQty: '', originalQty: 52 }], { driverSig: 'also' }),
    ];
    const folded = branch.foldForBilling(docs);
    assert.equal(folded.length, 1);
    assert.equal(folded[0].id, 'half');
    assert.equal(branch.billedQty(folded[0].data.items[0]), 50);
    assert.equal(rowsForPeriod(docs, '花季', '2026-10-26', '2026-11-25').reduce((sum, row) => sum + row.qty, 0), 50);
    assert.equal(signatureCoverage(docs, '花季', '2026-10-26', '2026-11-25').signedReceiptCount, 1);
    const warnings = branch.quantityWarnings;
    assert.ok(warnings.some(warning => warning.date === '2026-11-19' && warning.building === 'A' && warning.item === '抹布' && warning.keptQty === 50 && warning.otherQty === 52));
    const unsignedMain = [
        receipt('draft-main', '花季', 'A館 房務', [{ itemName: '浴巾', actualQty: 10 }]),
        receipt('signed-alias', '花季Ａ館', '房務', [{ itemName: '浴巾', actualQty: 11 }], { driverSig: 'signed' }),
    ];
    const picked = branch.foldForBilling(unsignedMain);
    assert.equal(picked[0].id, 'signed-alias');
    assert.equal(branch.billedQty(picked[0].data.items[0]), 11);
    const cDocs = [
        receipt('c1', '花季Ｃ館', '房務', [{ itemName: '足巾', actualQty: 12 }]),
        receipt('c2', '花季', 'C館 房務', [{ itemName: '足巾', actualQty: 13 }], { clientSig: 'signed' }),
    ];
    const cFolded = branch.foldForBilling(cDocs);
    assert.equal(cFolded[0].id, 'c2');
    assert.equal(branch.billedQty(cFolded[0].data.items[0]), 13);
    assert.ok(branch.quantityWarnings.some(warning => warning.building === 'C' && warning.item === '足巾' && warning.keptQty === 13 && warning.otherQty === 12));
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
    const flowerFolded = branch.foldForBilling(flowerUnsigned);
    assert.equal(flowerFolded[0].id, 'signed');
    assert.equal(branch.billedQty(flowerFolded[0].data.items[0]), 10);
    assert.ok(branch.quantityWarnings.some(warning => warning.keptQty === 10 && warning.otherQty === 11));
});

test('new writes use the canonical 花季 name', () => {
    assert.deepEqual(branch.canonicalWrite('花季Ａ館', '房務'), canonical);
    assert.deepEqual(branch.canonicalWrite('花季', 'Ｃ館 房務'), canonicalC);
    assert.deepEqual(branch.canonicalWrite('承億', '房務'), { hotelKeyword: '承億', deptName: '房務', building: '' });
});

test('承億健身房、承億休閒 and 日航休閒中心 share the parent hotel and department', () => {
    const gym = { hotelKeyword: '承億', deptName: '健身房', building: '' };
    const leisure = { hotelKeyword: '承億', deptName: '休閒', building: '' };
    const nikkatsu = { hotelKeyword: '日航', deptName: '休閒中心', building: '' };
    const special = { hotelKeyword: '日航', deptName: '休閒中心 特處', building: '' };
    for (const [hotel, dept] of [
        ['承億健身房', '健身房'],
        ['承億', '健身房 健身房'],
        ['承億', '健身房'],
        ['承億　健身房', '健身房'],
        ['承億健身房 健身房', ''],
    ]) assert.deepEqual(branch.identity(hotel, dept), gym, `${hotel} / ${dept}`);
    for (const [hotel, dept] of [
        ['承億休閒', '休閒'],
        ['承億', '休閒 休閒'],
        ['承億', '休閒'],
        ['承億休閒 休閒', ''],
    ]) assert.deepEqual(branch.identity(hotel, dept), leisure, `${hotel} / ${dept}`);
    for (const [hotel, dept] of [
        ['日航休閒中心', '休閒中心'],
        ['日航休閒', '休閒中心'],
        ['日航', '休閒中心 休閒中心'],
        ['日航', '休閒中心'],
        ['日航休閒中心 休閒中心', ''],
    ]) assert.deepEqual(branch.identity(hotel, dept), nikkatsu, `${hotel} / ${dept}`);
    for (const [hotel, dept] of [
        ['日航休閒中心', '特處'],
        ['日航', '休閒中心 特處'],
        ['日航休閒中心 特處', ''],
    ]) assert.deepEqual(branch.identity(hotel, dept), special, `${hotel} / ${dept}`);
    for (const [hotel, dept] of [
        ['承億', '房務'],
        ['承億', '藝術'],
        ['日航', '特處'],
        ['日航', '房務'],
        ['巨蛋一般', '一般處理'],
        ['巨蛋', '一般 一般處理'],
    ]) assert.equal(branch.identity(hotel, dept), null, `${hotel} / ${dept}`);
    assert.equal(branch.inventoryHotel('承億健身房 健身房'), '承億 健身房');
    assert.equal(branch.inventoryHotel('承億休閒 休閒'), '承億 休閒');
    assert.equal(branch.inventoryHotel('日航休閒中心 休閒中心'), '日航 休閒中心');
    assert.equal(branch.inventoryHotel('日航休閒中心 特處'), '日航 休閒中心 特處');
    assert.equal(branch.inventoryHotel('日航 特處'), '日航 特處');
    assert.equal(branch.batchKey('承億健身房 健身房'), '承億');
    assert.equal(branch.batchKey('日航休閒中心 特處'), '日航');
    assert.equal(branch.batchKey('日航 特處'), null);
    assert.deepEqual(branch.canonicalWrite('承億健身房', '健身房'), gym);
    assert.deepEqual(branch.canonicalWrite('日航', '休閒中心 特處'), special);
    assert.deepEqual(branch.canonicalWrite('日航', '特處'), { hotelKeyword: '日航', deptName: '特處', building: '' });
    assert.equal(statementHotelKey('承億健身房'), '承億');
    assert.equal(statementHotelKey('承億休閒'), '承億');
    assert.equal(statementHotelKey('日航休閒中心'), '日航');
    assert.equal(statementHotelKey('日航休閒'), '日航');
    assert.equal(statementHotelKey('承億'), '承億');
    assert.equal(statementCustomerKey('承億健身房', '承億健身房 健身房', '健身房'), '承億');
    assert.equal(statementCustomerKey('日航休閒中心', '日航休閒中心 休閒中心', '休閒中心'), '日航');
    assert.ok(branch.logisticsLookupKeywords('承億').includes('承億健身房'));
    assert.ok(branch.logisticsLookupKeywords('承億').includes('承億休閒'));
    assert.ok(branch.logisticsLookupKeywords('日航').includes('日航休閒中心'));
    assert.equal(branch.logisticsLookupKeywords('巨蛋'), null);
    assert.deepEqual(dueHotelKeywords(['承億', '承億健身房', '承億休閒', '日航', '日航休閒中心'], {
        承億健身房: '25th', 承億休閒: '25th', 日航休閒中心: 'month',
    }, '25th'), ['承億']);
    assert.deepEqual(dueHotelKeywords(['承億', '承億健身房', '承億休閒', '日航', '日航休閒中心'], {
        承億健身房: '25th', 承億休閒: '25th', 日航休閒中心: 'month',
    }, 'month'), ['日航']);
});

test('same-day department aliases fold without adding, and a quantity mismatch keeps the signed main receipt', () => {
    const docs = [
        receipt('signed', '承億', '健身房 健身房', [{ itemName: '中毛巾', actualQty: 24 }], { driverSig: 'signed', date: '2026-11-28' }),
        receipt('short', '承億', '健身房', [{ itemName: '中毛巾', actualQty: 24 }], { driverSig: 'signed', date: '2026-11-28' }),
        receipt('shadow', '承億健身房', '健身房', [{ itemName: '中毛巾', actualQty: 24 }], { date: '2026-11-28' }),
    ];
    const rows = rowsForPeriod(docs, '承億', '2026-11-26', '2026-12-25');
    assert.deepEqual(rows.map(row => [row.hotel, row.qty]), [['承億 健身房', 24]]);
    assert.equal(rowsForPeriod(docs, '承億健身房', '2026-11-26', '2026-12-25').length, 0);
    const mismatch = [
        receipt('signed', '承億', '休閒 休閒', [{ itemName: '浴巾(泳池)', actualQty: 51 }], { clientSig: 'signed', date: '2026-11-04' }),
        receipt('shadow', '承億休閒', '休閒', [{ itemName: '浴巾(泳池)', actualQty: 50 }], { date: '2026-11-04' }),
        receipt('canonical', '承億', '休閒', [{ itemName: '浴巾(泳池)', actualQty: 49 }], { clientSig: 'main', date: '2026-11-04' }),
    ];
    const picked = branch.foldForBilling(mismatch);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].id, 'canonical');
    assert.equal(branch.billedQty(picked[0].data.items[0]), 49);
    assert.equal(rowsForPeriod(mismatch, '承億', '2026-10-26', '2026-11-25').reduce((sum, row) => sum + row.qty, 0), 49);
    assert.ok(branch.quantityWarnings.some(warning => warning.deptName === '休閒' && warning.keptQty === 49 && warning.otherQty === 51));
    const nikkatsu = [
        receipt('doubled', '日航', '休閒中心 休閒中心', [{ itemName: '浴巾', actualQty: 63 }], { driverSig: 'signed', date: '2026-11-28' }),
        receipt('shadow', '日航休閒中心', '休閒中心', [{ itemName: '浴巾', actualQty: 60 }], { date: '2026-11-28' }),
    ];
    const nikkatsuFolded = branch.foldForBilling(nikkatsu);
    assert.equal(nikkatsuFolded[0].id, 'doubled');
    assert.equal(branch.billedQty(nikkatsuFolded[0].data.items[0]), 63);
    assert.ok(branch.quantityWarnings.some(warning => warning.deptName === '休閒中心' && warning.keptQty === 63 && warning.otherQty === 60));
    const separate = [
        receipt('hotel', '日航', '特處', [{ itemName: '特處羽毛被', actualQty: 1 }], { clientSig: 'signed', date: '2026-11-06' }),
        receipt('leisure', '日航', '休閒中心 特處', [{ itemName: '特處中毛', actualQty: 2 }], { clientSig: 'signed', date: '2026-11-06' }),
        receipt('shadow', '日航休閒中心', '特處', [{ itemName: '特處中毛', actualQty: 2 }], { date: '2026-11-06' }),
    ];
    const kept = rowsForPeriod(separate, '日航', '2026-11-01', '2026-11-30')
        .map(row => [row.hotel, row.item, row.qty])
        .sort((a, b) => a.join('\0').localeCompare(b.join('\0'), 'zh-TW'));
    assert.deepEqual(kept, [
        ['日航 休閒中心 特處', '特處中毛', 2],
        ['日航 特處', '特處羽毛被', 1],
    ]);
    assert.equal(catalogPrice({
        hotel: '承億 健身房',
        item: '中毛巾',
        sheetPrices: { '承億 健身房 健身房_中毛巾': 5.8 },
    }).price, 5.8);
    assert.equal(catalogPrice({
        hotel: '日航 休閒中心',
        item: '浴巾',
        sheetPrices: { '日航 休閒中心 休閒中心_浴巾': 13 },
    }).price, 13);
});

test('the browser FlowerReceipts wrapper delegates to the shared module', () => {
    const context = vm.createContext({});
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    vm.runInContext(fs.readFileSync(path.join(root, 'firebase-signature/functions/lib/flower-branch.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'flower-receipts.js'), 'utf8'), context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.FlowerReceipts.identity('花季Ａ館', '房務'))), canonical);
    const folded = context.FlowerReceipts.collapse(new Map([
        ['a', snapshot('a', { date: '2026-11-19', hotelKeyword: '花季', deptName: 'A館 房務', clientSig: 'signed', items: [{ itemName: '浴巾', actualQty: 1 }] })],
        ['b', snapshot('b', { date: '2026-11-19', hotelKeyword: '花季Ａ館', deptName: '房務', items: [{ itemName: '浴巾', actualQty: 2 }] })],
    ]));
    assert.equal(folded.get('a').data().items[0].actualQty, 1);
    assert.ok(context.FlowerBranch.quantityWarnings.some(warning => warning.keptQty === 1 && warning.otherQty === 2));
});
