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

const contractRows = [
 ['飯店名稱','部門分類','品項名稱','單價','生效日'],
 ['A飯店','房務','浴巾',8,'2026-01-01'],
 ['A飯店','房務','浴巾',9,'2026/11/1'],
 ['A飯店','房務','浴巾',10,'2027-01-01'],
];
test('dated sheet contracts override saved prices on the first day, not before', () => {
 const catalog = {sheetPrices:sheetPricesFromRows(contractRows),customPrices:{'A飯店 房務_浴巾':7},rules:[]};
 const price = date => unitPriceForRecord({hotel:'A飯店 房務',item:'浴巾',date,savedPrice:6},catalog);
 assert.equal(price('2026-10-31'),8);
 assert.equal(price('2026-11-01'),9);
 assert.equal(price('2026-11-25'),9);
 assert.equal(price('2027-01-01'),10);
 assert.equal(price('2025-12-31'),6);
});
test('newest dated manual or sheet rule wins; Firebase wins same-day ties', () => {
 const catalog={sheetPrices:sheetPricesFromRows(contractRows),rules:[{key:'A飯店 房務_浴巾',start:'2026-10-01',price:7.5}]};
 const get = date => catalogPrice({...catalog,hotel:'A飯店 房務',item:'浴巾',date}).price;
 assert.equal(get('2026-10-31'),7.5);
 assert.equal(get('2026-11-01'),9);
 catalog.rules.push({key:'A飯店 房務_浴巾',start:'2026-11-01',price:9.5});
 assert.equal(get('2026-11-01'),9.5);
 assert.equal(get('2027-01-01'),10);
});
test('invalid dates and contradictory duplicate contract rows fail instead of using a wrong price',()=>{
 assert.throws(()=>sheetPricesFromRows([...contractRows,['A飯店','房務','浴巾',11,'2026-02-30']]),/生效日/);
 assert.throws(()=>sheetPricesFromRows([...contractRows,['A飯店','房務','浴巾',11,'2026-11-01']]),/不同價格/);
});
test('blank baseline plus dated zero preserves zero and does not activate future prices early',()=>{
 const sheetPrices=sheetPricesFromRows([contractRows[0],['A飯店','房務','浴巾',8,''],['A飯店','房務','浴巾',0,'2026-11-01']]);
 const get=date=>catalogPrice({sheetPrices,hotel:'A飯店 房務',item:'浴巾',date}).price;
 assert.equal(get('2026-10-31'),8);assert.equal(get('2026-11-01'),0);
});
test('客衣統一折扣 covers every guest-laundry line and leaves other departments on the old chain', () => {
    const sheetPrices = sheetPricesFromRows([
        ['飯店名稱', '部門分類', '品項名稱', '價格'],
        ['然一', '客衣', '統一折扣', 0.8],
        ['然一', '客衣', '統一價格', 0.8],
        ['然一', '客衣', '襯衫', 5],
        ['頭等艙', '房務', '統一折扣', 1],
        ['頭等艙', '房務', '床單', 9],
    ]);
    const catalog = {
        sheetPrices,
        customPrices: { '然一 客衣_襯衫': 3, '然一 客衣_000444': 4 },
        rules: [{ key: '然一 客衣_襯衫', start: '2026-01-01', price: 6 }],
    };
    const guest = { hotel: '然一 客衣', deptName: '客衣', item: '襯衫', date: '2026-11-12', savedPrice: 9, manualPriceOverride: true, currentPrice: 9 };
    assert.equal(unitPriceForRecord(guest, catalog, 0), 0.8);
    assert.equal(unitPriceForRecord(guest, catalog, 25), 1);
    assert.deepEqual(catalogPrice({ hotel: '然一 客衣', item: '襯衫', date: '2026-11-12', ...catalog }), { price: 0.8, source: 'sheet-unified' });
    assert.equal(unitPriceForRecord(
        { hotel: '然一', deptName: '客衣', item: '000444', date: '2026-11-12', savedPrice: 9 }, catalog, 0,
    ), 0.8);
    assert.equal(unitPriceForRecord(
        { hotel: '頭等艙 房務', deptName: '房務', item: '床單', date: '2026-11-12', savedPrice: 9 }, catalog, 0,
    ), 9);
    assert.equal(catalogPrice({ hotel: '頭等艙 房務', item: '沒有品項', date: '2026-11-12', sheetPrices }).price, 1);
    const namedOnly = sheetPricesFromRows([
        ['飯店名稱', '部門分類', '品項名稱', '價格'],
        ['然一', '客衣', '統一價格', 0.8],
    ]);
    assert.equal(unitPriceForRecord(
        { hotel: '然一 客衣', deptName: '客衣', item: '襯衫', date: '2026-11-12', savedPrice: 5 },
        { sheetPrices: namedOnly, customPrices: {}, rules: [] }, 0,
    ), 5);
});

