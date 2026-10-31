import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { caseDocumentId } from '../lib/auto-close.js';
import {
    BILLING_CRON,
    BILLING_TIME_ZONE,
    billingGroupForDate,
    dueHotelKeywords,
    hotelPeriodQueries,
    settlementWarnings,
    shouldReadFirestore,
} from '../lib/billing-schedule.js';
import { handleBillingSchedule, runBillingDay } from '../lib/billing-run.js';

const MASTER = 'https://script.google.com/macros/s/test/exec';

test('billing days are the 25th and the real last day, including February', () => {
    assert.equal(billingGroupForDate('2026-10-25'), '25th');
    assert.equal(billingGroupForDate('2026-10-31'), 'month');
    assert.equal(billingGroupForDate('2026-10-30'), null);
    assert.equal(billingGroupForDate('2026-10-28'), null);
    assert.equal(billingGroupForDate('2026-04-30'), 'month');
    assert.equal(billingGroupForDate('2026-02-28'), 'month');
    assert.equal(billingGroupForDate('2028-02-28'), null);
    assert.equal(billingGroupForDate('2028-02-29'), 'month');
    assert.equal(shouldReadFirestore({ date: '2026-10-25', enabled: false }), false);
    assert.equal(shouldReadFirestore({ date: '2026-10-28', enabled: true }), false);
    assert.equal(shouldReadFirestore({ date: '2026-10-25', enabled: true }), true);
    assert.equal(BILLING_CRON, '30 9 25,28,29,30,31 * *');
    assert.equal(BILLING_TIME_ZONE, 'Asia/Taipei');
});

test('due hotels follow the group for today, including a saved name missing from the template', () => {
    const groups = { 富野: '', 新店: '15', 天幕: '25th' };
    assert.deepEqual(dueHotelKeywords(['富野', '日航', '新店'], groups, '25th'), ['天幕']);
    assert.deepEqual(dueHotelKeywords(['富野', '日航', '新店'], groups, 'month'), ['日航']);
    const warnings = settlementWarnings(['富野', '日航', '新店', '麥當勞'], groups);
    assert.ok(warnings.some(item => item.type === 'unknown_day' && item.customer === '新店'));
    assert.ok(warnings.some(item => item.type === 'not_in_template' && item.customer === '天幕'));
    assert.ok(warnings.some(item => item.type === 'no_billing_day' && item.customer === '富野'));
    assert.ok(warnings.some(item => item.type === 'no_billing_day' && item.customer === '麥當勞'));
});

test('period queries stay inside one hotel and do not rescan a padded month', () => {
    assert.deepEqual(hotelPeriodQueries('2026-10-01', '2026-10-31').map(item => item.kind), ['range', 'timestamp']);
    assert.deepEqual(
        hotelPeriodQueries('2026-09-26', '2026-10-25').map(item => item.kind === 'prefix' ? item.prefix : item.kind),
        ['range', '2026-9-', 'timestamp'],
    );
});

function compare(actual, filter) {
    if (filter.value instanceof Date) {
        const time = actual instanceof Date ? actual.getTime() : NaN;
        if (filter.op === '>=') return time >= filter.value.getTime();
        if (filter.op === '<=') return time <= filter.value.getTime();
        return false;
    }
    if (typeof actual !== 'string') return false;
    if (filter.op === '==') return actual === filter.value;
    if (filter.op === '>=') return actual >= filter.value;
    if (filter.op === '<=') return actual <= filter.value;
    return false;
}

function fakeDb({ docs = [], receipts = [] } = {}) {
    const stored = new Map(docs);
    const queries = [];
    let gets = 0;
    const api = {
        queries,
        gets: () => gets,
        stored,
        collection(name) {
            return {
                doc(id) {
                    const path = `${name}/${id}`;
                    return {
                        path,
                        async get() {
                            gets += 1;
                            const value = stored.get(path);
                            return { exists: value !== undefined, data: () => value };
                        },
                        async create(value) {
                            if (stored.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
                            stored.set(path, value);
                        },
                    };
                },
                where(field, op, value) {
                    const filters = [{ field, op, value }];
                    const chain = {
                        where(nextField, nextOp, nextValue) {
                            filters.push({ field: nextField, op: nextOp, value: nextValue });
                            return chain;
                        },
                        async get() {
                            queries.push(filters.map(filter => ({
                                field: filter.field,
                                op: filter.op,
                                value: filter.value instanceof Date ? 'date' : filter.value,
                            })));
                            const matched = receipts.filter(row => filters.every(filter => compare(row.data[filter.field], filter)));
                            gets += Math.max(1, matched.length);
                            return { forEach(cb) { matched.forEach(row => cb({ id: row.id, data: () => row.data })); } };
                        },
                    };
                    return chain;
                },
            };
        },
        async runTransaction(work) {
            const writes = [];
            const result = await work({
                async get(ref) {
                    gets += 1;
                    const value = stored.get(ref.path);
                    return { exists: value !== undefined, data: () => value };
                },
                create(ref, value) {
                    if (stored.has(ref.path) || writes.some(([path]) => path === ref.path)) {
                        throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
                    }
                    writes.push([ref.path, value]);
                },
            });
            writes.forEach(([path, value]) => stored.set(path, value));
            return result;
        },
    };
    return api;
}

function baseDocs(groups, items) {
    return [
        ['inventory_config/finance_settlement_groups', { groups }],
        ['inventory_config/master_template', { items }],
        ['inventory_config/finance_annual_pricing', { holidays: [], rebates: [], managementFees: [] }],
        ['inventory_config/finance_effective_prices', { rules: [] }],
        ['inventory_config/custom_prices', { prices: {} }],
    ];
}

function masterFetch(clients) {
    let calls = 0;
    return {
        calls: () => calls,
        fetchFn: async () => {
            calls += 1;
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    prices: [['表頭'], ['富野', '房務', '床單', 10], ['鼎王', '七賢', '床單', 10], ['鼎王', '富國', '床單', 10]],
                    clients,
                }),
            };
        },
    };
}

