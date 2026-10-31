import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceEngine } from './firebase-signature/functions/lib/auto-close.js';
import {
    parsePriceCell, sheetPricesFromRows, datedPrice, catalogPrice, unitPriceForRecord,
    mergePriceCatalog, attemptWithBackoff,
} from './firebase-signature/functions/lib/price-catalog.js';

test('currency text parses, and a blank cell is unknown rather than zero', () => {
    assert.equal(parsePriceCell('$15'), 15);
    assert.equal(parsePriceCell('$8.8'), 8.8);
    assert.equal(parsePriceCell('＄24.2'), 24.2);
    assert.equal(parsePriceCell('1,200'), 1200);
    assert.equal(parsePriceCell(0), 0);
    assert.equal(parsePriceCell(''), null);
    assert.equal(parsePriceCell('  '), null);
    assert.equal(parsePriceCell(null), null);
    assert.equal(parsePriceCell('不是價格'), null);
});

test('sheet rows keep an explicit zero and drop blank or unreadable cells', () => {
    const prices = sheetPricesFromRows([
        ['飯店名稱', '部門分類', '品項名稱', '價格'],
        ['頭等艙', '房務', '床單', ''],
        ['H2O', '房務', '床單', '$15'],
        ['歐遊', '回洗', '床單', 0],
        ['壞掉', '房務', '枕套', '待補'],
    ]);
    assert.deepEqual(prices, { 'H2O 房務_床單': 15, '歐遊 回洗_床單': 0 });
});

test('Firebase keeps the earlier price until the next effective date', () => {
    const rules = [
        { key: '鈞怡 房務_床單', start: '2026-09-01', price: 10 },
        { key: '鈞怡 房務_床單', start: '2026-10-01', price: 11 },
    ];
    assert.equal(datedPrice(rules, '鈞怡 房務', '床單', '2026-09-15'), 10);
    assert.equal(datedPrice(rules, '鈞怡 房務', '床單', '2026-10-02'), 11);
    assert.equal(datedPrice(rules, '鈞怡 房務', '床單', '2026-08-31'), null);
});

test('a blank sheet cell falls back to the Firebase catalog instead of billing zero', () => {
    const sheetPrices = sheetPricesFromRows([
        ['飯店名稱', '部門分類', '品項名稱', '價格'],
        ['頭等艙', '房務', '床單', ''],
        ['H2O', '房務', '足巾', '$24.2'],
    ]);
    const customPrices = { '頭等艙 房務_床單': 11.5, 'H2O 房務_足巾': 3.8 };
    const rules = [{ key: 'H2O 房務_足巾', start: '2026-08-26', price: 24.2 }];
    assert.deepEqual(
        catalogPrice({ hotel: '頭等艙 房務', item: '床單', date: '2026-10-02', rules, customPrices, sheetPrices }),
        { price: 11.5, source: 'firebase' },
    );
    assert.equal(catalogPrice({
        hotel: 'H2O 房務', item: '足巾', date: '2026-10-20', rules, customPrices, sheetPrices,
    }).price, 24.2);
    assert.equal(catalogPrice({
        hotel: 'H2O 房務', item: '足巾', date: '2026-08-01', rules, customPrices, sheetPrices,
    }).price, 3.8);
    assert.equal(catalogPrice({
        hotel: '沒有', item: '床單', date: '2026-10-01', rules, customPrices, sheetPrices,
    }).price, null);
});

test('a receipt without a saved price uses Firebase, and a missing price stays null', () => {
    const catalog = {
        rules: [],
        customPrices: { '頭等艙 房務_床單': 11.5 },
        sheetPrices: {},
    };
    assert.equal(unitPriceForRecord(
        { hotel: '頭等艙 房務', item: '床單', date: '2026-10-02' }, catalog, 0,
    ), 11.5);
    assert.equal(unitPriceForRecord(
        { hotel: '頭等艙 房務', item: '沒有這個', date: '2026-10-02' }, catalog, 0,
    ), null);
    assert.equal(unitPriceForRecord(
        { hotel: '頭等艙 房務', item: '沒有這個', date: '2026-10-02', savedPrice: 9 }, catalog, 0,
    ), 9);
});

test('a failed fetch does not erase the last Firebase price catalog', () => {
    const previous = {
        customPrices: { '頭等艙 房務_床單': 11.5 },
        effectivePriceRules: [{ key: '頭等艙 房務_床單', start: '2026-09-01', price: 11.5 }],
        sheetPrices: { 'H2O 房務_床單': 15 },
        sheetClients: { 頭等艙: { name: '頭等艙' } },
    };
    const kept = mergePriceCatalog(previous, { sheetPrices: {}, customPrices: {}, effectivePriceRules: [] });
    assert.equal(kept.customPrices['頭等艙 房務_床單'], 11.5);
    assert.equal(kept.effectivePriceRules.length, 1);
    assert.equal(kept.sheetPrices['H2O 房務_床單'], 15);
});

test('price reads retry and then return the later success', async () => {
    let calls = 0;
    const price = await attemptWithBackoff(() => {
        calls += 1;
        if (calls < 3) throw new Error('價目表連線逾時');
        return 11.5;
    }, { attempts: 3, delayMs: 0 });
    assert.equal(price, 11.5);
    assert.equal(calls, 3);
    await assert.rejects(attemptWithBackoff(() => { throw new Error('價目表連線逾時'); }, { attempts: 2, delayMs: 0 }), /連線逾時/);
});

test('statement uses the Firebase price when the sheet cell is blank and refuses a missing price', () => {
    const sheetPrices = sheetPricesFromRows([
        ['飯店名稱', '部門分類', '品項名稱', '價格'],
        ['頭等艙', '房務', '床單', ''],
    ]);
    const base = {
        logisticsMasterItems: [{ hotel: '頭等艙 房務', item: '床單' }],
        pricingRules: { holidays: [], rebates: [], managementFees: [] },
        effectivePriceRules: [],
        sheetPrices,
        sheetClients: { 頭等艙: { name: '頭等艙股份有限公司', taxId: '12345678' } },
    };
    const row = { docId: 'a', receiptOrder: 0, date: '2026-10-02', parentCompany: '頭等艙', hotel: '頭等艙 房務', item: '床單', qty: 4 };
    const priced = createInvoiceEngine({ ...base, customPrices: { '頭等艙 房務_床單': 11.5 }, rawLogisticsData: [row] })
        .build('頭等艙', '2026-10-01', '2026-10-31');
    assert.equal(priced.departments[0].records[0].price, 11.5);
    assert.equal(priced.totals.grandTotal, 46);
    assert.throws(() => createInvoiceEngine({ ...base, customPrices: {}, rawLogisticsData: [row] })
        .build('頭等艙', '2026-10-01', '2026-10-31'), /單價尚未取得/);
});
