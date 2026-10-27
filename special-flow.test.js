import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecialEntry } from './special-parser.js';
import { computeShipDate } from './special-shipdate.js';
import {
    addParsedEntry, signItem, reworkItem, sendSheet, updateOfficeName,
    editItem, deleteItem, deleteEntry, entryMates,
    foldCards, officeSheets, reworkBadge, signedMark,
} from './special-flow.js';
import { taipeiParts } from './special-time.js';

const hotels = ['好六', '文七', '驛館'];
const schedules = [
    { hotel: '驛館', department: '特處', days: [2, 4, 6, 0], rule: '收件後的下一個收送日' },
];

function ids() {
    let n = 0;
    return () => `id${++n}`;
}

function entry(text, date = '2026-10-27') {
    return parseSpecialEntry(text, { hotels, receivedDate: date });
}

test('Taipei stamp for a UTC afternoon', () => {
    assert.equal(taipeiParts('2026-10-27T06:05:00.000Z').stamp, '10/27 14:05');
    assert.equal(taipeiParts('2026-10-27T16:30:00.000Z').date, '2026-10-28');
});

test('entry, same-day add, sign, office send', () => {
    const idFactory = ids();
    const time = '2026-10-27T01:00:00.000Z';
    let state = addParsedEntry([], entry('好六一條床單一條被套'), { time, idFactory });
    state = addParsedEntry(state.docs, entry('好六床單1'), { time: '2026-10-27T02:00:00.000Z', idFactory });
    const sheet = state.docs.find(doc => doc.item === '特處床單');
    assert.equal(sheet.qty, 2);
    assert.equal(sheet.status, '待摺疊');
    assert.equal(sheet.history.filter(event => event.type === 'created').length, 2);
    const cover = state.docs.find(doc => doc.item === '特處被套');
    const signedAt = '2026-10-27T06:05:00.000Z';
    const ship = computeShipDate('好六', '2026-10-27', schedules);
    const signed = signItem(state.docs, sheet.id, {
        shipQty: 2, signature: 'sig-fold', reason: '', shipDate: ship.shipDate, shipRule: ship.shipRule, time: signedAt, idFactory,
    });
    const signedDoc = signed.docs.find(doc => doc.id === sheet.id);
    assert.equal(signedDoc.status, '已簽名');
    assert.equal(signedDoc.foldSignature, 'sig-fold');
    assert.equal(signedDoc.shipDate, '2026-10-27');
    assert.equal(signedMark(signedDoc), '✓ 10/27 14:05');
    assert.equal(cover.qty, 1);
    const named = updateOfficeName(signed.docs, signedDoc.id, '特處床單（白）');
    const sent = sendSheet(named.docs, [signedDoc.id], { signature: 'sig-office', time: '2026-10-27T07:00:00.000Z' });
    const sentDoc = sent.docs.find(doc => doc.id === signedDoc.id);
    assert.equal(sentDoc.status, '已送出');
    assert.equal(sentDoc.officeName, '特處床單（白）');
    assert.equal(sentDoc.officeSignature, 'sig-office');
    assert.equal(sentDoc.sentAt, '2026-10-27T07:00:00.000Z');
    assert.equal(foldCards(sent.docs).length, 1);
    assert.equal(foldCards(sent.docs)[0].hotels[0].lines.length, 1);
    assert.equal(officeSheets(sent.docs).some(group => group.sent && group.items[0].id === signedDoc.id), true);
});

