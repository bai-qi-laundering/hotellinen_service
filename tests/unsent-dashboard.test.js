import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closingPeriod, settlementGroup } from '../firebase-signature/functions/lib/auto-close.js';
import {
    buildUnsentBoard,
    currentBillingPeriods,
    formatBoardPeriod,
    invoiceMark,
    periodEndDates,
    periodOnBillingDay,
    sendState,
    settlementGroupOf,
} from '../unsent-dashboard.js';

const names = ['富野', '日航', '天慕', '鉑麗', '麥當勞', 'H2O', '鼎王', '文旅'];

test('dashboard grouping matches the billing function, including 天幕 and 1號', () => {
    for (const name of names) {
        assert.equal(settlementGroupOf(name, {}), settlementGroup(name, {}));
        assert.equal(settlementGroupOf(name, { 天幕: '25th' }), settlementGroup(name, { 天幕: '25th' }));
    }
    assert.equal(settlementGroupOf('天慕', { 天幕: '1st' }), '1st');
    assert.equal(settlementGroup('天慕', { 天幕: '1st' }), '1st');
    assert.equal(settlementGroupOf('文旅', { 文旅: '' }), '');
});

test('current periods are the latest billing day on or before today', () => {
    const oct31 = currentBillingPeriods('2026-10-31');
    assert.deepEqual(oct31['25th'], { start: '2026-09-26', end: '2026-10-25' });
    assert.deepEqual(oct31.month, { start: '2026-10-01', end: '2026-10-31' });
    assert.deepEqual(oct31['1st'], { start: '2026-09-01', end: '2026-09-30' });
    assert.deepEqual(periodEndDates(oct31), ['2026-10-25', '2026-10-31', '2026-09-30']);

    const oct24 = currentBillingPeriods('2026-10-24');
    assert.deepEqual(oct24['25th'], { start: '2026-08-26', end: '2026-09-25' });
    assert.deepEqual(oct24.month, { start: '2026-09-01', end: '2026-09-30' });
    assert.deepEqual(oct24['1st'], { start: '2026-09-01', end: '2026-09-30' });

    const nov1 = currentBillingPeriods('2026-11-01');
    assert.deepEqual(nov1['1st'], { start: '2026-10-01', end: '2026-10-31' });
    assert.deepEqual(nov1.month, { start: '2026-10-01', end: '2026-10-31' });
    assert.deepEqual(nov1['25th'], { start: '2026-09-26', end: '2026-10-25' });
    assert.deepEqual(closingPeriod('文旅', '2026-11-01', { 文旅: '1st' }), {
        startDate: nov1['1st'].start,
        endDate: nov1['1st'].end,
    });

    const jan1 = currentBillingPeriods('2026-01-01');
    assert.deepEqual(jan1['1st'], { start: '2025-12-01', end: '2025-12-31' });
    assert.deepEqual(jan1['25th'], { start: '2025-11-26', end: '2025-12-25' });
    assert.deepEqual(jan1.month, { start: '2025-12-01', end: '2025-12-31' });
    assert.deepEqual(periodOnBillingDay('1st', '2028-03-01'), { start: '2028-02-01', end: '2028-02-29' });
    assert.equal(currentBillingPeriods('2026-02-31'), null);
});

function bill(customerKey, startDate, endDate, extra = {}) {
    return {
        customerKey,
        startDate,
        endDate,
        latestVersion: 1,
        versions: [{ version: 1, sentAt: null }],
        invoiceStatus: 'none',
        ...extra,
    };
}

test('send and invoice states follow the latest version only', () => {
    assert.deepEqual(sendState(null), { kind: 'missing', label: '尚未產生' });
    assert.equal(sendState(bill('富野', '2026-09-26', '2026-10-25')).label, '已產生未送');
    const sent = bill('富野', '2026-09-26', '2026-10-25', {
        invoiceStatus: 'ready',
        versions: [{ version: 1, sentAt: '2026-10-25T01:00:00.000Z' }],
    });
    assert.equal(sendState(sent).kind, 'sent');
    assert.equal(invoiceMark(sent).label, '未開發票');
    const resend = bill('富野', '2026-09-26', '2026-10-25', {
        latestVersion: 2,
        versions: [
            { version: 1, sentAt: '2026-10-25T01:00:00.000Z' },
            { version: 2, sentAt: null },
        ],
    });
    assert.equal(sendState(resend).label, '已產生未送（新版待重寄）');
    const invoiced = bill('富野', '2026-09-26', '2026-10-25', {
        invoiceStatus: 'invoiced',
        invoicedVersion: 1,
        invoiceRecord: { number: 'AB12345678', version: 1 },
        versions: [{ version: 1, sentAt: '2026-10-25T01:00:00.000Z' }],
    });
    assert.equal(invoiceMark(invoiced).open, false);
    const stale = bill('富野', '2026-09-26', '2026-10-25', {
        latestVersion: 2,
        invoiceStatus: 'invoiced',
        invoicedVersion: 1,
        invoiceRecord: { number: 'AB12345678', version: 1 },
        versions: [
            { version: 1, sentAt: '2026-10-25T01:00:00.000Z' },
            { version: 2, sentAt: null, review: 'invoiced_diff' },
        ],
    });
    assert.equal(sendState(stale).label, '已產生未送（開票後有變）');
    assert.equal(invoiceMark(stale).label, '開票後有變');
});

