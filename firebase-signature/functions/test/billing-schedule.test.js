import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { caseDocumentId, closingPeriod, rowsForPeriod, settlementGroup } from '../lib/auto-close.js';
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

test('billing days are the 1st, the 25th and the real last day, including February', () => {
    assert.equal(billingGroupForDate('2026-10-01'), '1st');
    assert.equal(billingGroupForDate('2026-11-01'), '1st');
    assert.equal(billingGroupForDate('2026-02-01'), '1st');
    assert.equal(billingGroupForDate('2026-10-02'), null);
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
    assert.equal(shouldReadFirestore({ date: '2026-11-02', enabled: true }), false);
    assert.equal(shouldReadFirestore({ date: '2026-11-01', enabled: true }), true);
    assert.equal(shouldReadFirestore({ date: '2026-10-25', enabled: true }), true);
    assert.equal(BILLING_CRON, '30 9 1,25,28,29,30,31 * *');
    assert.equal(BILLING_TIME_ZONE, 'Asia/Taipei');
});

test('due hotels follow the group for today, including a saved name missing from the template', () => {
    const groups = { 富野: '', 新店: '15', 天幕: '25th' };
    assert.deepEqual(dueHotelKeywords(['富野', '日航', '新店'], groups, '25th'), ['天慕']);
    assert.deepEqual(dueHotelKeywords(['富野', '日航', '新店'], groups, 'month'), ['日航']);
    const warnings = settlementWarnings(['富野', '日航', '新店', '麥當勞'], groups);
    assert.ok(warnings.some(item => item.type === 'unknown_day' && item.customer === '新店'));
    assert.ok(warnings.some(item => item.type === 'not_in_template' && item.customer === '天慕'));
    assert.ok(warnings.some(item => item.type === 'no_billing_day' && item.customer === '富野'));
    assert.ok(warnings.some(item => item.type === 'no_billing_day' && item.customer === '麥當勞'));
    const firstGroup = { 文旅: '1st', 新店: '15' };
    assert.equal(settlementWarnings(['文旅', '新店'], firstGroup).some(item => item.customer === '文旅' && item.type === 'unknown_day'), false);
    assert.deepEqual(dueHotelKeywords(['文旅', '新店'], firstGroup, '1st'), ['文旅']);
    assert.deepEqual(closingPeriod('文旅', '2026-11-01', firstGroup), { startDate: '2026-10-01', endDate: '2026-10-31' });
    assert.equal(closingPeriod('文旅', '2026-11-02', firstGroup), null);
    assert.deepEqual(closingPeriod('文旅', '2026-03-01', { 文旅: '1st' }), { startDate: '2026-02-01', endDate: '2026-02-28' });
    assert.deepEqual(closingPeriod('文旅', '2028-03-01', { 文旅: '1st' }), { startDate: '2028-02-01', endDate: '2028-02-29' });
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
                { baseName: '天慕', hotel: '天慕 餐廳', item: '床單' },
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
    assert.equal(warnings.some(item => item.customer === '天幕'), false);
    const hotels = db.queries.map(filters => filters.find(filter => filter.field === 'hotelKeyword')?.value);
    assert.ok(hotels.includes('天慕'));
    assert.ok(hotels.includes('天幕'));
    assert.ok(!hotels.includes('日航'));
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

test('the 1st bills the previous calendar month, including 鼎王 departments, and skips other groups', async () => {
    const db = fakeDb({
        docs: baseDocs(
            { 鼎王: '1st', 富野: '25th', 麥當勞: '' },
            [
                { baseName: '鼎王', hotel: '鼎王 七賢', item: '床單' },
                { baseName: '富野', hotel: '富野 房務', item: '床單' },
                { baseName: '麥當勞', hotel: '麥當勞 房務', item: '薯條' },
            ],
        ),
        receipts: [
            { id: 'october', data: { date: '2026-10-15', hotelKeyword: '鼎王', deptName: '七賢', items: [{ itemName: '床單', actualQty: 2, price: 10 }] } },
            { id: 'november', data: { date: '2026-11-01', hotelKeyword: '鼎王', deptName: '七賢', items: [{ itemName: '床單', actualQty: 9, price: 10 }] } },
            { id: 'other', data: { date: '2026-10-15', hotelKeyword: '富野', deptName: '房務', items: [{ itemName: '床單', actualQty: 5, price: 10 }] } },
        ],
    });
    const http = masterFetch([['鼎王 七賢', '鼎王七賢店', '12345678', '聯絡人']]);
    const quiet = await handleBillingSchedule({ date: '2026-11-02', enabled: true, db, masterUrl: MASTER, fetchFn: async () => { throw new Error('不該抓價'); } });
    assert.equal(quiet.status, 'noop');
    assert.equal(db.gets(), 0);
    const result = await runBillingDay({ db, date: '2026-11-01', masterUrl: MASTER, fetchFn: http.fetchFn, logger: { warn() {}, info() {} }, backoffMs: 0 });
    assert.equal(result.billingGroup, '1st');
    assert.equal(result.failures.length, 0);
    const bills = casesOf(db);
    assert.equal(bills.length, 1);
    assert.equal(bills[0].customerKey, '鼎王 七賢');
    assert.equal(bills[0].startDate, '2026-10-01');
    assert.equal(bills[0].endDate, '2026-10-31');
    assert.equal(bills[0].versions[0].snapshot.totals.grandTotal, 20);
    const hotels = db.queries.map(filters => filters.find(filter => filter.field === 'hotelKeyword')?.value);
    assert.ok(hotels.includes('鼎王'));
    assert.ok(!hotels.includes('富野'));
    assert.ok(!hotels.includes('麥當勞'));
});

test('歐遊 and 捷中正 bill on the 1st, not again at month end', () => {
    assert.equal(settlementGroup('歐遊', {}), '1st');
    assert.equal(settlementGroup('捷中正', {}), '1st');
    assert.equal(settlementGroup('歐遊', { 歐遊: 'month' }), '1st');
    assert.equal(settlementGroup('捷中正', { 捷中正: '25th' }), '1st');
    assert.equal(settlementGroup('歐遊 房務', { 歐遊: 'month' }), '1st');
    assert.equal(settlementGroup('捷中正 特處', {}), '1st');
    assert.equal(settlementGroup('捷站前', {}), 'month');
    assert.equal(settlementGroup('比歐', {}), 'month');
    assert.equal(settlementGroup('鉑麗', {}), 'month');
    assert.equal(settlementGroup('歐遊', { 歐遊: '' }), '1st');
    assert.equal(settlementGroup('H2O 西餐', { 'H2O 西餐': 'month' }), '25th');
    assert.equal(settlementGroup('H2O西餐', {}), '25th');
    assert.equal(settlementGroup('H2O', { H2O: 'month' }), '25th');
    assert.equal(settlementGroup('H2O 房務', {}), '25th');
    assert.equal(settlementGroup('天慕', { 天幕: '1st' }), '25th');
    assert.equal(settlementGroup('天幕', {}), '25th');
    assert.equal(settlementGroup('鉑麗', { 鉑麗: '25th' }), 'month');
    assert.deepEqual(dueHotelKeywords(['H2O', 'H2O 西餐', '鉑麗'], { 'H2O 西餐': 'month', H2O: 'month', 鉑麗: '25th' }, '25th'), ['H2O']);
    assert.deepEqual(dueHotelKeywords(['H2O', 'H2O 西餐', '鉑麗'], { 'H2O 西餐': 'month', H2O: 'month', 鉑麗: '25th' }, 'month'), ['鉑麗']);
    assert.deepEqual(dueHotelKeywords(['歐遊', '捷中正', '捷站前', '鉑麗'], { 歐遊: 'month', 捷中正: '25th' }, 'month'), ['捷站前', '鉑麗']);
    assert.deepEqual(dueHotelKeywords(['歐遊', '捷中正', '捷站前'], { 歐遊: 'month', 捷中正: 'month' }, '1st'), ['捷中正', '歐遊']);
    assert.equal(closingPeriod('歐遊', '2026-10-31', { 歐遊: 'month' }), null);
    assert.deepEqual(closingPeriod('捷中正', '2026-11-01', { 捷中正: 'month' }), { startDate: '2026-10-01', endDate: '2026-10-31' });
});

test('天慕 inherits the saved 天幕 group, 鉑麗 closes at month end, and H2O 西餐 stays on the H2O bill', () => {
    assert.equal(settlementGroup('天慕', { 天幕: '25th' }), '25th');
    assert.equal(settlementGroup('鉑麗', {}), 'month');
    assert.deepEqual(dueHotelKeywords(['鉑麗', '天慕'], { 天幕: '25th' }, 'month'), ['鉑麗']);
    assert.equal(settlementGroup('H2O', {}), '25th');
    const rows = rowsForPeriod([
        { id: 'west', data: { date: '2026-10-25', hotelKeyword: 'H2O', deptName: '西餐', items: [{ itemName: '口布', actualQty: 2, price: 8 }] } },
        { id: 'rooms', data: { date: '2026-10-25', hotelKeyword: 'H2O', deptName: '房務', items: [{ itemName: '床單', actualQty: 1, price: 10 }] } },
    ], 'H2O', '2026-09-26', '2026-10-25');
    assert.deepEqual(rows.map(row => row.hotel), ['H2O 西餐', 'H2O 房務']);
});

test('the sign page no longer starts statement generation', () => {
    const html = fs.readFileSync(new URL('../../../logistics.html', import.meta.url), 'utf8');
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(html.includes('tryAutoStatement'), false);
    assert.equal(html.includes('signature-statement-client'), false);
    assert.equal(index.match(/30 9 1,25,28,29,30,31 \* \*/g).length, 2);
    assert.match(index, /Asia\/Taipei/);
    assert.equal(index.includes('onDocumentWritten'), false);
});
