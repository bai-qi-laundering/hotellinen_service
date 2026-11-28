import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    filterDispatchCases,
    sortCases,
    statementGeneratedAt,
} from '../statement-case.js';
import { sortCases as cloudSortCases } from '../firebase-signature/functions/lib/statement-case.js';
import { CASE_CACHE_KEY, createFirestoreRepository } from '../statement-store.js';

function bill(partial) {
    const versions = partial.versions || [{ version: 1, createdAt: partial.createdAt || partial.updatedAt }];
    return {
        id: partial.id,
        state: partial.state || 'pending',
        customerKey: partial.customerKey,
        customerName: partial.customerName || '',
        endDate: partial.endDate || '2026-11-25',
        startDate: partial.startDate || '2026-10-26',
        updatedAt: partial.updatedAt || versions[versions.length - 1].createdAt || '',
        latestVersion: partial.latestVersion || versions[versions.length - 1].version,
        invoiceStatus: partial.invoiceStatus || 'none',
        invoicedVersion: partial.invoicedVersion || null,
        versions,
    };
}

const november = [
    bill({ id: 'pending-old', customerKey: '承億', state: 'pending', updatedAt: '2026-11-27T00:00:00.000Z', versions: [{ version: 3, createdAt: '2026-11-27T00:00:00.000Z' }] }),
    bill({ id: 'sent-new', customerKey: '驛館', state: 'sent', updatedAt: '2026-11-01T00:00:00.000Z', versions: [{ version: 4, createdAt: '2026-11-28T03:39:50.202Z' }] }),
    bill({ id: 'restaurant', customerKey: '驛館-餐廳', customerName: '驛館餐廳', state: 'pending', endDate: '2026/11/30', versions: [{ version: 1, createdAt: '2026-11-02T00:00:00.000Z' }] }),
    bill({ id: 'flower', customerKey: '花季', state: 'sent', versions: [{ version: 2, createdAt: '2026-11-20T00:00:00.000Z' }] }),
    bill({ id: 'cheng-gym', customerKey: '承億', customerName: '承億健身房', state: 'pending', versions: [{ version: 1, createdAt: '2026-11-03T00:00:00.000Z' }] }),
    bill({ id: 'h2o', customerKey: 'H2O', state: 'sent', versions: [{ version: 1, createdAt: '2026-11-04T00:00:00.000Z' }] }),
    bill({ id: 'december', customerKey: '驛館', state: 'sent', endDate: '2026-12-25', versions: [{ version: 1, createdAt: '2026-12-01T00:00:00.000Z' }] }),
    bill({
        id: 'review',
        customerKey: '富野',
        state: 'sent',
        invoiceStatus: 'invoiced',
        invoicedVersion: 1,
        versions: [{ version: 2, createdAt: '2026-11-05T00:00:00.000Z', sentAt: '2026-11-05T01:00:00.000Z', review: 'invoiced_diff' }],
    }),
];

test('新產生或重新產生的帳單依產生時間排最前面', () => {
    const sorted = sortCases(november.filter(item => item.endDate.startsWith('2026-11') || item.endDate.startsWith('2026/11')));
    assert.equal(sorted[0].id, 'sent-new');
    assert.equal(statementGeneratedAt(sorted[0]), '2026-11-28T03:39:50.202Z');
    assert.ok(sorted.findIndex(item => item.id === 'sent-new') < sorted.findIndex(item => item.id === 'pending-old'));
    assert.deepEqual(cloudSortCases(sorted).map(item => item.id), sorted.map(item => item.id));
    const noCreatedAt = bill({ id: 'fallback', customerKey: '良西', state: 'pending', updatedAt: '2026-11-29T00:00:00.000Z', versions: [{ version: 1 }] });
    assert.equal(sortCases([sorted[0], noCreatedAt])[0].id, 'fallback');
});

