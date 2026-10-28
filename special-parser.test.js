import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FALLBACK_ITEMS } from './special-config.js';
import { parseSpecialEntry } from './special-parser.js';

const hotels = ['好六', '文七', '驛館', '歐遊', 'H2O', '花季Ａ館', '花季Ｃ館', '花季', '媚力泊', '捷中正', '承億'];
const date = '2026-10-27';

const cases = [
    ['好六\n一條床單一條被套三條足巾', '好六', [['特處床單', 1], ['特處被套', 1], ['特處足巾', 3]]],
    ['好六一條床單一條被套三條足巾', '好六', [['特處床單', 1], ['特處被套', 1], ['特處足巾', 3]]],
    ['好六，床單一條，被套一條，足巾三條。', '好六', [['特處床單', 1], ['特處被套', 1], ['特處足巾', 3]]],
    ['文七 大毛2 中毛1', '文七', [['特處大毛', 2], ['特處中毛', 1]]],
    ['文七兩條大毛十二條中毛', '文七', [['特處大毛', 2], ['特處中毛', 12]]],
    ['驛館枕頭', '驛館', [['特處枕頭', 1]]],
    ['好六 一床單 一被套 一枕頭 三條足巾', '好六', [['特處床單', 1], ['特處被套', 1], ['特處枕頭', 1], ['特處足巾', 3]]],
    ['好6一條床單3條足巾', '好六', [['特處床單', 1], ['特處足巾', 3]]],
    ['今天好六一條床單三條足金', '好六', [['特處床單', 1], ['特處足巾', 3]]],
    ['好六床單*1被套x2', '好六', [['特處床單', 1], ['特處被套', 2]]],
    ['好六二十條浴巾一件浴袍', '好六', [['特處浴巾', 20], ['特處浴袍', 1]]],
    ['好六 床單1被套二', '好六', [['特處床單', 1], ['特處被套', 2]]],
    ['好六一條床單被套二', '好六', [['特處床單', 1], ['特處被套', 2]]],
    ['好六特處床單1特處被套二', '好六', [['特處床單', 1], ['特處被套', 2]]],
];

function linesOf(result) {
    return result.lines.map(line => [line.item, line.qty, line.unknown]);
}

for (const [text, hotel, expected] of cases) {
    test(`parser: ${JSON.stringify(text)}`, () => {
        for (const items of [[], FALLBACK_ITEMS]) {
            const result = parseSpecialEntry(text, { hotels, items, receivedDate: date });
            assert.equal(result.ok, true, result.message);
            assert.equal(result.hotel, hotel);
            assert.deepEqual(result.lines.map(line => [line.item, line.qty]), expected);
            assert.equal(result.lines.every(line => line.unknown), false);
        }
    });
}

test('parser result line uses the Taipei month/day and 特處 prefix', () => {
    const result = parseSpecialEntry('好六 床單1被套二', { hotels, receivedDate: date });
    assert.equal(result.message, '已寫入 10/27：好六 特處床單*1 特處被套*2');
});

test('unknown hotel keeps the spoken name', () => {
    const result = parseSpecialEntry('好七一條床單', { hotels, receivedDate: date });
    assert.equal(result.ok, false);
    assert.equal(result.message, '找不到飯店：好七');
});

test('voice aliases, fullwidth digits, and a single 特處 prefix', () => {
    const result = parseSpecialEntry('嗯今天好６一條床单三條族巾被罩二枕投1枕头1浴跑', { hotels, receivedDate: date });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.lines.map(line => [line.item, line.qty]), [
        ['特處床單', 1],
        ['特處足巾', 3],
        ['特處被套', 2],
        ['特處枕頭', 2],
        ['特處浴袍', 1],
    ]);
    assert.equal(result.lines.some(line => line.item.startsWith('特處特處')), false);
});

test('measure word does not eat 床 from 床單 or 床包', () => {
    const sheet = parseSpecialEntry('好六一床單', { hotels, items: FALLBACK_ITEMS, receivedDate: date });
    assert.deepEqual(sheet.lines.map(line => [line.item, line.qty]), [['特處床單', 1]]);
    const cover = parseSpecialEntry('好六一床包', { hotels, items: FALLBACK_ITEMS, receivedDate: date });
    assert.deepEqual(cover.lines.map(line => [line.item, line.qty]), [['特處床包', 1]]);
});

test('unknown item is accepted and flagged', () => {
    const result = parseSpecialEntry('好六一條神奇布', { hotels, receivedDate: date });
    assert.equal(result.ok, true);
    assert.equal(result.lines[0].item, '特處神奇布');
    assert.equal(result.lines[0].unknown, true);
    assert.equal(result.message, '已寫入 10/27：好六 特處神奇布*1（新品項？）');
});

test('hotel numeral is consumed before a later quantity', () => {
    const result = parseSpecialEntry('好六6條毛巾', { hotels, receivedDate: date });
    assert.equal(result.hotel, '好六');
    assert.deepEqual(result.lines.map(line => [line.item, line.qty]), [['特處毛巾', 6]]);
});

test('longest hotel wins over a shorter prefix', () => {
    const result = parseSpecialEntry('花季Ａ館浴巾', { hotels, receivedDate: date });
    assert.equal(result.hotel, '花季Ａ館');
    assert.equal(result.lines[0].item, '特處浴巾');
});

test('system item that already says 特處 is not doubled', () => {
    const result = parseSpecialEntry('驛館特處嬰兒枕頭2', {
        hotels,
        items: ['特處嬰兒枕頭', '枕頭', '特處枕頭'],
        receivedDate: date,
    });
    assert.deepEqual(result.lines.map(line => [line.item, line.qty]), [['特處嬰兒枕頭', 2]]);
});

test('same item in one utterance adds up', () => {
    const result = parseSpecialEntry('好六床單一條床單2', { hotels, receivedDate: date });
    assert.deepEqual(result.lines.map(line => [line.item, line.qty]), [['特處床單', 3]]);
});

test('the folding page no longer has the temporary LINE input', () => {
    const page = fs.readFileSync(new URL('./special.html', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('./special-theme-factory.css', import.meta.url), 'utf8');
    for (const needle of ['臨時輸入', 'entryText', 'parseSpecialEntry', 'submit-entry', 'data-action="dictate"', 'addParsedEntry']) {
        assert.equal(page.includes(needle), false, needle);
        assert.equal(css.includes(needle), false, needle);
    }
});

test('existing inventory pages are not wired to the parser', () => {
    for (const file of ['index.html', 'logistics.html', 'sendwash.html', 'finance.html']) {
        const text = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
        assert.equal(text.includes('special_items'), false, file);
        assert.equal(text.includes('special-parser'), false, file);
        assert.equal(text.includes('parseSpecialEntry'), false, file);
    }
});
