import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildStatementTables,
    isRewashItem,
    isRewashName,
    isRewashReceipt,
    renderStatementHtml,
    snapshotFromParts,
    statementWithoutRewash,
} from './statement-case.js';
import { rowsForPeriod, createInvoiceEngine } from './firebase-signature/functions/lib/auto-close.js';

test('回洗 matcher catches department and item variants without dropping other departments', () => {
    for (const name of ['回洗', '回洗部', '回洗課', '回 洗', '驛館 回洗', '重洗', '重洗部', '回洗床單', '回洗圍裙', 'Rewash']) {
        assert.equal(isRewashName(name), true, name);
    }
    for (const name of ['', '房務', '特處', '餐廳', '餐飲部', '制服', '回饋', '洗滌', '重新洗滌', '驛館 房務', '特處床單', '羽毛被', 'prewash']) {
        assert.equal(isRewashName(name), false, name);
    }
    assert.equal(isRewashItem({ itemName: '浴巾', inventoryItemName: '回洗浴巾' }), true);
    assert.equal(isRewashItem({ itemName: '特處床單', itemNameAliases: ['頭套/頭巾'] }), false);
    assert.equal(isRewashReceipt({ hotelKeyword: '驛館', deptName: '房務' }), false);
    assert.equal(isRewashReceipt({ hotelKeyword: '驛館', deptName: '特處' }), false);
    assert.equal(isRewashReceipt({ hotelKeyword: '驛館', deptName: '回洗部' }), true);
    assert.equal(isRewashReceipt({ hotelKeyword: '驛館', deptName: '重洗' }), true);
});

test('automatic statement rows and totals leave out rewash departments and items', () => {
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
        ['驛館 特處', '特處床單', 2],
    ]);
    const engine = createInvoiceEngine({
        logisticsMasterItems: [{ hotel: '驛館 房務', item: '床單' }, { hotel: '驛館 特處', item: '特處床單' }, { hotel: '驛館 回洗', item: '羽毛被' }],
        pricingRules: { holidays: [], rebates: [{ hotel: '驛館', percent: 10 }], managementFees: [{ hotel: '驛館', percent: 5 }] },
        effectivePriceRules: [],
        sheetPrices: {},
        customPrices: {},
        sheetClients: { 驛館: { name: '驛館股份有限公司', taxId: '12345678' } },
        rawLogisticsData: rows,
    });
    const snapshot = engine.build('驛館', '2026-10-01', '2026-10-31');
    const packed = JSON.stringify(snapshot);
    assert.equal(packed.includes('回洗'), false);
    assert.equal(packed.includes('重洗'), false);
    assert.equal(packed.includes('羽毛被'), false);
    assert.equal(snapshot.departments.map(dept => dept.name).join(','), '驛館 房務,驛館 特處');
    assert.equal(snapshot.totals.grandTotal, 70);
    assert.equal(snapshot.totals.managementFee.amount, 4);
    assert.equal(snapshot.totals.rebate.amount, 7);
    assert.equal(snapshot.totals.afterRebate, 67);
    assert.equal(snapshot.totals.tax, 3);
    assert.equal(snapshot.departments[0].summary[0].qty, 4);
});

test('statement screen, excel and stored snapshot omit rewash lines and their amounts', () => {
    const dirty = {
        customerKey: '驛館',
        startDate: '2026-10-01',
        endDate: '2026-10-25',
        lineRecipient: '採購',
        profile: { name: '驛館股份有限公司', taxId: '12345678', contact: '採購', phone: '07-1', address: '高雄', terms: '月結 30 天', method: '匯款' },
        departments: [
            {
                name: '驛館 房務',
                total: 300,
                summary: [
                    { item: '床單', qty: 10, price: 20, amt: 200 },
                    { item: '回洗床單', qty: 5, price: 20, amt: 100 },
                ],
                records: [
                    { date: '2026-10-02', item: '床單', qty: 10, price: 20, amt: 200, docId: 'a' },
                    { date: '2026-10-03', item: '回洗床單', qty: 5, price: 20, amt: 100, docId: 'b' },
                ],
            },
            {
                name: '驛館 回洗',
                total: 80,
                summary: [{ item: '羽毛被', qty: 2, price: 40, amt: 80 }],
                records: [{ date: '2026-10-04', item: '羽毛被', qty: 2, price: 40, amt: 80, docId: 'c' }],
            },
            {
                name: '驛館 重洗部',
                total: 50,
                summary: [{ item: '浴巾', qty: 5, price: 10, amt: 50 }],
                records: [{ date: '2026-10-05', item: '浴巾', qty: 5, price: 10, amt: 50, docId: 'd' }],
            },
        ],
        totals: {
            grandTotal: 430,
            rounded: 430,
            managementFee: { percent: '5', amount: 22 },
            rebate: { percent: '', amount: 0 },
            afterRebate: 452,
            tax: 23,
        },
    };
    const view = statementWithoutRewash(dirty);
    assert.deepEqual(view.departments.map(dept => dept.name), ['驛館 房務']);
    assert.deepEqual(view.departments[0].summary.map(row => row.item), ['床單']);
    assert.equal(view.departments[0].total, 200);
    assert.equal(view.totals.grandTotal, 200);
    assert.equal(view.totals.rounded, 200);
    assert.equal(view.totals.managementFee.amount, 10);
    assert.equal(view.totals.afterRebate, 210);
    assert.equal(view.totals.tax, 11);
    const html = renderStatementHtml(dirty);
    assert.match(html, /驛館 房務/);
    assert.match(html, /床單/);
    assert.doesNotMatch(html, /回洗|重洗|羽毛被/);
    assert.match(html, /\$210/);
    const tables = buildStatementTables(dirty);
    const flat = JSON.stringify(tables);
    assert.equal(flat.includes('回洗'), false);
    assert.equal(flat.includes('重洗'), false);
    assert.equal(flat.includes('羽毛被'), false);
    assert.equal(tables.sheets.length, 1);
    assert.equal(tables.sheets[0].name, '驛館 房務');
    const stored = snapshotFromParts(dirty);
    assert.equal(JSON.stringify(stored).includes('回洗'), false);
    assert.equal(stored.totals.grandTotal, 200);
    assert.throws(() => snapshotFromParts({ ...dirty, departments: dirty.departments.slice(1) }), /對帳單內容不完整/);
});

test('finance statement builder and dispatch preview both use the shared rewash filter', () => {
    const finance = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    const report = finance.slice(finance.indexOf('function buildInvoiceReport'), finance.indexOf('function escapeReportHTML'));
    assert.match(report, /isRewashName\(r\.hotel\)/);
    assert.match(report, /isRewashName\(r\.item\)/);
    const dispatch = fs.readFileSync(new URL('./statement-dispatch.html', import.meta.url), 'utf8');
    assert.match(dispatch, /statementWithoutRewash\(version\.snapshot\)/);
    assert.match(dispatch, /renderStatementHtml\(version\.snapshot\)/);
    const script = fs.readFileSync(new URL('./docs/hotellinen-apps-script.gs', import.meta.url), 'utf8');
    assert.equal(script.includes('buildInvoiceReport'), false);
});