test('結帳月份和飯店部分字串可一起篩，並保留分頁籤', () => {
    const yiguan = filterDispatchCases(november, { month: '2026-11', hotel: '驛館', status: 'all' });
    assert.deepEqual(yiguan.map(item => item.id), ['sent-new', 'restaurant']);
    const restaurant = filterDispatchCases(november, { month: '2026-11', hotel: '驛館餐廳', status: 'all' });
    assert.ok(restaurant.some(item => item.id === 'restaurant'));
    assert.equal(restaurant.some(item => item.id === 'flower'), false);
    assert.deepEqual(filterDispatchCases(november, { month: '2026-11', hotel: '花季Ａ館' }).map(item => item.id), ['flower']);
    assert.deepEqual(filterDispatchCases(november, { month: '2026-11', hotel: '承億健身房' }).map(item => item.id), ['pending-old', 'cheng-gym']);
    assert.deepEqual(filterDispatchCases(november, { month: '2026-11', hotel: 'Ｈ２Ｏ' }).map(item => item.id), ['h2o']);
    assert.deepEqual(filterDispatchCases(november, { month: '2026-11', hotel: '驛館', status: 'pending' }).map(item => item.id), ['restaurant']);
    assert.deepEqual(filterDispatchCases(november, { month: '2026-11', hotel: '驛館', status: 'sent' }).map(item => item.id), ['sent-new']);
    assert.deepEqual(filterDispatchCases(november, { month: '2026-11', status: 'needs_review' }).map(item => item.id), ['review']);
    assert.equal(filterDispatchCases(november, { month: '2026-11', hotel: '承億', status: 'sent' }).length, 0);
});

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(key, String(value)); },
    };
}

function snapshot(item) {
    return { id: item.id, data: () => item };
}

test('月份加飯店只讀結帳日區間，飯店在讀到的帳單裡比對', async () => {
    const queries = [];
    let templateReads = 0;
    const fns = {
        collection() { return { kind: 'collection' }; },
        query(ref, ...clauses) { return { kind: 'query', clauses }; },
        where(field, op, value) { return { field, op, value }; },
        async getDocsFromServer(target) {
            queries.push(target);
            return { docs: november.map(snapshot) };
        },
        doc() { return {}; },
        async getDocFromServer() { templateReads += 1; throw new Error('月份查詢不該讀範本'); },
    };
    const repo = createFirestoreRepository({}, fns, memoryStorage());
    const result = await repo.list({ skipFlush: true, month: '2026-11', keyword: '驛館' });
    assert.equal(templateReads, 0);
    assert.equal(queries.length, 2);
    assert.equal(queries.every(query => query.clauses.every(clause => clause.field === 'endDate' && clause.op !== 'in')), true);
    assert.deepEqual(result.cases.map(item => item.id), ['sent-new', 'restaurant']);
    assert.equal(result.fromCache, false);
});

test('雲端讀取失敗時，暫存也要套用月份和飯店', async () => {
    const cached = {
        keep: november.find(item => item.id === 'sent-new'),
        other: november.find(item => item.id === 'pending-old'),
        later: november.find(item => item.id === 'december'),
    };
    const fns = {
        collection() { return {}; },
        query() { return {}; },
        where() { return {}; },
        async getDocsFromServer() { throw new Error('offline'); },
    };
    const storage = memoryStorage({ [CASE_CACHE_KEY]: JSON.stringify(cached) });
    const repo = createFirestoreRepository({}, fns, storage);
    const result = await repo.list({ skipFlush: true, month: '2026-11', keyword: '驛館' });
    assert.equal(result.fromCache, true);
    assert.deepEqual(result.cases.map(item => item.id), ['sent-new']);
});

test('送件頁的飯店欄位立即篩選，不再把中文輸入送去雲端重查', () => {
    const dispatch = readFileSync(new URL('../statement-dispatch.html', import.meta.url), 'utf8');
    const hotel = dispatch.slice(dispatch.indexOf("id=\"filterHotel\""), dispatch.indexOf("id=\"clearSearch\""));
    const listener = dispatch.slice(dispatch.indexOf('function renderHotelFilter'), dispatch.indexOf("$('clearSearch')"));
    assert.match(dispatch, /filterDispatchCases\(cases/);
    assert.match(listener, /compositionend/);
    assert.doesNotMatch(listener, /hasLoaded/);
    assert.doesNotMatch(listener, /reload\(/);
    assert.match(hotel, /aria-label="搜尋飯店名稱"/);
    const store = readFileSync(new URL('../statement-store.js', import.meta.url), 'utf8');
    const list = store.slice(store.lastIndexOf('async list('));
    assert.match(list, /statementMatchesHotel/);
    assert.doesNotMatch(list, /canonicalDates/);
    assert.doesNotMatch(list, /dateField:'endDate'/);
});
