import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceEngine } from '../lib/invoice-engine.js';
import { isFixedHotelCase } from '../../../receivables-core.js';
import {
    accountKeyForCustomer,
    isCombinedAccountKey,
    regroupBillingJobs,
    statementSelectionGroups,
} from '../lib/statement-groups.js';

const liang = {
    良西: { name: '碧港良居商旅股份有限公司', taxId: '53589534' },
    良一: { name: '碧港良居商旅股份有限公司', taxId: '53589534' },
};
const ran = {
    然一: { name: '御盟酒店股份有限公司灣區分公司', taxId: '59269713' },
    '然一-客衣': { name: '御盟酒店股份有限公司灣區分公司', taxId: '59269713' },
};

test('same title and tax id combine only a known account, in the payment-account order', () => {
    assert.deepEqual(statementSelectionGroups(['良一', '良西'], liang), [
        { key: '良西+良一', members: ['良西', '良一'] },
    ]);
    assert.deepEqual(statementSelectionGroups(['良一'], liang), []);
    assert.deepEqual(statementSelectionGroups(['然一', '然一-客衣'], ran), []);
    assert.deepEqual(statementSelectionGroups(['良一', '良西'], {
        良西: liang.良西,
        良一: { name: '另一家公司', taxId: '53589534' },
    }), []);
    assert.equal(accountKeyForCustomer('良一'), '良西+良一');
    assert.equal(accountKeyForCustomer('良西+良一'), '良西+良一');
    assert.equal(isCombinedAccountKey('良一＋良西'), true);
    assert.equal(isCombinedAccountKey('富野+英迪格'), false);
    assert.equal(isFixedHotelCase({ customerKey: '良一＋良西' }), true);
    assert.equal(isFixedHotelCase({ customerKey: '富野+英迪格' }), false);
});

test('billing jobs with the same period become one combined job', () => {
    const period = { startDate: '2026-09-26', endDate: '2026-10-25' };
    const jobs = regroupBillingJobs([
        { customer: '良一', hotel: '良一', id: 'a', period },
        { customer: '富野', hotel: '富野', id: 'b', period },
        { customer: '良西', hotel: '良西', id: 'c', period },
    ], liang);
    assert.deepEqual(jobs.map(job => job.customer), ['良西+良一', '富野']);
    assert.deepEqual(jobs[0].members, ['良西', '良一']);
    const splitPeriod = regroupBillingJobs([
        { customer: '良一', id: 'a', period },
        { customer: '良西', id: 'c', period: { startDate: '2026-10-01', endDate: '2026-10-31' } },
    ], liang);
    assert.deepEqual(splitPeriod.map(job => job.customer), ['良一', '良西']);
});

test('a combined statement includes both hotels and keeps one customer key', () => {
    const rows = [
        { docId: 'east', receiptOrder: 0, date: '2026-10-10', parentCompany: '良一', hotel: '良一 房務', item: '床單', qty: 2, savedPrice: 10 },
        { docId: 'west', receiptOrder: 0, date: '2026-10-12', parentCompany: '良西', hotel: '良西 房務', item: '浴巾', qty: 4, savedPrice: 10 },
    ];
    const engine = createInvoiceEngine({
        logisticsMasterItems: [
            { baseName: '良一', hotel: '良一 房務', deptName: '房務', item: '床單' },
            { baseName: '良西', hotel: '良西 房務', deptName: '房務', item: '浴巾' },
        ],
        pricingRules: { holidays: [], rebates: [{ hotel: '良一', percent: 10 }], managementFees: [{ hotel: '良西', percent: 5 }] },
        effectivePriceRules: [],
        sheetPrices: {},
        customPrices: {},
        sheetClients: liang,
        rawLogisticsData: rows,
    });
    const snapshot = engine.build('良西+良一', '2026-09-26', '2026-10-25');
    assert.equal(snapshot.customerKey, '良西+良一');
    assert.equal(snapshot.profile.taxId, '53589534');
    assert.equal(snapshot.profile.name, '碧港良居商旅股份有限公司');
    assert.deepEqual(snapshot.departments.map(dept => dept.name), ['良一 房務', '良西 房務']);
    assert.equal(snapshot.totals.grandTotal, 60);
    assert.equal(snapshot.totals.rebate.amount, 2);
    assert.equal(snapshot.totals.managementFee.amount, 2);
    assert.equal(engine.build('良一', '2026-09-26', '2026-10-25').departments.length, 1);
});