test('a dated 客衣統一折扣 uses the parsed effective date and does not change column E parsing', () => {
    const sheetPrices = sheetPricesFromRows([
        ['飯店名稱', '部門分類', '品項名稱', '價格', '生效日'],
        ['驛館', '客衣', '統一折扣', 0.9, ''],
        ['驛館', '客衣', '統一折扣', 1.2, '2026-11-01'],
    ]);
    const line = date => unitPriceForRecord(
        { hotel: '驛館 客衣', item: '外套', date, savedPrice: 4 },
        { sheetPrices, customPrices: { '驛館 客衣_外套': 3 }, rules: [] }, 0,
    );
    assert.equal(line('2026-10-31'), 0.9);
    assert.equal(line('2026-11-01'), 1.2);
});

test('客衣 statement lines all use 統一折扣 while 房務 on the same hotel does not', () => {
    const sheetPrices = sheetPricesFromRows([
        ['飯店名稱', '部門分類', '品項名稱', '價格'],
        ['然一', '客衣', '統一折扣', 0.8],
        ['然一', '客衣', '襯衫', 5],
        ['然一', '房務', '床單', 10],
    ]);
    const engine = createInvoiceEngine({
        logisticsMasterItems: [{ hotel: '然一 客衣', item: '襯衫' }, { hotel: '然一 房務', item: '床單' }],
        pricingRules: { holidays: [{ hotel: '然一', start: '2026-01-01', end: '2026-12-31', percent: 25 }], rebates: [], managementFees: [] },
        effectivePriceRules: [{ key: '然一 客衣_襯衫', start: '2026-01-01', price: 6 }],
        sheetPrices,
        customPrices: { '然一 客衣_襯衫': 3 },
        sheetClients: { 然一: { name: '御盟', taxId: '59269713' } },
        rawLogisticsData: [
            { docId: 'g', receiptOrder: 0, date: '2026-11-02', parentCompany: '然一', hotel: '然一 客衣', deptName: '客衣', item: '襯衫', qty: 10, savedPrice: 9, manualPriceOverride: true },
            { docId: 'l', receiptOrder: 0, date: '2026-11-02', parentCompany: '然一', hotel: '然一 房務', deptName: '房務', item: '床單', qty: 2, savedPrice: 10 },
        ],
    });
    const guest = engine.build('然一-客衣', '2026-11-01', '2026-11-30');
    assert.equal(guest.departments[0].records[0].price, 1);
    assert.equal(guest.totals.grandTotal, 10);
    const linen = engine.build('然一', '2026-11-01', '2026-11-30');
    assert.equal(linen.departments[0].records[0].price, 12.5);
    assert.equal(linen.totals.grandTotal, 25);
});

test('25th closing statement splits October and November contract prices and keeps both summary rows',()=>{
 const rows=['2026-10-26','2026-10-31','2026-11-01','2026-11-25'].map((date,i)=>({docId:String(i),date,parentCompany:'A飯店',hotel:'A飯店 房務',item:'浴巾',qty:10,savedPrice:6}));
 const engine=createInvoiceEngine({logisticsMasterItems:[{hotel:'A飯店 房務',item:'浴巾'}],pricingRules:{holidays:[],rebates:[],managementFees:[]},effectivePriceRules:[],sheetPrices:sheetPricesFromRows(contractRows),customPrices:{},sheetClients:{'A飯店':{name:'A飯店'}},rawLogisticsData:rows});
 const result=engine.build('A飯店','2026-10-26','2026-11-25');
 assert.equal(result.totals.grandTotal,340);
 assert.deepEqual(result.departments[0].records.map(r=>r.price),[8,8,9,9]);
 assert.equal(result.departments[0].summary.length,2);
});
