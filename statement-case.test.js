import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    applySentRegistration,
    buildStatementTables,
    buildStatementWorkbook,
    caseDocumentId,
    fingerprintOf,
    formatCardAmount,
    mergeCaseDocs,
    payableAmount,
    publishSnapshot,
    renderStatementHtml,
    snapshotFromParts,
} from './statement-case.js';
import { createFirestoreRepository, createLocalRepository } from './statement-store.js';

function sample(overrides = {}) {
    return snapshotFromParts({
        customerKey: '驗證飯店',
        startDate: '2026-10-01',
        endDate: '2026-10-25',
        lineRecipient: '採購窗口',
        profile: {
            name: '驗證飯店股份有限公司',
            taxId: '12345678',
            contact: '採購窗口',
            phone: '07-0000000',
            address: '高雄市',
            terms: '月結 30 天',
            method: '銀行匯款',
        },
        departments: [{
            name: '驗證飯店 房務',
            total: 2000,
            summary: [
                { item: '浴巾', qty: 10, price: 20, amt: 200 },
                { item: '床單', qty: 30, price: 60, amt: 1800 },
            ],
            records: [
                { date: '2026-10-02', item: '浴巾', qty: 10, price: 20, amt: 200, docId: 'a' },
                { date: '2026-10-03', item: '床單', qty: 30, price: 60, amt: 1800, docId: 'b' },
            ],
        }],
        totals: {
            grandTotal: 2000,
            rounded: 2000,
            managementFee: { percent: '', amount: 0 },
            rebate: { percent: '', amount: 0 },
            afterRebate: 2000,
            tax: 100,
        },
        ...overrides,
    });
}

function changed() {
    const next = sample();
    next.departments[0].summary[0].qty = 11;
    next.departments[0].summary[0].amt = 220;
    next.departments[0].records[0].qty = 11;
    next.departments[0].records[0].amt = 220;
    next.departments[0].total = 2020;
    next.totals.grandTotal = 2020;
    next.totals.rounded = 2020;
    next.totals.afterRebate = 2020;
    next.totals.tax = 101;
    return snapshotFromParts(next);
}

function memoryStorage() {
    const map = new Map();
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(key, String(value)); },
    };
}

function memoryFirestore(options = {}) {
    const docs = new Map();
    let failures = options.failures || 0;
    const api = {
        fail(count) { failures = count; },
    };
    const fns = {
        doc(_db, _col, id) { return { id }; },
        collection() { return {}; },
        async getDocsFromServer() {
            return {
                docs: [...docs.entries()].map(([id, data]) => ({ id, data: () => structuredClone(data) })),
            };
        },
        async runTransaction(_db, fn) {
            if (failures > 0) {
                failures -= 1;
                throw new Error('network down');
            }
            const tx = {
                async get(ref) {
                    const data = docs.get(ref.id);
                    return { exists: () => data != null, data: () => structuredClone(data) };
                },
                set(ref, data) { docs.set(ref.id, structuredClone(data)); },
            };
            return fn(tx);
        },
    };
    return { db: {}, fns, docs, ...api };
}

test('產生對帳單會進送件案件，同一內容不新增版本也不清掉已寄送', async () => {
    const first = await publishSnapshot(null, sample(), '2026-10-30T01:00:00.000Z');
    assert.equal(first.action, 'created');
    assert.equal(first.doc.latestVersion, 1);
    assert.equal(first.doc.state, 'pending');
    const sent = applySentRegistration(first.doc, 1, 'xlsx', '2026-10-30T02:00:00.000Z');
    assert.equal(sent.state, 'sent');
    assert.equal(sent.invoiceStatus, 'ready');
    const again = await publishSnapshot(sent, sample(), '2026-10-30T03:00:00.000Z');
    assert.equal(again.action, 'unchanged');
    assert.equal(again.doc.latestVersion, 1);
    assert.equal(again.doc.state, 'sent');
    assert.equal(again.doc.versions[0].sentAt, '2026-10-30T02:00:00.000Z');
});