test('partial sign splits, then the remainder can be reworked to round 3', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('好六被套二'), { time: '2026-10-27T01:00:00.000Z', idFactory });
    const original = created.docs[0];
    assert.throws(() => signItem(created.docs, original.id, {
        shipQty: 1, signature: 'sig', reason: '', shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單', time: '2026-10-27T06:05:00.000Z', idFactory,
    }), /退回原因/);
    assert.throws(() => signItem(created.docs, original.id, {
        shipQty: 2, signature: '', reason: '', shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單', time: '2026-10-27T06:05:00.000Z', idFactory,
    }), /簽名/);
    const signed = signItem(created.docs, original.id, {
        shipQty: 1, signature: 'sig', reason: '髒污', shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單', time: '2026-10-27T06:05:00.000Z', idFactory,
    });
    assert.equal(original.qty, 2);
    assert.equal(original.history.length, 1);
    const office = signed.docs.find(doc => doc.status === '已簽名');
    const remain = signed.docs.find(doc => doc.status === '重工中');
    assert.equal(office.qty, 1);
    assert.equal(remain.qty, 1);
    assert.equal(remain.round, 2);
    assert.equal(reworkBadge(remain), '重工中・第2輪・髒污');
    assert.equal(remain.receivedDate, '2026-10-27');
    const again = reworkItem(signed.docs, remain.id, { reworkQty: 1, reason: '黃斑', time: '2026-10-27T08:00:00.000Z', idFactory });
    const third = again.docs.find(doc => doc.id === remain.id);
    assert.equal(third.round, 3);
    assert.equal(reworkBadge(third), '重工中・第3輪・黃斑');
    const cards = foldCards(again.docs);
    assert.equal(cards[0].label, '10/27');
    assert.equal(cards[0].hotels[0].hotel, '好六');
    assert.equal(cards[0].hotels[0].lines.length, 2);
});

test('rework of part of a line leaves the clean pieces on the same round', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('文七 大毛2'), { time: '2026-10-27T01:00:00.000Z', idFactory });
    const split = reworkItem(created.docs, created.docs[0].id, { reworkQty: 1, reason: '破損', time: '2026-10-27T03:00:00.000Z', idFactory });
    const stay = split.docs.find(doc => doc.status === '待摺疊');
    const dirty = split.docs.find(doc => doc.status === '重工中');
    assert.equal(stay.qty, 1);
    assert.equal(stay.round, 1);
    assert.equal(dirty.qty, 1);
    assert.equal(dirty.round, 2);
    assert.equal(reworkBadge(dirty), '重工中・第2輪・破損');
    assert.throws(() => reworkItem(split.docs, dirty.id, { reworkQty: 1, reason: '', time: '2026-10-27T04:00:00.000Z', idFactory }), /原因/);
});

test('cards are newest first, searchable, and office sheets separate sent batches', () => {
    const idFactory = ids();
    let state = { docs: [] };
    state = addParsedEntry(state.docs, entry('好六枕頭', '2026-10-26'), { time: '2026-10-26T01:00:00.000Z', idFactory });
    state = addParsedEntry(state.docs, entry('文七足巾', '2026-10-27'), { time: '2026-10-27T01:00:00.000Z', idFactory });
    const cards = foldCards(state.docs);
    assert.deepEqual(cards.map(card => card.date), ['2026-10-27', '2026-10-26']);
    assert.equal(foldCards(state.docs, '足巾')[0].hotels[0].hotel, '文七');
    assert.equal(foldCards(state.docs, '好六').length, 1);
    const ship = { shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單' };
    const signed = signItem(state.docs, state.docs.find(doc => doc.hotel === '文七').id, {
        shipQty: 1, signature: 'a', reason: '', ...ship, time: '2026-10-27T06:05:00.000Z', idFactory,
    });
    const pending = officeSheets(signed.docs);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].sent, false);
    assert.equal(pending[0].hotel, '文七');
    const sent = sendSheet(signed.docs, pending[0].items.map(item => item.id), { signature: 'office', time: '2026-10-27T09:00:00.000Z' });
    const sheets = officeSheets(sent.docs);
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].sent, true);
    assert.equal(foldCards(sent.docs).length, 1);
    assert.equal(foldCards(sent.docs)[0].date, '2026-10-26');
});

test('驛館 ship date is stored from the sign date, not the receive date', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('驛館枕頭', '2026-10-26'), { time: '2026-10-26T01:00:00.000Z', idFactory });
    const ship = computeShipDate('驛館', '2026-10-27', schedules);
    const signed = signItem(created.docs, created.docs[0].id, {
        shipQty: 1, signature: 'sig', reason: '', shipDate: ship.shipDate, shipRule: ship.shipRule, time: '2026-10-27T06:05:00.000Z', idFactory,
    });
    assert.equal(signed.docs[0].receivedDate, '2026-10-26');
    assert.equal(signed.docs[0].shipDate, '2026-10-29');
    assert.match(signed.docs[0].shipRule, /特處・二四六日/);
});

