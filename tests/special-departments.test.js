import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecialEntry } from '../special-parser.js';
import { buildInventoryWrites, inventoryCatalog } from '../special-inventory.js';
import { buildReceiptSpecialDocs } from '../special-receipt.js';
import {
    addParsedEntry, signWashBatch, signSpreadItem, signItem, returnToWash, sendSheet,
    needsSpread, washSlips, spreadCards, foldCards, officeSheets,
    officeSendBlockers, officeOutstanding, officeQtyFlags, foldedHandedQty,
    departmentReadPlan, returnWashHistory, normalizeInFlight,
} from '../special-flow.js';

const hotels = ['文旅', '驛館', '好六'];
const schedules = [
    { hotel: '驛館', department: '特處', days: [2, 4, 6, 0], rule: '收件後的下一個收送日' },
];

function ids() {
    let n = 0;
    return () => `sp${++n}`;
}

function entry(text, date = '2026-11-20') {
    return parseSpecialEntry(text, { hotels, receivedDate: date });
}

function byItem(docs, item) {
    return docs.find(doc => !doc.deleted && doc.item === item);
}

test('a new slip starts at 洗滌, and only sheets, duvets, and pillowcases need 撐開', () => {
    const [receipt] = buildReceiptSpecialDocs({
        hotel: '文旅', receivedDate: '2026-11-20', lines: [{ item: '特處中毛', qty: 3 }], time: '2026-11-20T01:00:00.000Z',
    });
    assert.equal(receipt.status, '待洗滌');
    const created = addParsedEntry([], entry('文旅中毛1'), { time: '2026-11-20T01:00:00.000Z', idFactory: ids() });
    assert.equal(created.docs[0].status, '待洗滌');
    assert.equal(needsSpread('特處床單'), true);
    assert.equal(needsSpread('特處被套'), true);
    assert.equal(needsSpread('特處枕套'), true);
    assert.equal(needsSpread('特處枕頭'), false);
    assert.equal(needsSpread('特處床包'), false);
    assert.equal(needsSpread('特處浴巾'), false);
});

test('洗滌 signs one hotel and day, then sheets go to 撐開 and other items go to 摺疊', () => {
    const created = addParsedEntry([], entry('驛館床單2浴巾1枕套1'), { time: '2026-11-20T01:00:00.000Z', idFactory: ids() });
    const washed = signWashBatch(created.docs, created.docs.map(doc => doc.id), {
        signature: 'wash-sig', time: '2026-11-20T02:00:00.000Z',
    });
    assert.equal(byItem(washed.docs, '特處床單').status, '待撐開');
    assert.equal(byItem(washed.docs, '特處枕套').status, '待撐開');
    assert.equal(byItem(washed.docs, '特處浴巾').status, '待摺疊');
    const sheet = byItem(washed.docs, '特處床單');
    const spread = signSpreadItem(washed.docs, sheet.id, { signature: 'spread-sig', time: '2026-11-20T03:00:00.000Z' });
    assert.equal(byItem(spread.docs, '特處床單').status, '待摺疊');
    assert.equal(byItem(spread.docs, '特處枕套').status, '待撐開');
    const folded = signItem(spread.docs, sheet.id, { shipQty: 2, signature: 'fold-sig', time: '2026-11-20T04:00:00.000Z', idFactory: ids() });
    const done = folded.docs.find(doc => doc.id === sheet.id);
    assert.equal(done.status, '已簽名');
    assert.equal(done.foldedQty, 2);
    assert.equal(done.shipDate, '');
    assert.equal(folded.docs.some(doc => doc.status === '已送出'), false);
});

test('a wash count that differs is flagged and still moves on; zero stays on 數量不符', () => {
    const created = addParsedEntry([], entry('驛館床單2浴巾1'), { time: '2026-11-20T01:00:00.000Z', idFactory: ids() });
    const sheet = byItem(created.docs, '特處床單');
    const towel = byItem(created.docs, '特處浴巾');
    const washed = signWashBatch(created.docs, [sheet.id, towel.id], {
        signature: 'wash-sig',
        time: '2026-11-20T02:00:00.000Z',
        actuals: { [sheet.id]: 1, [towel.id]: 0 },
    });
    const short = washed.docs.find(doc => doc.id === sheet.id);
    assert.equal(short.status, '待撐開');
    assert.equal(short.qty, 1);
    assert.equal(short.expectedQty, 2);
    assert.equal(short.discrepancyOpen, true);
    assert.match(short.history.at(-1).reason, /對點 2，實點 1/);
    const none = washed.docs.find(doc => doc.id === towel.id);
    assert.equal(none.status, '數量不符');
    assert.equal(spreadCards(washed.docs).flatMap(card => card.hotels.flatMap(hotel => hotel.lines)).some(line => line.id === towel.id), false);
    assert.equal(foldCards(washed.docs).length, 0);
});