test('內容變更且舊版已寄出時變成新版待重寄，並保留舊版寄送紀錄', async () => {
    const first = await publishSnapshot(null, sample(), '2026-10-30T01:00:00.000Z');
    const sent = applySentRegistration(first.doc, 1, 'pdf', '2026-10-30T02:00:00.000Z');
    const next = await publishSnapshot(sent, changed(), '2026-10-30T03:00:00.000Z');
    assert.equal(next.action, 'published');
    assert.equal(next.doc.latestVersion, 2);
    assert.equal(next.doc.state, 'resend');
    assert.equal(next.doc.invoiceStatus, 'none');
    assert.equal(next.doc.versions[0].sentAt, '2026-10-30T02:00:00.000Z');
    assert.equal(next.doc.versions[1].sentAt, null);
    await assert.rejects(() => Promise.resolve().then(() => applySentRegistration(next.doc, 1, 'xlsx', '2026-10-30T04:00:00.000Z')), /更新的版本/);
    const registered = applySentRegistration(next.doc, 2, 'xlsx', '2026-10-30T04:00:00.000Z');
    assert.equal(registered.state, 'sent');
    assert.equal(registered.versions[0].sentAt, '2026-10-30T02:00:00.000Z');
});

test('已開票的帳單不會被新內容覆蓋', async () => {
    const first = await publishSnapshot(null, sample(), '2026-10-30T01:00:00.000Z');
    const invoiced = { ...first.doc, invoiceStatus: 'invoiced', invoicedVersion: 1, state: 'sent' };
    const next = await publishSnapshot(invoiced, changed(), '2026-10-30T03:00:00.000Z');
    assert.equal(next.action, 'needs_review');
    assert.equal(next.doc.invoiceStatus, 'invoiced');
    assert.equal(next.doc.state, 'needs_review');
    assert.equal(next.doc.versions[0].snapshot.departments[0].summary[0].qty, 10);
    assert.equal(next.doc.versions[1].review, 'invoiced_diff');
    assert.throws(() => applySentRegistration(next.doc, 2, 'xlsx', '2026-10-30T04:00:00.000Z'), /先不要登記寄出/);
});