test('edit changes hotel, name, and qty, and keeps an edit log', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('好六一條床單'), { time: '2026-10-27T01:00:00.000Z', idFactory, entryId: 'en_edit' });
    const id = created.docs[0].id;
    const same = editItem(created.docs, id, { hotel: '好六', item: '特處床單', qty: 1, time: '2026-10-27T02:00:00.000Z' });
    assert.equal(same.upserts.length, 0);
    assert.throws(() => editItem(created.docs, id, { hotel: '  ', item: '足巾', qty: 2, time: '2026-10-27T02:00:00.000Z' }), /請填飯店/);
    assert.throws(() => editItem(created.docs, id, { hotel: '文七', item: '足巾', qty: 0, time: '2026-10-27T02:00:00.000Z' }), /數量不正確/);
    const edited = editItem(created.docs, id, { hotel: '文七', item: '足巾', qty: 4, time: '2026-10-27T02:00:00.000Z' });
    const doc = edited.upserts[0];
    assert.equal(doc.hotel, '文七');
    assert.equal(doc.item, '特處足巾');
    assert.equal(doc.qty, 4);
    assert.equal(doc.officeName, '特處足巾');
    assert.equal(doc.status, '待摺疊');
    assert.deepEqual(doc.edits[0].before, { hotel: '好六', item: '特處床單', qty: 1 });
    assert.deepEqual(doc.edits[0].after, { hotel: '文七', item: '特處足巾', qty: 4 });
    assert.equal(doc.edits[0].clearedSignature, false);
    assert.equal(doc.edits[0].time, '2026-10-27T02:00:00.000Z');
    assert.equal(doc.history.at(-1).type, 'edited');
    assert.equal(created.docs[0].item, '特處床單');
});

test('editing a signed line clears the signature only after acceptResign', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('好六被套二'), { time: '2026-10-27T01:00:00.000Z', idFactory });
    const signed = signItem(created.docs, created.docs[0].id, {
        shipQty: 2, signature: 'sig-fold', reason: '', shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單', time: '2026-10-27T06:05:00.000Z', idFactory,
    });
    assert.throws(() => editItem(signed.docs, created.docs[0].id, {
        hotel: '好六', item: '被套', qty: 3, time: '2026-10-27T07:00:00.000Z',
    }), error => error.needsResign === true && /重新簽名/.test(error.message));
    assert.equal(signed.docs.find(doc => doc.id === created.docs[0].id).status, '已簽名');
    const edited = editItem(signed.docs, created.docs[0].id, {
        hotel: '好六', item: '被套', qty: 3, time: '2026-10-27T07:00:00.000Z', acceptResign: true,
    });
    const doc = edited.docs.find(item => item.id === created.docs[0].id);
    assert.equal(doc.status, '待摺疊');
    assert.equal(doc.qty, 3);
    assert.equal(doc.foldSignature, '');
    assert.equal(doc.foldSignedAt, '');
    assert.equal(doc.shipDate, '');
    assert.equal(doc.shipRule, '');
    assert.equal(doc.edits[0].clearedSignature, true);
    assert.equal(officeSheets(edited.docs).length, 0);
    assert.equal(foldCards(edited.docs)[0].hotels[0].lines[0].qty, 3);
});

test('a rework line stays in rework when only the quantity changes', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('文七足巾'), { time: '2026-10-27T01:00:00.000Z', idFactory });
    const reworked = reworkItem(created.docs, created.docs[0].id, { reworkQty: 1, reason: '髒污', time: '2026-10-27T03:00:00.000Z', idFactory });
    const edited = editItem(reworked.docs, created.docs[0].id, {
        hotel: '文七', item: '足巾', qty: 2, time: '2026-10-27T04:00:00.000Z',
    });
    const doc = edited.upserts[0];
    assert.equal(doc.status, '重工中');
    assert.equal(doc.qty, 2);
    assert.equal(doc.edits[0].clearedSignature, false);
});