test('文旅 11/20: 摺疊 returns one 大毛, and 辦公室 sends only what has arrived', () => {
    const idFactory = ids();
    const created = addParsedEntry([], entry('文旅中毛3大毛2', '2026-11-20'), { time: '2026-11-20T01:00:00.000Z', idFactory });
    const washed = signWashBatch(created.docs, created.docs.map(doc => doc.id), {
        signature: 'wash-sig', time: '2026-11-20T02:00:00.000Z',
    });
    const blanket = byItem(washed.docs, '特處中毛');
    const robe = byItem(washed.docs, '特處大毛');
    assert.equal(blanket.status, '待摺疊');
    assert.equal(robe.status, '待摺疊');
    const signedBlanket = signItem(washed.docs, blanket.id, { shipQty: 3, signature: 'fold-blanket', time: '2026-11-20T03:00:00.000Z', idFactory });
    const returned = returnToWash(signedBlanket.docs, robe.id, {
        qty: 1, reason: '髒污', signature: 'fold-back', time: '2026-11-21T01:00:00.000Z', returnDate: '2026-11-21', idFactory,
    });
    const stay = returned.docs.find(doc => doc.id === robe.id);
    const back = returned.docs.find(doc => doc.splitOf === robe.id);
    assert.equal(stay.status, '待摺疊');
    assert.equal(stay.qty, 1);
    assert.equal(stay.receivedDate, '2026-11-20');
    assert.equal(back.status, '待洗滌');
    assert.equal(back.qty, 1);
    assert.equal(back.receivedDate, '2026-11-20');
    assert.equal(back.returnDate, '2026-11-21');
    assert.equal(returnWashHistory(back).length, 1);
    assert.equal(returnWashHistory(back)[0].signature, 'fold-back');
    assert.equal(washSlips(returned.docs)[0].date, '2026-11-21');
    assert.equal(washSlips(returned.docs)[0].slips[0].returned, true);
    assert.equal(foldCards(returned.docs)[0].date, '2026-11-20');
    const atOffice = signItem(returned.docs, stay.id, { shipQty: 1, signature: 'fold-robe', time: '2026-11-21T04:00:00.000Z', idFactory });
    const readyIds = atOffice.docs.filter(doc => doc.status === '已簽名').map(doc => doc.id);
    assert.deepEqual(readyIds.sort(), [blanket.id, stay.id].sort());
    assert.equal(officeOutstanding(atOffice.docs, '文旅', '2026-11-20').some(doc => doc.id === back.id), true);
    assert.deepEqual(officeSendBlockers(atOffice.docs, readyIds), []);
    assert.equal(officeSheets(atOffice.docs)[0].blockers.length, 0);
    const selected = sendSheet(atOffice.docs, [blanket.id], { signature: 'office', time: '2026-11-21T05:00:00.000Z', schedules });
    assert.equal(selected.upserts.length, 1);
    assert.equal(selected.docs.find(doc => doc.id === blanket.id).status, '已送出');
    assert.equal(selected.docs.find(doc => doc.id === stay.id).status, '已簽名');
    assert.deepEqual(officeSheets(selected.docs).find(sheet => !sheet.sent).items.map(item => item.id), [stay.id]);
    const sent = sendSheet(atOffice.docs, readyIds, { signature: 'office', time: '2026-11-21T05:00:00.000Z', schedules });
    assert.equal(sent.docs.find(doc => doc.id === blanket.id).status, '已送出');
    assert.equal(sent.docs.find(doc => doc.id === stay.id).status, '已送出');
    assert.equal(sent.docs.find(doc => doc.id === back.id).status, '待洗滌');
    const again = signWashBatch(sent.docs, [back.id], { signature: 'wash-again', time: '2026-11-21T06:00:00.000Z' });
    assert.equal(again.docs.find(doc => doc.id === back.id).status, '待摺疊');
    assert.equal(foldCards(again.docs)[0].date, '2026-11-20');
});

