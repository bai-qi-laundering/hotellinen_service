import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SAME_DAY_HOTELS, PREVIOUS_DAY_HOTELS, computeShipDate, legacyTargetDate, parseDeliveryDays } from './special-shipdate.js';

const yiguan = [
    { hotel: '驛館', department: '房務', days: [2, 4, 6, 0], rule: '收件後的下一個收送日' },
    { hotel: '驛館', department: '制服', days: [2, 4, 6, 0], rule: '收件後的下一個收送日' },
    { hotel: '驛館', department: '法餐', days: [2, 4, 6], rule: '收件後的下一個收送日' },
    { hotel: '驛館', department: '特處', days: [2, 4, 6, 0], rule: '收件後的下一個收送日' },
];

test('2026-10-27 is a Tuesday', () => {
    assert.equal(new Date(2026, 9, 27, 12).getDay(), 2);
});

test('特處 row wins over other departments, and the sign day itself is skipped', () => {
    const tuesday = computeShipDate('驛館', '2026-10-27', yiguan);
    assert.equal(tuesday.step, 1);
    assert.equal(tuesday.shipDate, '2026-10-29');
    assert.equal(tuesday.shipRule, '收送日設定・特處・二四六日・收件後的下一個收送日');

    assert.equal(computeShipDate('驛館', '2026-10-29', yiguan).shipDate, '2026-10-31');
    assert.equal(computeShipDate('驛館', '2026-10-31', yiguan).shipDate, '2026-11-01');
    assert.equal(computeShipDate('驛館', '2026-11-01', yiguan).shipDate, '2026-11-03');
    assert.equal(computeShipDate('驛館', '2026-12-31', yiguan).shipDate, '2027-01-02');
});

test('特處 wins even when an earlier row has different weekdays', () => {
    const reordered = [
        { hotel: '驛館', department: '法餐', days: [2, 4, 6], rule: '收件後的下一個收送日' },
        { hotel: '驛館', department: '特處', days: [2, 4, 6, 0], rule: '收件後的下一個收送日' },
    ];
    const saturday = computeShipDate('驛館', '2026-10-31', reordered);
    assert.equal(saturday.step, 1);
    assert.equal(saturday.shipDate, '2026-11-01');
    const frenchOnly = computeShipDate('驛館', '2026-10-31', reordered.filter(row => row.department !== '特處'));
    assert.equal(frenchOnly.step, 2);
    assert.equal(frenchOnly.shipDate, '2026-11-03');
    assert.match(frenchOnly.shipRule, /^收送日設定・法餐・二四六/);
});

test('hotel with only a non-特處 row uses that fixed weekday', () => {
    const schedules = [{ hotel: '建工', department: '餐廳', days: '三、六', rule: '收件後的下一個收送日' }];
    const result = computeShipDate('建工', '2026-10-27', schedules);
    assert.equal(result.step, 2);
    assert.equal(result.shipDate, '2026-10-28');
    assert.equal(result.shipRule, '收送日設定・餐廳・三六・收件後的下一個收送日');
});

test('step 3 matches index.html when the hotel has no schedule', () => {
    assert.deepEqual(computeShipDate('好六', '2026-10-27', []), {
        shipDate: '2026-10-27', shipRule: '沿用盤點規則・當日打單', step: 3,
    });
    assert.equal(computeShipDate('文七', '2026-10-27', []).shipDate, '2026-10-27');
    assert.equal(computeShipDate('媚力泊', '2026-10-27', []).shipDate, '2026-10-27');
    assert.equal(computeShipDate('花季Ａ館', '2026-10-27', []).shipDate, '2026-10-27');
    assert.equal(computeShipDate('H2O', '2026-10-27', []).shipDate, '2026-10-27');
    assert.deepEqual(computeShipDate('捷中正', '2026-10-27', []), {
        shipDate: '2026-10-26', shipRule: '沿用盤點規則・前一日（捷中正）', step: 3,
    });
    assert.deepEqual(computeShipDate('承億', '2026-10-27', []), {
        shipDate: '2026-10-28', shipRule: '沿用盤點規則・隔日打單', step: 3,
    });
    assert.equal(computeShipDate('驛館', '2026-10-31', []).shipDate, '2026-11-01');
});

test('a 特處 schedule overrides the same-day and previous-day lists', () => {
    const monday = [{ hotel: '好六', department: '特處', days: [1], rule: '收件後的下一個收送日' }];
    const moved = computeShipDate('好六', '2026-10-27', monday);
    assert.equal(moved.step, 1);
    assert.equal(moved.shipDate, '2026-11-02');
    const jiejie = [{ hotel: '捷中正', department: '房務', days: [1], rule: '收件後的下一個收送日' }];
    assert.equal(computeShipDate('捷中正', '2026-10-27', jiejie).shipDate, '2026-11-02');
    assert.equal(computeShipDate('捷中正', '2026-10-27', jiejie).step, 2);
});

test('weekday text and broken rows', () => {
    assert.deepEqual(parseDeliveryDays('二、四、六、日').sort(), [0, 2, 4, 6]);
    assert.deepEqual(parseDeliveryDays('二四六日').sort(), [0, 2, 4, 6]);
    assert.equal(parseDeliveryDays('二四六X'), null);
    const broken = [{ hotel: '承億', department: '特處', days: '禮拜八', rule: '收件後的下一個收送日' }];
    assert.equal(computeShipDate('承億', '2026-10-27', broken).step, 3);
    assert.equal(computeShipDate('承億', '2026-10-27', broken).shipDate, '2026-10-28');
});

test('fallback hotel lists are the ones written in index.html', () => {
    const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    const today = index.split('\n').find(line => line.includes('const todayHotels'));
    const yesterday = index.split('\n').find(line => line.includes('const yesterdayHotels'));
    for (const hotel of SAME_DAY_HOTELS) assert.equal(today.includes(`"${hotel}"`), true, hotel);
    for (const hotel of PREVIOUS_DAY_HOTELS) assert.equal(yesterday.includes(`"${hotel}"`), true, hotel);
    assert.equal(legacyTargetDate('歐遊', '2026-01-01').shipDate, '2026-01-01');
    assert.equal(legacyTargetDate('捷中正', '2026-01-01').shipDate, '2025-12-31');
    assert.equal(legacyTargetDate('洲際', '2026-01-01').shipDate, '2026-01-02');
});