test('board counts the current period only and keeps hotels with no billing day', () => {
    const board = buildUnsentBoard({
        today: '2026-10-31',
        baseNames: ['富野', '天慕', '英迪格', '候工所', '驛館', '日航', '老新', '鉑麗', '文旅', '禾寓', '麥當勞', '鼎王'],
        items: [
            { baseName: '鼎王', hotel: '鼎王 七賢' },
            { baseName: '鼎王', hotel: '鼎王 回洗' },
            { baseName: '天幕', hotel: '天幕 餐廳' },
        ],
        groups: {
            天幕: '25th',
            文旅: '1st',
            禾寓: '1st',
            麥當勞: '',
            癮君子: '',
            新店: '15',
            鼎王: 'month',
        },
        cases: [
            bill('天慕', '2026-09-26', '2026-10-25'),
            bill('英迪格', '2026-09-26', '2026-10-25', {
                latestVersion: 2,
                versions: [
                    { version: 1, sentAt: '2026-10-25T01:00:00.000Z' },
                    { version: 2, sentAt: null },
                ],
            }),
            bill('候工所', '2026-09-26', '2026-10-25', {
                invoiceStatus: 'invoiced',
                invoicedVersion: 1,
                invoiceRecord: { number: 'AB12345678' },
                versions: [{ version: 1, sentAt: '2026-10-25T01:00:00.000Z' }],
            }),
            bill('驛館', '2026-09-26', '2026-10-25', {
                invoiceStatus: 'ready',
                versions: [{ version: 1, sentAt: '2026-10-25T02:00:00.000Z' }],
            }),
            bill('富野', '2026-08-26', '2026-09-25'),
            bill('日航', '2026-10-01', '2026-10-31', {
                invoiceStatus: 'none',
                versions: [{ version: 1, sentAt: '2026-10-31T01:00:00.000Z' }],
            }),
            bill('鉑麗', '2026-10-01', '2026-10-31', {
                latestVersion: 2,
                invoiceStatus: 'invoiced',
                invoicedVersion: 1,
                invoiceRecord: { number: 'CD12345678', version: 1 },
                versions: [
                    { version: 1, sentAt: '2026-10-31T01:00:00.000Z' },
                    { version: 2, sentAt: null, review: 'invoiced_diff' },
                ],
            }),
            bill('禾寓', '2026-09-01', '2026-09-30'),
            bill('文旅', '2026-09-01', '2026-09-30', {
                invoiceStatus: 'invoiced',
                invoicedVersion: 1,
                invoiceRecord: { number: 'EF12345678' },
                versions: [{ version: 1, sentAt: '2026-10-01T01:00:00.000Z' }],
            }),
            bill('鼎王 七賢', '2026-10-01', '2026-10-31', {
                versions: [{ version: 1, sentAt: '2026-10-31T01:00:00.000Z' }],
            }),
            bill('鼎王 富國', '2026-10-01', '2026-10-31'),
        ],
    });
    const group = id => board.groups.find(item => item.id === id);
    assert.deepEqual(group('25th').unsent.map(row => row.name), ['天慕', '英迪格', '富野']);
    assert.equal(group('25th').unsentCount, 3);
    assert.equal(group('25th').unsent.find(row => row.name === '富野').sendLabel, '尚未產生');
    assert.equal(group('25th').unsent.find(row => row.name === '天慕').sendLabel, '已產生未送');
    assert.equal(group('25th').unsent.find(row => row.name === '英迪格').sendLabel, '已產生未送（新版待重寄）');
    assert.deepEqual(group('25th').uninvoiced.map(row => row.name), ['天慕', '英迪格', '富野', '驛館']);
    assert.equal(group('25th').uninvoiced.find(row => row.name === '候工所'), undefined);
    assert.deepEqual(group('month').unsent.map(row => [row.name, row.sendLabel]), [
        ['老新', '尚未產生'],
        ['鉑麗', '已產生未送（開票後有變）'],
        ['鼎王 富國', '已產生未送'],
    ]);
    assert.equal(group('month').unsent.find(row => row.name === '日航'), undefined);
    assert.equal(group('month').uninvoiced.find(row => row.name === '日航').invoiceLabel, '未開發票');
    assert.equal(group('month').uninvoiced.find(row => row.name === '鉑麗').invoiceLabel, '開票後有變');
    assert.equal(group('month').unsent.some(row => row.name.includes('回洗')), false);
    assert.equal(group('month').unsent.some(row => row.name === '鼎王'), false);
    assert.deepEqual(group('1st').unsent.map(row => row.name), ['禾寓']);
    assert.equal(group('1st').uninvoicedCount, 1);
    assert.equal(group('1st').period.end, '2026-09-30');
    assert.deepEqual(board.unset, ['麥當勞', '癮君子']);
    assert.deepEqual(board.unsupported, [{ name: '新店', value: '15' }]);
    assert.equal(JSON.stringify(board).includes('天幕'), false);
    assert.equal(formatBoardPeriod(group('25th').period), '2026/09/26－2026/10/25');
});

test('the dashboard query stays on the current period and does not listen', () => {
    const source = readFileSync(new URL('../unsent-dashboard.js', import.meta.url), 'utf8');
    assert.equal(source.includes('onSnapshot'), false);
    assert.equal(source.includes('logistics_records'), false);
    assert.match(source, /where\('endDate', 'in'/);
    assert.match(source, /getDocFromServer/);
    assert.match(source, /getDocsFromServer/);
    const dispatch = readFileSync(new URL('../statement-dispatch.html', import.meta.url), 'utf8');
    const finance = readFileSync(new URL('../finance.html', import.meta.url), 'utf8');
    assert.match(dispatch, /id="unsent-dashboard"/);
    assert.match(finance, /id="unsentDashboardHost"/);
    assert.match(finance, /value="1st"/);
    assert.match(finance, /1 號（上個曆月，每月 1 日結帳）/);
});