function casesOf(db) {
    return [...db.stored.entries()].filter(([path]) => path.startsWith('statement_cases/')).map(([, value]) => value);
}

test('a non-billing day and a disabled run do not touch Firestore', async () => {
    const db = { collection() { throw new Error('不該讀取'); } };
    const quiet = await handleBillingSchedule({ date: '2026-10-28', enabled: true, db, masterUrl: MASTER, fetchFn: async () => { throw new Error('不該抓價'); } });
    assert.equal(quiet.status, 'noop');
    const disabled = await handleBillingSchedule({ date: '2026-10-25', enabled: false, db, masterUrl: MASTER });
    assert.equal(disabled.status, 'noop');
    assert.equal((await runBillingDay({ db, date: '2026-10-30', masterUrl: MASTER, fetchFn: async () => { throw new Error('不該抓價'); } })).status, 'not_billing_day');
});

test('25th run bills only that group, keeps unsigned deliveries, drops 回洗, and does not duplicate', async () => {
    const db = fakeDb({
        docs: baseDocs(
            { 富野: '25th', 日航: 'month', 天幕: '25th', 新店: '15', 麥當勞: '' },
            [
                { baseName: '富野', hotel: '富野 房務', item: '床單' },
                { baseName: '日航', hotel: '日航 房務', item: '床單' },
                { baseName: '候工所', hotel: '候工所 房務', item: '床單' },
                { baseName: '新店', hotel: '新店 房務', item: '床單' },
                { baseName: '麥當勞', hotel: '麥當勞 房務', item: '床單' },
            ],
        ),
        receipts: [
            { id: 'unsigned', data: { date: '2026-10-25', hotelKeyword: '富野', deptName: '房務', items: [{ itemName: '床單', actualQty: 2, price: 10 }] } },
            { id: 'signed', data: { date: '2026-10-01', hotelKeyword: '富野', deptName: '房務', clientSig: 'signed', items: [{ itemName: '床單', actualQty: 3, price: 10 }] } },
            { id: 'rewash', data: { date: '2026-10-02', hotelKeyword: '富野', deptName: '回洗', items: [{ itemName: '床單', actualQty: 9, price: 10 }] } },
            { id: 'other-group', data: { date: '2026-10-25', hotelKeyword: '日航', deptName: '房務', items: [{ itemName: '床單', actualQty: 8, price: 10 }] } },
        ],
    });
    const http = masterFetch([['富野', '富野股份有限公司', '12345678', '聯絡人']]);
    const warnings = [];
    const logger = { warn: (_event, entry) => warnings.push(entry), info() {} };
    const first = await runBillingDay({ db, date: '2026-10-25', masterUrl: MASTER, fetchFn: http.fetchFn, logger, backoffMs: 0 });
    assert.equal(first.billingGroup, '25th');
    assert.equal(first.failures.length, 0);
    const created = first.results.find(item => item.customer === '富野');
    assert.equal(created.status, 'created');
    assert.equal(created.unsignedReceiptCount, 1);
    assert.equal(created.signedReceiptCount, 1);
    const bills = casesOf(db);
    assert.equal(bills.length, 1);
    assert.equal(bills[0].customerKey, '富野');
    assert.equal(bills[0].state, 'pending');
    assert.equal(bills[0].autoGenerated, true);
    assert.equal(bills[0].startDate, '2026-09-26');
    assert.equal(bills[0].endDate, '2026-10-25');
    assert.equal(bills[0].versions[0].snapshot.totals.grandTotal, 50);
    assert.equal(bills[0].versions[0].snapshot.totals.tax, 3);
    assert.equal(JSON.stringify(bills[0]).includes('回洗'), false);
    assert.ok(warnings.some(item => item.type === 'unknown_day' && item.customer === '新店'));
    assert.ok(warnings.some(item => item.type === 'not_in_template' && item.customer === '天幕'));
    const hotels = db.queries.map(filters => filters.find(filter => filter.field === 'hotelKeyword')?.value);
    assert.deepEqual([...new Set(hotels)].sort(), ['候工所', '天幕', '富野']);
    const queriesAfterFirst = db.queries.length;
    const fetchesAfterFirst = http.calls();
    db.stored.get(`statement_cases/${created.id}`).versions[0].snapshot.totals.grandTotal = 1;
    const second = await runBillingDay({ db, date: '2026-10-25', masterUrl: MASTER, fetchFn: http.fetchFn, logger, backoffMs: 0 });
    assert.equal(second.results.find(item => item.customer === '富野').status, 'already_completed');
    assert.equal(db.queries.length, queriesAfterFirst);
    assert.equal(http.calls(), fetchesAfterFirst);
    assert.equal(casesOf(db)[0].versions[0].snapshot.totals.grandTotal, 1);
    assert.equal(casesOf(db).length, 1);
});

