import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseSpecialEntry as pageParse } from '../special-parser.js';
import { FALLBACK_HOTELS, FALLBACK_ITEMS } from '../special-config.js';

const source = fs.readFileSync(new URL('./Parser.gs', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} }, exports: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'Parser.gs' });
const gas = sandbox.module.exports;

// Apps Script objects come from vm.runInContext. Their arrays keep that realm's
// prototype, which Node's deepEqual rejects even when the data is identical.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function pack(result) {
    return plain({
        ok: !!result.ok,
        code: result.code || '',
        hotel: result.hotel || '',
        hotelGuess: result.hotelGuess || '',
        message: result.message || '',
        receivedDate: result.receivedDate || '',
        lines: (result.lines || []).map(line => ({ item: line.item, qty: line.qty, unknown: !!line.unknown })),
    });
}

const samples = [
    '好六\n一條床單一條被套三條足巾',
    '好六一條床單一條被套三條足巾',
    '好六，床單一條，被套一條，足巾三條。',
    '文七 大毛2 中毛1',
    '文七兩條大毛十二條中毛',
    '驛館枕頭',
    '好六 一床單 一被套 一枕頭 三條足巾',
    '好6一條床單3條足巾',
    '今天好六一條床單三條足金',
    '好六床單*1被套x2',
    '好六二十條浴巾一件浴袍',
    '好六 床單1被套二',
    '好六一條床單被套二',
    '好六特處床單1特處被套二',
    '嗯今天好６一條床单三條族巾被罩二枕投1枕头1浴跑',
    '好六一床單',
    '好六一床包',
    '好六一條神奇布',
    '好七一條床單',
    '好六',
    '',
    '今天辛苦了',
    '文七兩條大毛十二條中毛特處枕套3',
];

for (const items of [[], FALLBACK_ITEMS]) {
    for (const text of samples) {
        test(`LINE parser matches special.html: ${JSON.stringify(text)} items=${items.length}`, () => {
            const options = { hotels: FALLBACK_HOTELS, items, receivedDate: '2026-10-27' };
            assert.deepEqual(pack(gas.parseSpecialEntry(text, options)), pack(pageParse(text, options)));
        });
    }
}

test('Parser.gs has no export keyword for Apps Script', () => {
    assert.equal(/\bexport\b/.test(source), false);
});

test('Parser.gs keeps the same parser body as special-parser.js', () => {
    const strip = src => src.replace(/^import .*$/gm, '').replace(/\bexport\s+/g, '');
    const norm = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    const page = norm(strip(fs.readFileSync(new URL('../special-time.js', import.meta.url), 'utf8'))
        + '\n' + strip(fs.readFileSync(new URL('../special-parser.js', import.meta.url), 'utf8')));
    const port = norm(source.slice(source.indexOf('function taipeiParts'), source.indexOf('var CANCEL_COMMANDS')));
    assert.equal(port, page.slice(page.indexOf('function taipeiParts')));
});

test('cancel commands tolerate the voice variants', () => {
    for (const text of ['取消上一筆', '取消剛剛那筆', '刪除上一筆', '嗯，刪除剛剛那筆喔', '取消上筆']) {
        assert.equal(gas.isCancelCommand(text), true, text);
    }
    assert.equal(gas.isCancelCommand('好六一條床單'), false);
    assert.equal(gas.mentionsHotelOrItem('今天辛苦了', { hotels: FALLBACK_HOTELS, items: [] }), false);
    assert.equal(gas.mentionsHotelOrItem('好六一條床單', { hotels: FALLBACK_HOTELS, items: [] }), true);
    assert.equal(gas.mentionsHotelOrItem('三條足巾', { hotels: FALLBACK_HOTELS, items: [] }), true);
});

test('LINE documents use the temporary-input fields and can only be soft-deleted before signing', () => {
    const parsed = gas.parseSpecialEntry('好六一條床單一條被套', { hotels: ['好六'], receivedDate: '2026-10-27' });
    const docs = gas.buildLineDocs(parsed, {
        time: '2026-10-27T01:02:03.000Z',
        entryId: 'en_test_ab12',
        userId: 'U123',
        displayName: '阿花',
        messageId: 'm1',
    });
    assert.equal(docs.length, 2);
    assert.deepEqual(Object.keys(docs[0]).sort(), [
        'createdAt', 'deleted', 'deletedAt', 'edits', 'entryId', 'foldSignature', 'foldSignedAt',
        'history', 'hotel', 'item', 'lineDisplayName', 'lineMessageId', 'lineUserId', 'officeName',
        'officeSignature', 'qty', 'receivedDate', 'round', 'sentAt', 'shipDate', 'shipRule',
        'source', 'splitOf', 'status', 'unknown',
    ]);
    assert.equal(docs[0].source, 'line');
    assert.equal(docs[0].status, '待摺疊');
    assert.equal(docs[0].createdAt, '2026-10-27T01:02:03.000Z');
    assert.equal(docs[0].lineUserId, 'U123');
    assert.equal(docs[0].lineDisplayName, '阿花');
    assert.equal(docs[0].officeName, docs[0].item);
    assert.equal(docs[0].history[0].type, 'created');
    assert.equal(gas.lineSummary(parsed.hotel, parsed.lines), '好六 特處床單*1 特處被套*1');
    docs.forEach(doc => { doc.id = doc.item; });
    const older = { ...docs[0], entryId: 'en_old_aaaa', createdAt: '2026-10-26T01:00:00.000Z', deleted: false };
    assert.equal(gas.latestEntryId([older, docs[1]], 'U123'), 'en_test_ab12');
    assert.equal(gas.entryDeleteDecision(docs).ok, true);
    const removed = gas.softDeleteDocs(docs, '2026-10-27T02:00:00.000Z');
    assert.equal(removed.every(doc => doc.deleted && doc.edits.at(-1).deleted), true);
    assert.equal(removed[0].history.at(-1).type, 'deleted');
    assert.equal(gas.entryDeleteDecision([{ ...docs[0], status: '已簽名', foldSignedAt: 't' }]).code, 'locked');
    assert.equal(gas.entryDeleteDecision([{ ...docs[0], status: '已送出' }]).code, 'locked');
    assert.equal(gas.entryDeleteDecision([{ ...docs[0], foldSignature: 'sig' }]).code, 'locked');
});