test('辦公室 ticks the folded quantity and records a mismatch with who and when', () => {
    const created = addParsedEntry([], entry('文旅大毛2'), { time: '2026-11-20T01:00:00.000Z', idFactory: ids() });
    const washed = signWashBatch(created.docs, [created.docs[0].id], { signature: 'wash', time: '2026-11-20T02:00:00.000Z' });
    const folded = signItem(washed.docs, created.docs[0].id, { shipQty: 2, signature: 'fold', time: '2026-11-20T03:00:00.000Z', idFactory: ids() });
    const line = folded.docs[0];
    assert.equal(foldedHandedQty(line), 2);
    const received = { [line.id]: 1 };
    assert.equal(officeQtyFlags(folded.docs, [line.id], received)[0].message, '特處大毛 摺疊送出 2，辦公室實收 1');
    assert.deepEqual(officeSendBlockers(folded.docs, [line.id], received), []);
    const sent = sendSheet(folded.docs, [line.id], {
        signature: 'office-sig', time: '2026-11-23T02:00:00.000Z', schedules, received,
    });
    const done = sent.upserts[0];
    assert.equal(done.qty, 1);
    assert.equal(done.foldedQty, 2);
    assert.equal(done.officeQtyFlag, true);
    const flagged = done.history.find(event => event.type === 'office-qty');
    assert.equal(flagged.signature, 'office-sig');
    assert.equal(flagged.time, '2026-11-23T02:00:00.000Z');
    assert.equal(flagged.previousQty, 2);
    assert.equal(flagged.qty, 1);
    const catalog = inventoryCatalog([{ baseName: '文旅', hotel: '文旅 特處', item: '特處大毛', deptName: '特處' }]);
    const writes = buildInventoryWrites(sent.upserts.filter(doc => doc.qty > 0), catalog.get('文旅'), {
        signature: 'office-sig', timestamp: '2026-11-23T02:00:00.000Z',
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].count, '1');
});

test('驛館 inventory date is the next delivery day after the office signs, from the stored 收送規則', () => {
    const created = addParsedEntry([], entry('驛館枕頭1', '2026-11-20'), { time: '2026-11-20T01:00:00.000Z', idFactory: ids() });
    const washed = signWashBatch(created.docs, [created.docs[0].id], { signature: 'wash', time: '2026-11-20T02:00:00.000Z' });
    assert.equal(washed.docs[0].status, '待摺疊');
    const folded = signItem(washed.docs, created.docs[0].id, { shipQty: 1, signature: 'fold', time: '2026-11-23T01:00:00.000Z', idFactory: ids() });
    const sent = sendSheet(folded.docs, [created.docs[0].id], { signature: 'office', time: '2026-11-23T02:00:00.000Z', schedules });
    assert.equal(sent.upserts[0].shipDate, '2026-11-24');
    assert.match(sent.upserts[0].shipRule, /二四六日/);
    assert.equal(sent.upserts[0].receivedDate, '2026-11-20');
});

test('an unsigned legacy 待摺疊 row can still be folded, and each page reads only its own queue', () => {
    const legacy = normalizeInFlight({
        id: 'old', hotel: '好六', receivedDate: '2026-11-01', item: '特處床單', qty: 1, status: '待摺疊', officeName: '特處床單', deleted: false, history: [],
    });
    const folded = signItem([legacy], 'old', { shipQty: 1, signature: 'fold', time: '2026-11-23T02:00:00.000Z', idFactory: ids() });
    assert.equal(folded.docs[0].status, '已簽名');
    assert.equal(folded.docs[0].foldedQty, 1);
    assert.deepEqual(departmentReadPlan('wash'), { statuses: ['待洗滌'], discrepancy: false, sentByShipDate: false });
    assert.deepEqual(departmentReadPlan('spread'), { statuses: ['待撐開'], discrepancy: false, sentByShipDate: false });
    assert.deepEqual(departmentReadPlan('fold'), { statuses: ['待摺疊', '重工中'], discrepancy: false, sentByShipDate: false });
    const office = departmentReadPlan('office');
    assert.deepEqual(office.statuses, ['已簽名']);
    assert.deepEqual(office.upstream, ['待洗滌', '待撐開', '待摺疊', '重工中', '數量不符']);
    assert.equal(office.discrepancy, true);
    assert.equal(office.sentByShipDate, true);
});

test('撐開 and 辦公室 keep the original hotel send date after a return', () => {
    const created = addParsedEntry([], entry('驛館床單2', '2026-11-20'), { time: '2026-11-20T01:00:00.000Z', idFactory: ids() });
    const washed = signWashBatch(created.docs, [created.docs[0].id], { signature: 'wash', time: '2026-11-20T02:00:00.000Z' });
    const split = returnToWash(washed.docs, created.docs[0].id, {
        qty: 1, signature: 'spread-back', time: '2026-11-22T01:00:00.000Z', returnDate: '2026-11-22', idFactory: ids(),
    });
    const stay = split.docs.find(doc => doc.id === created.docs[0].id);
    assert.equal(stay.status, '待撐開');
    assert.equal(spreadCards(split.docs)[0].date, '2026-11-20');
    const folded = signSpreadItem(split.docs, stay.id, { signature: 'spread', time: '2026-11-22T02:00:00.000Z' });
    const signed = signItem(folded.docs, stay.id, { shipQty: 1, signature: 'fold', time: '2026-11-22T03:00:00.000Z', idFactory: ids() });
    assert.equal(officeSheets(signed.docs)[0].byDate[0].date, '2026-11-20');
    assert.equal(washSlips(split.docs)[0].date, '2026-11-22');
});
