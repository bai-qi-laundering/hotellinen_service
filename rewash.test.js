import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rowsForPeriod, createInvoiceEngine } from './firebase-signature/functions/lib/auto-close.js';

test('auto statement drops the 回洗 department and keeps other departments, including 重洗', () => {
    const docs = [
        { id: 'house', data: { date: '2026-10-02', hotelKeyword: '驛館', deptName: '房務', items: [
            { itemName: '床單', actualQty: 4, price: 10 },
            { itemName: '回洗床單', actualQty: 9, price: 10 },
            { itemName: '浴巾', actualQty: 6, price: 8, inventoryItemName: '回洗浴巾' },
        ] } },
        { id: 'rewash', data: { date: '2026-10-03', hotelKeyword: '驛館', deptName: '回洗', items: [
            { itemName: '羽毛被', actualQty: 3, price: 50 },
        ] } },
        { id: 'rewash-dept', data: { date: '2026-10-04', hotelKeyword: '驛館', deptName: '回洗部', items: [
            { itemName: '枕套', actualQty: 8, price: 5 },
        ] } },
        { id: 'zhongxi', data: { date: '2026-10-05', hotelKeyword: '驛館', deptName: '重洗', items: [
            { itemName: '被套', actualQty: 2, price: 30 },
        ] } },
        { id: 'special', data: { date: '2026-10-06', hotelKeyword: '驛館', deptName: '特處', items: [
            { itemName: '特處床單', actualQty: 2, price: 15 },
        ] } },
    ];
    const rows = rowsForPeriod(docs, '驛館', '2026-10-01', '2026-10-31');
    assert.deepEqual(rows.map(row => [row.hotel, row.item, row.qty]), [
        ['驛館 房務', '床單', 4],
        ['驛館 房務', '浴巾', 6],
        ['驛館 重洗', '被套', 2],
        ['驛館 特處', '特處床單', 2],
    ]);
    const snapshot = createInvoiceEngine({
        logisticsMasterItems: [{ hotel: '驛館 房務', item: '床單' }],
        pricingRules: { holidays: [], rebates: [], managementFees: [] },
        effectivePriceRules: [], sheetPrices: {}, customPrices: {},
        sheetClients: { 驛館: { name: '驛館股份有限公司', taxId: '12345678' } },
        rawLogisticsData: rows,
    }).build('驛館', '2026-10-01', '2026-10-31');
    const names = snapshot.departments.map(dept => dept.name);
    assert.equal(names.includes('驛館 回洗'), false);
    assert.equal(names.includes('驛館 回洗部'), false);
    assert.deepEqual(names, ['驛館 房務', '驛館 重洗', '驛館 特處']);
    assert.equal(snapshot.totals.grandTotal, 4 * 10 + 6 * 8 + 2 * 30 + 2 * 15);
    const packed = JSON.stringify(snapshot);
    assert.equal(packed.includes('羽毛被'), false);
    assert.equal(packed.includes('回洗床單'), false);
    assert.equal(packed.includes('浴巾'), true);
});

test('only the auto statement gained the 回洗 department filter', () => {
    const auto = fs.readFileSync(new URL('./firebase-signature/functions/lib/auto-close.js', import.meta.url), 'utf8');
    const finance = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    const dispatch = fs.readFileSync(new URL('./statement-dispatch.html', import.meta.url), 'utf8');
    const statement = fs.readFileSync(new URL('./statement-case.js', import.meta.url), 'utf8');
    assert.match(auto, /hotel\.includes\('回洗'\)/);
    assert.match(auto, /includes\('回洗'\)/);
    assert.equal(dispatch.includes('statementWithoutRewash'), false);
    assert.equal(statement.includes('statementWithoutRewash'), false);
    assert.equal(finance.includes('isRewash'), false);
});
