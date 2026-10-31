import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceEngine } from '../firebase-signature/functions/lib/invoice-engine.js';
import { buildStatementTables, renderStatementHtml } from '../statement-case.js';

const template = [
    { baseName: '富野', deptName: '特處', hotel: '富野 特處', item: '浴巾' },
    { baseName: '富野', deptName: '特處', hotel: '富野 特處', item: '床單' },
    { baseName: '富野', deptName: '特處', hotel: '富野 特處', item: '被套' },
    { baseName: '富野', deptName: '房務', hotel: '富野 房務', item: '枕套' },
];

function row(dept, item, order) {
    return {
        docId: `doc-${order}`,
        receiptOrder: order,
        date: '2026-10-02',
        parentCompany: '富野',
        hotel: `富野 ${dept}`,
        item,
        qty: 1,
        savedPrice: 10,
    };
}

test('statement items follow the logistics template, with unknown items afterwards in receipt order', () => {
    const engine = createInvoiceEngine({
        logisticsMasterItems: template,
        pricingRules: { holidays: [], rebates: [], managementFees: [] },
        effectivePriceRules: [],
        sheetPrices: {},
        customPrices: {},
        sheetClients: { 富野: { name: '富野股份有限公司', taxId: '12345678' } },
        rawLogisticsData: [
            row('特處', '被套', 1),
            row('特處', '羽毛被', 2),
            row('特處', '床單', 3),
            row('特處', '床包', 4),
            row('特處', '浴巾', 5),
            row('房務', '枕套', 6),
        ],
    });
    const snapshot = engine.build('富野', '2026-09-26', '2026-10-25');
    assert.deepEqual(snapshot.departments.map(dept => dept.name), ['富野 特處', '富野 房務']);
    assert.deepEqual(snapshot.departments[0].summary.map(item => item.item), ['浴巾', '床單', '被套', '羽毛被', '床包']);
    assert.deepEqual(snapshot.departments[0].records.map(item => item.item), ['浴巾', '床單', '被套', '羽毛被', '床包']);
});

test('preview and Excel reorder a stored statement to the receipt order', () => {
    const stored = {
        customerKey: '富野',
        startDate: '2026-09-26',
        endDate: '2026-10-25',
        profile: { name: '富野股份有限公司', taxId: '12345678', contact: '', phone: '', address: '', terms: '', method: '' },
        departments: [{
            name: '富野 特處',
            total: 30,
            summary: [
                { item: '羽毛被', qty: 1, price: 10, amt: 10 },
                { item: '被套', qty: 1, price: 10, amt: 10 },
                { item: '床包', qty: 1, price: 10, amt: 10 },
                { item: '浴巾', qty: 1, price: 10, amt: 10 },
            ],
            records: [
                { date: '2026-10-02', item: '羽毛被', qty: 1, price: 10, amt: 10, docId: 'a' },
                { date: '2026-10-02', item: '被套', qty: 1, price: 10, amt: 10, docId: 'b' },
                { date: '2026-10-02', item: '床包', qty: 1, price: 10, amt: 10, docId: 'c' },
                { date: '2026-10-02', item: '浴巾', qty: 1, price: 10, amt: 10, docId: 'd' },
            ],
        }],
        totals: { grandTotal: 40, rounded: 40, managementFee: { percent: 0, amount: 0 }, rebate: { percent: 0, amount: 0 }, afterRebate: 40, tax: 2 },
    };
    const html = renderStatementHtml(stored, template);
    assert.ok(html.indexOf('浴巾') < html.indexOf('被套'));
    assert.ok(html.indexOf('被套') < html.indexOf('羽毛被'));
    assert.ok(html.indexOf('羽毛被') < html.indexOf('床包'));
    const tables = buildStatementTables(stored, template);
    const summary = tables.sheets[0].rows.filter(row => ['浴巾', '床單', '被套', '羽毛被', '床包'].includes(row[0])).map(row => row[0]);
    assert.deepEqual(summary, ['浴巾', '被套', '羽毛被', '床包']);
});