test('sent lines cannot be edited or deleted, and a soft delete leaves the screens', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('好六一條床單一條被套'), { time: '2026-10-27T01:00:00.000Z', idFactory, entryId: 'en_batch' });
    const sheet = created.docs.find(doc => doc.item === '特處床單');
    const signed = signItem(created.docs, sheet.id, {
        shipQty: 1, signature: 'sig', reason: '', shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單', time: '2026-10-27T06:05:00.000Z', idFactory,
    });
    const sent = sendSheet(signed.docs, [sheet.id], { signature: 'office', time: '2026-10-27T07:00:00.000Z' });
    assert.throws(() => editItem(sent.docs, sheet.id, { hotel: '好六', item: '床單', qty: 2, time: '2026-10-27T08:00:00.000Z', acceptResign: true }), /已送出，無法修改/);
    assert.throws(() => deleteItem(sent.docs, sheet.id, { time: '2026-10-27T08:00:00.000Z' }), /已送出，無法修改/);
    const cover = sent.docs.find(doc => doc.item === '特處被套');
    const removed = deleteItem(sent.docs, cover.id, { time: '2026-10-27T08:00:00.000Z' });
    const gone = removed.docs.find(doc => doc.id === cover.id);
    assert.equal(gone.deleted, true);
    assert.equal(gone.deletedAt, '2026-10-27T08:00:00.000Z');
    assert.equal(gone.history.at(-1).type, 'deleted');
    assert.equal(foldCards(removed.docs).flatMap(card => card.hotels.flatMap(hotel => hotel.lines)).some(line => line.id === cover.id), false);
    assert.equal(officeSheets(removed.docs).some(group => group.items.some(item => item.id === cover.id)), false);
    assert.equal(removed.docs.some(doc => doc.id === cover.id), true);
    const again = addParsedEntry(removed.docs, entry('好六被套1'), { time: '2026-10-27T09:00:00.000Z', idFactory, entryId: 'en_next' });
    const fresh = again.docs.filter(doc => doc.item === '特處被套' && !doc.deleted);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].qty, 1);
    assert.equal(fresh[0].entryId, 'en_next');
});

test('one message shares an entry id, and deleting it removes every unsent line', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('好六一條床單一條被套'), { time: '2026-10-27T01:00:00.000Z', idFactory, entryId: 'en_batch' });
    assert.equal(created.docs.every(doc => doc.entryId === 'en_batch'), true);
    assert.equal(entryMates(created.docs, created.docs[0]).length, 2);
    const merged = addParsedEntry(created.docs, entry('好六床單1一條足巾'), { time: '2026-10-27T02:00:00.000Z', idFactory, entryId: 'en_later' });
    const sheet = merged.docs.find(doc => doc.item === '特處床單');
    const towel = merged.docs.find(doc => doc.item === '特處足巾');
    assert.equal(sheet.qty, 2);
    assert.equal(sheet.entryId, 'en_batch');
    assert.equal(towel.entryId, 'en_later');
    const removed = deleteEntry(created.docs, 'en_batch', { time: '2026-10-27T03:00:00.000Z' });
    assert.equal(removed.upserts.length, 2);
    assert.equal(foldCards(removed.docs).length, 0);
    assert.equal(entryMates(removed.docs, removed.docs[0]).length, 0);
    const blocked = addParsedEntry([], entry('文七一條床單一條枕套'), { time: '2026-10-27T01:00:00.000Z', idFactory, entryId: 'en_sent' });
    const signed = signItem(blocked.docs, blocked.docs[0].id, {
        shipQty: 1, signature: 'sig', reason: '', shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單', time: '2026-10-27T06:05:00.000Z', idFactory,
    });
    const sent = sendSheet(signed.docs, [blocked.docs[0].id], { signature: 'office', time: '2026-10-27T07:00:00.000Z' });
    assert.equal(entryMates(sent.docs, sent.docs[1]).length, 0);
    assert.throws(() => deleteEntry(sent.docs, 'en_sent', { time: '2026-10-27T08:00:00.000Z' }), /已經送出/);
});