test('an existing manual statement is left in place and receipts are not read again', async () => {
    const id = await caseDocumentId('富野', '2026-09-26', '2026-10-25');
    const db = fakeDb({
        docs: [
            ...baseDocs({ 富野: '25th' }, [{ baseName: '富野', hotel: '富野 房務', item: '床單' }]),
            [`statement_cases/${id}`, { latestVersion: 4, customerKey: '富野', versions: [{ version: 4 }] }],
        ],
        receipts: [{ id: 'x', data: { date: '2026-10-25', hotelKeyword: '富野', deptName: '房務', items: [{ itemName: '床單', actualQty: 2, price: 10 }] } }],
    });
    const http = masterFetch([['富野', '富野股份有限公司', '12345678', '聯絡人']]);
    const result = await runBillingDay({ db, date: '2026-10-25', masterUrl: MASTER, fetchFn: http.fetchFn, logger: { warn() {}, info() {} }, backoffMs: 0 });
    assert.equal(result.results[0].status, 'skipped_existing');
    assert.equal(db.queries.length, 0);
    assert.equal(http.calls(), 0);
    assert.equal(db.stored.get(`statement_cases/${id}`).latestVersion, 4);
});

test('month-end splits 鼎王 by department from one hotel query and still drops 回洗', async () => {
    const db = fakeDb({
        docs: baseDocs(
            { 鼎王: 'month' },
            [{ baseName: '鼎王', hotel: '鼎王 七賢', item: '床單' }],
        ),
        receipts: [
            { id: 'qixian', data: { date: '2026-10-31', hotelKeyword: '鼎王', deptName: '七賢', clientSig: 'signed', items: [{ itemName: '床單', actualQty: 2, price: 10 }] } },
            { id: 'fuguo', data: { date: '2026-10-03', hotelKeyword: '鼎王', deptName: '富國', items: [{ itemName: '床單', actualQty: 4, price: 10 }] } },
            { id: 'rewash', data: { date: '2026-10-04', hotelKeyword: '鼎王', deptName: '回洗', items: [{ itemName: '羽毛被', actualQty: 9, price: 50 }] } },
        ],
    });
    const http = masterFetch([
        ['鼎王 七賢', '鼎王七賢店', '12345678', '聯絡人'],
        ['鼎王 富國', '鼎王富國店', '12345678', '聯絡人'],
    ]);
    const result = await runBillingDay({ db, date: '2026-10-31', masterUrl: MASTER, fetchFn: http.fetchFn, logger: { warn() {}, info() {} }, backoffMs: 0 });
    assert.equal(result.failures.length, 0);
    const bills = casesOf(db).sort((a, b) => a.customerKey.localeCompare(b.customerKey, 'zh-TW'));
    assert.deepEqual(bills.map(item => [item.customerKey, item.versions[0].snapshot.totals.grandTotal, item.autoGeneration.unsignedReceiptCount]), [
        ['鼎王 七賢', 20, 0],
        ['鼎王 富國', 40, 1],
    ]);
    assert.equal(JSON.stringify(bills).includes('回洗'), false);
    assert.equal(JSON.stringify(bills).includes('羽毛被'), false);
    assert.ok(db.queries.every(filters => filters.some(filter => filter.field === 'hotelKeyword' && filter.value === '鼎王')));
    assert.equal(result.results.find(item => item.customer === '鼎王 回洗').status, 'skipped_empty');
});

test('the sign page no longer starts statement generation', () => {
    const html = fs.readFileSync(new URL('../../../logistics.html', import.meta.url), 'utf8');
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(html.includes('tryAutoStatement'), false);
    assert.equal(html.includes('signature-statement-client'), false);
    assert.match(index, /30 9 25,28,29,30,31 \* \*/);
    assert.match(index, /Asia\/Taipei/);
    assert.equal(index.includes('onDocumentWritten'), false);
});
