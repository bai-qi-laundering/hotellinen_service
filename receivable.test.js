import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInvoiceEngine } from './firebase-signature/functions/lib/auto-close.js';
import { statementReceivable, sumCustomerReceivables, sumGroupFigures } from './firebase-signature/functions/lib/receivable.js';

function engineFor(row, rules) {
    const options = {
        logisticsMasterItems: [{ hotel: '富野 房務', item: '床單' }],
        pricingRules: rules,
        effectivePriceRules: [{ key: '富野 房務_床單', start: '2026-10-01', price: 12.34 }],
        sheetPrices: {}, customPrices: {},
        sheetClients: { 富野: { name: '富野股份有限公司', taxId: '12345678' } },
        rawLogisticsData: [row],
    };
    return createInvoiceEngine(options);
}

test('one hotel receivable matches the statement, including holiday, fee and rebate', () => {
    const row = { docId: 'a', receiptOrder: 0, date: '2026-10-25', parentCompany: '富野', hotel: '富野 房務', item: '床單', qty: 10, savedPrice: 5 };
    const rules = {
        holidays: [{ hotel: '富野', start: '2026-10-25', end: '2026-10-25', percent: 10 }],
        rebates: [{ hotel: '富野', percent: 10 }],
        managementFees: [{ hotel: '富野', percent: 5 }],
    };
    const engine = engineFor(row, rules);
    const statement = engine.build('富野', '2026-09-26', '2026-10-25');
    const bill = statementReceivable([row], engine.reportRecordPrice, rules.rebates[0], rules.managementFees[0]);
    assert.equal(bill.grandTotal, statement.totals.grandTotal);
    assert.equal(bill.rounded, statement.totals.rounded);
    assert.equal(bill.managementFee.amount, statement.totals.managementFee.amount);
    assert.equal(bill.rebate.amount, statement.totals.rebate.amount);
    assert.equal(bill.afterRebate, statement.totals.afterRebate);
    assert.equal(bill.tax, statement.totals.tax);
    assert.equal(bill.payable, statement.totals.afterRebate + statement.totals.tax);
    assert.equal(bill.payable, 135);
});

test('dashboard header adds each group after that group is rounded, with no second tax', () => {
    const price = () => 1;
    const ten = [{ parentCompany: '甲', hotel: '甲', item: '床單', qty: 10, date: '2026-10-01' }];
    const other = [{ parentCompany: '乙', hotel: '乙', item: '床單', qty: 10, date: '2026-10-01' }];
    const groupA = sumCustomerReceivables(ten, price, () => ({}));
    const groupB = sumCustomerReceivables(other, price, () => ({}));
    assert.equal(groupA.untaxed, 10);
    assert.equal(groupA.tax, 1);
    assert.equal(groupA.final, 11);
    const header = sumGroupFigures([groupA, groupB]);
    assert.equal(header.untaxed, 20);
    assert.equal(header.tax, 2);
    assert.equal(header.final, 22);
    assert.notEqual(header.tax, Math.round(header.untaxed * 0.05));
});

test('fee and rebate are inside the hotel total the dashboard and Excel both use', () => {
    const records = [{ parentCompany: '富野', hotel: '富野 房務', item: '床單', qty: 10, date: '2026-10-02' }];
    const price = () => 10;
    const rules = () => ({ rebate: { hotel: '富野', percent: 10 }, managementFee: { hotel: '富野', percent: 5 } });
    const group = sumCustomerReceivables(records, price, rules);
    const hotel = group.customers[0];
    assert.equal(hotel.rounded, 100);
    assert.equal(hotel.managementFee.amount, 5);
    assert.equal(hotel.rebate.amount, 10);
    assert.equal(hotel.afterRebate, 95);
    assert.equal(hotel.tax, 5);
    assert.equal(hotel.payable, 100);
    assert.equal(group.final, hotel.payable);
    assert.equal(group.managementFee, 5);
    assert.equal(group.rebate, 10);
});

test('driver performance asks for the statement price', () => {
    const finance = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    const body = finance.slice(finance.indexOf('async function calculateDriverPerformance'), finance.indexOf('function renderDriverCards'));
    assert.match(body, /reportRecordPrice\(/);
    assert.match(body, /ensurePricingRules\(\)/);
    assert.match(body, /ensureEffectivePrices\(\)/);
    assert.equal(body.includes('getPrice(hotelName, item.itemName)'), false);
});
