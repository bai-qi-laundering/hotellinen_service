import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    RECEIPT_SOURCE, receiptSpecialItems, sameReceiptHotel, normalizeReceiptLines,
    receiptSpecialId, buildReceiptSpecialDocs, nextReceiptWrite,
} from '../special-receipt.js';

const LINE_KEYS = [
    'createdAt', 'deleted', 'deletedAt', 'edits', 'entryId', 'foldSignature', 'foldSignedAt',
    'history', 'hotel', 'item', 'lineDisplayName', 'lineMessageId', 'lineUserId', 'officeName',
    'officeSignature', 'qty', 'receivedDate', 'round', 'sentAt', 'shipDate', 'shipRule',
    'source', 'splitOf', 'status', 'unknown',
];

const settings = [
    { hotel: '巨蛋', department: '房務', item: '浴巾' },
    { hotel: '巨蛋', department: '特處', item: '特處床單' },
    { hotel: '巨蛋', department: '特處', item: '特處被套' },
    { hotel: '巨蛋', department: '特處', item: '特處床單' },
    { hotel: '巨蛋一般', department: '特處', item: '特處枕頭' },
    { hotel: '鉑麗', department: '房務', item: '特處抹布' },
    { hotel: '好六', department: '房務', item: '浴巾' },
];

test('only this hotel’s 特處 rows from the sheet are offered, in sheet order', () => {
    assert.deepEqual(receiptSpecialItems(settings, '巨蛋'), ['特處床單', '特處被套']);
    assert.deepEqual(receiptSpecialItems(settings, '鉑麗'), []);
    assert.deepEqual(receiptSpecialItems(settings, '好六'), []);
    assert.deepEqual(receiptSpecialItems(settings, '巨蛋一般'), ['特處枕頭']);
    assert.deepEqual(receiptSpecialItems([], '巨蛋'), []);
});

test('巨蛋 is not 鉑麗 or 巨蛋一般', () => {
    assert.equal(sameReceiptHotel('巨蛋', '巨蛋', '巨蛋'), true);
    assert.equal(sameReceiptHotel('巨蛋', '鉑麗'), false);
    assert.equal(sameReceiptHotel('巨蛋', '巨蛋一般'), false);
    assert.equal(sameReceiptHotel('', '巨蛋'), false);
});

test('receipt documents match the LINE special_items shape and use a stable id', () => {
    const lines = normalizeReceiptLines([
        { item: '特處床單', qty: '2' },
        { item: '特處被套', qty: 1 },
        { item: '特處床單', qty: '1' },
    ], ['特處床單', '特處被套']);
    assert.deepEqual(lines, [{ item: '特處床單', qty: 3 }, { item: '特處被套', qty: 1 }]);
    const docs = buildReceiptSpecialDocs({
        hotel: '巨蛋',
        receivedDate: '2026-11-11',
        lines,
        time: '2026-11-11T02:00:00.000Z',
    });
    assert.equal(docs.length, 2);
    assert.deepEqual(Object.keys(docs[0]).filter(key => key !== 'id').sort(), LINE_KEYS);
    assert.equal(docs[0].hotel, '巨蛋');
    assert.equal(docs[0].item, '特處床單');
    assert.equal(docs[0].officeName, '特處床單');
    assert.equal(docs[0].qty, 3);
    assert.equal(docs[0].source, RECEIPT_SOURCE);
    assert.equal(docs[0].status, '待摺疊');
    assert.equal(docs[0].unknown, false);
    assert.equal(docs[0].history[0].qty, 3);
    assert.equal(docs[0].id, receiptSpecialId('2026-11-11', '巨蛋', '特處床單'));
    assert.equal(docs[1].id, receiptSpecialId('2026-11-11', '巨蛋', '特處被套'));
    assert.notEqual(docs[0].id, receiptSpecialId('2026-11-11', '鉑麗', '特處床單'));
    assert.equal(docs[0].entryId, docs[1].entryId);
});

test('pressing submit again does not create a second quantity', () => {
    const [doc] = buildReceiptSpecialDocs({
        hotel: '巨蛋', receivedDate: '2026-11-11', lines: [{ item: '特處抹布', qty: 4 }],
        time: '2026-11-11T02:00:00.000Z',
    });
    const again = nextReceiptWrite(doc, doc);
    assert.equal(again.action, 'same');
    assert.equal(again.doc.qty, 4);
    const changed = nextReceiptWrite(doc, { ...doc, qty: 6, history: [{ type: 'created', time: 'later', qty: 6, round: 1 }] });
    assert.equal(changed.action, 'update');
    assert.equal(changed.doc.qty, 6);
    assert.equal(changed.doc.createdAt, doc.createdAt);
    assert.equal(changed.doc.history.length, 1);
    assert.throws(() => nextReceiptWrite({ ...doc, status: '已簽名', foldSignedAt: 't' }, doc), /沒有覆寫/);
    assert.throws(() => nextReceiptWrite({ ...doc, source: 'line' }, doc), /沒有覆寫/);
    assert.throws(() => nextReceiptWrite({ ...doc, hotel: '鉑麗' }, doc), /沒有覆寫/);
});

test('free text and zero quantities are rejected', () => {
    assert.throws(() => normalizeReceiptLines([{ item: '隨便打', qty: 1 }], ['特處床單']), /不在特處清單/);
    assert.throws(() => normalizeReceiptLines([{ item: '特處床單', qty: 0 }], ['特處床單']), /整數/);
    assert.throws(() => normalizeReceiptLines([], ['特處床單']), /請先加入/);
});

test('the receipt page writes special items without a new listener or the LINE parser', () => {
    const page = fs.readFileSync(new URL('../logistics.html', import.meta.url), 'utf8');
    assert.match(page, /特處對點/);
    assert.match(page, /special-receipt\.js/);
    assert.match(page, /receiptSpecialItems\(sendwashSettings, currentHotel\)/);
    assert.equal(page.includes('DEFAULT_SPECIAL_ITEMS'), false);
    assert.equal(page.includes('FALLBACK_ITEMS'), false);
    assert.equal(page.includes('parseSpecialEntry'), false);
    assert.equal(page.includes('special-parser'), false);
    assert.equal(page.includes('onSnapshot'), false);
    assert.match(page, /sameReceiptHotel/);
    const webhook = fs.readFileSync(new URL('../line-webhook/Code.gs', import.meta.url), 'utf8');
    assert.equal(webhook.includes('簽收單'), false);
});