test('對帳單畫面與 Excel 用同一份品項、數量與含稅金額', async () => {
    const snapshot = sample();
    const html = renderStatementHtml(snapshot);
    assert.match(html, /驗證飯店股份有限公司/);
    assert.match(html, /浴巾/);
    assert.match(html, /2,100/);
    assert.doesNotMatch(html, /示範/);
    const tables = buildStatementTables(snapshot);
    const sheet = tables.sheets[0];
    assert.equal(sheet.rows[sheet.monthlyEnd - 1][0], '部門合計');
    assert.equal(sheet.rows[sheet.monthlyEnd + 1][0], '02 交易明細');
    const workbook = buildStatementWorkbook({
        utils: {
            book_new: () => ({ SheetNames: [], Sheets: {} }),
            aoa_to_sheet(rows) {
                const ws = {};
                rows.forEach((row, r) => row.forEach((value, c) => {
                    ws[String.fromCharCode(65 + c) + (r + 1)] = { v: value };
                }));
                return ws;
            },
            book_append_sheet(wb, ws, name) { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
            encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
        },
    }, snapshot);
    assert.equal(workbook.SheetNames[0], '結算總表');
    assert.equal(workbook.Sheets['結算總表'].B2.v, '驗證飯店股份有限公司');
    const flat = JSON.stringify(tables);
    assert.match(flat, /浴巾/);
    assert.match(flat, /驗證飯店 房務/);
    assert.equal(tables.totalRows.some(row => row[1] === '含稅總金額' && row[2] === payableAmount(snapshot)), true);
    assert.equal(formatCardAmount(payableAmount(snapshot)), 'NT$ 2,100');
    assert.equal(await fingerprintOf(snapshot), await fingerprintOf(sample()));
    assert.notEqual(await fingerprintOf(snapshot), await fingerprintOf(changed()));
});

test('雲端失敗時先留在這台電腦，恢復後送件中心看得到', async () => {
    const storage = memoryStorage();
    const backend = memoryFirestore({ failures: 1 });
    const repo = createFirestoreRepository(backend.db, backend.fns, storage);
    await assert.rejects(() => repo.publish(sample(), '2026-10-30T01:00:00.000Z'), /network down/);
    const blocked = memoryFirestore({ failures: 5 });
    const pendingRepo = createFirestoreRepository(blocked.db, blocked.fns, storage);
    const pending = await pendingRepo.list();
    assert.equal(pending.cases.length, 1);
    assert.equal(pending.cases[0].cloudPending, true);
    assert.equal(pending.cases[0].customerName, '驗證飯店股份有限公司');
    const recovered = await repo.list();
    assert.equal(recovered.cases.length, 1);
    assert.equal(recovered.cases[0].cloudPending, false);
    assert.equal(recovered.cases[0].state, 'pending');
    const id = await caseDocumentId('驗證飯店', '2026-10-01', '2026-10-25');
    assert.equal(backend.docs.has(id), true);
});

test('寄出登記暫時寫不進雲端時，這台電腦仍顯示已登記', async () => {
    const storage = memoryStorage();
    const backend = memoryFirestore();
    const repo = createFirestoreRepository(backend.db, backend.fns, storage);
    const created = await repo.publish(sample(), '2026-10-30T01:00:00.000Z');
    backend.fail(20);
    await assert.rejects(() => repo.register(created.doc.id, 1, 'xlsx', '2026-10-30T02:00:00.000Z'), /network down/);
    const view = await repo.list();
    assert.equal(view.cases.length, 1);
    assert.equal(view.cases[0].state, 'sent');
    assert.equal(view.cases[0].cloudPending, true);
    assert.equal(view.cases[0].versions[0].sentAt, '2026-10-30T02:00:00.000Z');
});

test('本機送件庫可以登記已寄出，且不會把下載當成寄出', async () => {
    const repo = createLocalRepository(memoryStorage());
    const created = await repo.publish(sample(), '2026-10-30T01:00:00.000Z');
    assert.equal(created.doc.state, 'pending');
    const listed = await repo.list();
    assert.equal(listed[0].state, 'pending');
    const sent = await repo.register(created.doc.id, 1, 'xlsx', '2026-10-30T02:00:00.000Z');
    assert.equal(sent.state, 'sent');
    assert.equal(sent.versions[0].sentFormat, 'xlsx');
});

test('合併時保留已寄出紀錄', async () => {
    const created = await publishSnapshot(null, sample(), '2026-10-30T01:00:00.000Z');
    const remote = applySentRegistration({ ...created.doc, id: 'case_x' }, 1, 'xlsx', '2026-10-30T02:00:00.000Z');
    const local = { ...created.doc, id: 'case_x', state: 'pending', updatedAt: '2026-10-30T03:00:00.000Z' };
    const merged = mergeCaseDocs(remote, local);
    assert.equal(merged.state, 'sent');
    assert.equal(merged.versions[0].sentAt, '2026-10-30T02:00:00.000Z');
    assert.equal(merged.cloudPending, false);
});

test('財務搜尋修正仍在，送件頁不再使用示範飯店', () => {
    const finance = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    const dashboard = fs.readFileSync(new URL('./finance-dashboard.html', import.meta.url), 'utf8');
    const dispatch = fs.readFileSync(new URL('./statement-dispatch.html', import.meta.url), 'utf8');
    assert.match(finance, /id="keywordFilter"/);
    assert.match(finance, /oncompositionend="filterCheckboxes\(\)"/);
    assert.match(finance, /id="settlementHotelSearch"/);
    assert.match(finance, /filterSettlementHotelRows/);
    assert.match(finance, /statementRepo\.publish\(snapshot\)/);
    assert.match(finance, /renderStatementHtml/);
    assert.match(finance, /createFirestoreRepository/);
    assert.doesNotMatch(dispatch, /示範飯店/);
    assert.doesNotMatch(dispatch, /介面模擬/);
    assert.match(dispatch, /statement-case\.js/);
    assert.match(dashboard, /statement-dispatch\.html/);
    assert.doesNotMatch(dashboard, /尚不能實際寄送/);
});
