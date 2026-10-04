// Offline regression fixtures: these tests never contact Firebase or change live records.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {applyFinanceItemNames, itemMatchesName, mergeSignedItems, legacyDatePrefixes} from '../logistics-items.js';

const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const section = (file, start, end) => source(file).split(start)[1].split(end)[0];
const plain = value => JSON.parse(JSON.stringify(value));
const bath = {itemName: '浴巾', originalQty: '100', actualQty: '98', price: 12, manualFinancePrice: true, auntNote: '分袋'};
const rename = (old, next, sourceName = '浴巾') => ({originalItemName: old, newItemName: next, sourceItemName: sourceName});

test('finance rename retains original inventory identity, quantities, price and notes', () => {
    const [item] = applyFinanceItemNames([bath], [rename('浴巾', '大浴巾')]);
    assert.equal(item.inventoryItemName, '浴巾');
    assert.equal(item.actualQty, '98');
    assert.equal(item.price, 12);
    assert.equal(item.manualFinancePrice, true);
    assert.equal(item.auntNote, '分袋');
    assert.ok(itemMatchesName(item, '浴巾'));
    assert.ok(itemMatchesName(item, '大浴巾'));
    assert.equal(bath.itemName, '浴巾');
});

test('repeated rename and save retry preserve source identity without extra rows', () => {
    const once = applyFinanceItemNames([bath], [rename('浴巾', '大浴巾')]);
    const retry = applyFinanceItemNames(once, [rename('浴巾', '大浴巾')]);
    const twice = applyFinanceItemNames(retry, [rename('大浴巾', '飯店浴巾')]);
    assert.equal(twice.length, 1);
    assert.equal(twice[0].inventoryItemName, '浴巾');
    assert.ok(itemMatchesName(twice[0], '大浴巾'));
});

test('finance save identifies the source even after another screen reorders items', () => {
    const items = [{itemName:'中毛',actualQty:'20'}, bath];
    const next = applyFinanceItemNames(items, [{...rename('浴巾','大浴巾'),receiptOrder:0}]);
    assert.equal(next[0].itemName, '中毛');
    assert.equal(next[1].itemName, '大浴巾');
});

test('finance rejects name collisions, missing source and concurrent renames', () => {
    assert.throws(() => applyFinanceItemNames([bath,{itemName:'大浴巾'}], [rename('浴巾','大浴巾')]));
    assert.throws(() => applyFinanceItemNames([], [rename('浴巾','大浴巾')]));
    const changed = applyFinanceItemNames([bath],[rename('浴巾','大浴巾')]);
    assert.throws(() => applyFinanceItemNames(changed,[rename('浴巾','毛巾')]));
});

test('price-only save cannot undo another user\'s rename', () => {
    const renamed = applyFinanceItemNames([bath], [rename('浴巾','大浴巾')]);
    assert.equal(applyFinanceItemNames(renamed,[rename('浴巾','浴巾')])[0].itemName, '大浴巾');
});

test('signing old screen preserves financial rename, price, identity, and extra items', () => {
    const latest = [...applyFinanceItemNames([bath],[rename('浴巾','大浴巾')]),{itemName:'圍裙',actualQty:'6'}];
    const saved = mergeSignedItems(latest,[{...bath,loadedActualQty:'98',actualQty:'97',clientSig:'page-only'}]);
    assert.equal(saved.length, 2);
    assert.equal(saved[0].itemName, '大浴巾');
    assert.equal(saved[0].price, 12);
    assert.equal(saved[0].actualQty, '97');
    assert.equal(saved[0].inventoryItemName, '浴巾');
    assert.equal(saved[0].loadedActualQty, undefined);
    assert.equal(saved[0].clientSig, undefined);
    assert.equal(saved[1].itemName, '圍裙');
});

test('stale signing cannot overwrite an administrator\'s changed quantity', () => {
    assert.throws(() => mergeSignedItems([{...bath,actualQty:'90'}],[{...bath,loadedActualQty:'98'}]));
    // Retrying a completed write is safe when the desired quantity already matches.
    assert.equal(mergeSignedItems([{...bath,actualQty:'97'}],[{...bath,loadedActualQty:'98',actualQty:'97'}])[0].actualQty,'97');
});

test('new signing entries preserve metadata and zero received quantity', () => {
    const saved = mergeSignedItems([],[{...bath,actualQty:'0',loadedActualQty:'0'}]);
    assert.equal(saved[0].actualQty,'0');
    assert.equal(saved[0].price,12);
});

test('legacy date query prefixes work across month/year boundaries and reject invalid ranges', () => {
    assert.deepEqual(legacyDatePrefixes('2026-09-30','2026-10-01'),['2026-9-','2026-09-','2026-10-']);
    assert.deepEqual(legacyDatePrefixes('2026-12-31','2027-01-02'),['2026-12-','2027-1-','2027-01-']);
    assert.throws(() => legacyDatePrefixes('2026-10-01','2026-09-30'));
    assert.throws(() => legacyDatePrefixes('2026-00-01','2026-12-01'));
});

function financeCacheHarness() {
    let rows = [], fail = false, reads = 0;
    const context = vm.createContext({console,Date,Map,Promise,legacyDatePrefixes,
        db:{},collection:(_,name)=>name,where:(...args)=>args,query:(...args)=>args,
        withTimeout: p => p,showToast:()=>{},
        getDocsFromServer: async () => {
            reads++;
            if (fail) throw new Error('server unavailable');
            const copies = rows.map(plain);
            return {forEach:callback=>copies.forEach(r=>callback({id:r.id,data:()=>r}))};
        }
    });
    vm.runInContext('function standardizeDate(dStr) {'+section('finance.html','function standardizeDate(dStr) {','function getLocalDateString'),context);
    vm.runInContext('const LOGISTICS_CACHE_MS=600000; const logisticsPeriodCache=new Map();\nasync function getLogisticsDocsForPeriod('+section('finance.html','async function getLogisticsDocsForPeriod(','async function fetchInitialHotels()'),context);
    return {context,setRows:r=>rows=r,setFail:v=>fail=v,reads:()=>reads,
        load:(start='2026-09-30',end='2026-10-01',force=false)=>vm.runInContext(`getLogisticsDocsForPeriod('${start}','${end}',${force})`,context)};
}

test('manual finance refresh rereads server instead of reusing cached old quantity', async () => {
    const h=financeCacheHarness();
    h.setRows([{id:'a',date:'2026-10-01',items:[{actualQty:'100'}]}]);
    await h.load();const firstReads=h.reads();
    h.setRows([{id:'a',date:'2026-10-01',items:[{actualQty:'98'}]}]);
    assert.equal((await h.load()).get('a').data().items[0].actualQty,'100');
    assert.equal(h.reads(),firstReads);
    assert.equal((await h.load(undefined,undefined,true)).get('a').data().items[0].actualQty,'98');
    assert.ok(h.reads()>firstReads);
});

test('manual refresh reports server failure instead of silently treating stale data as latest', async () => {
    const h=financeCacheHarness();h.setRows([{id:'a',date:'2026-10-01'}]);await h.load();
    h.setFail(true);await assert.rejects(h.load(undefined,undefined,true),/server unavailable/);
});

test('mixed padded/unpadded dates are included once and out-of-range dates are filtered', async () => {
    const h=financeCacheHarness();h.setRows([{id:'old',date:'2026-9-30'}, {id:'new',date:'2026-10-01'}, {id:'out',date:'2026-10-02'}]);
    const docs=await h.load();assert.deepEqual([...docs.keys()],['old','new']);
});

function adminHarness(initial) {
    const docs=new Map(Object.entries(initial).map(([k,v])=>[k,plain(v)])),alerts=[],toasts=[];
    const context=vm.createContext({console,window:{},itemMatchesName,db:{},doc:(_,__,id)=>id,
        customAlert:async m=>alerts.push(m),showToast:m=>toasts.push(m),applyLogFilters:()=>{},
        getLocalTimeString:()=> 'test-time',
        runTransaction:async (_,body)=>body({
            get:async id=>({exists:()=>docs.has(id),data:()=>plain(docs.get(id))}),
            update:(id,data)=>docs.set(id,{...docs.get(id),...plain(data)}),
            set:(id,data)=>docs.set(id,plain(data))
        })});
    vm.runInContext("let logRecords=[];let lastLogFetchKey='cached';",context);
    vm.runInContext('const normalizedLogItemName = '+section('boss_admin.html','const normalizedLogItemName = ','window.updateInvField ='),context);
    return {docs,context,alerts,toasts,qty:(id,name,value)=>context.window.updateLogQty(id,name,value,{style:{}},'100')};
}

test('backend edits persist quantity for inventory-only logistics rows, preserving all items', async () => {
    const h=adminHarness({});
    vm.runInContext("logRecords=[{id:'virtual',date:'2026-10-01',hotelKeyword:'A',deptName:'房務',items:[{itemName:'浴巾',bqQty:'100',actualQty:'100'},{itemName:'中毛',bqQty:'80',actualQty:'80'}]}]",h.context);
    await h.qty('virtual','浴巾','98');
    assert.equal(h.docs.get('virtual').items[0].actualQty,'98');
    assert.equal(h.docs.get('virtual').items[1].actualQty,'80');
    assert.equal(h.docs.get('virtual').date,'2026-10-01');assert.deepEqual(h.alerts,[]);
});

test('backend quantity edits preserve signatures and renamed financial metadata', async () => {
    const renamed=applyFinanceItemNames([bath],[rename('浴巾','大浴巾')]);
    const h=adminHarness({signed:{items:renamed,clientSig:'hotel-url',driverSig:'driver-url',assignedDriver:'D'}});
    await h.qty('signed','大浴巾','0');const saved=h.docs.get('signed');
    assert.equal(saved.items[0].actualQty,'0');assert.equal(saved.items[0].price,12);
    assert.equal(saved.clientSig,'hotel-url');assert.equal(saved.driverSig,'driver-url');
    assert.equal(saved.items[0].inventoryItemName,'浴巾');assert.deepEqual(h.alerts,[]);
});

test('backend rejects invalid numbers without writes', async () => {
    const h=adminHarness({signed:{items:[bath]}});
    for (const value of ['','-1','abc']) await h.qty('signed','浴巾',value);
    assert.equal(h.docs.get('signed').items[0].actualQty,'98');assert.equal(h.alerts.length,3);
});

test('actual backend load does not recreate old inventory name after finance rename', async () => {
    const renamed=applyFinanceItemNames([bath],[rename('浴巾','大浴巾')]);
    const fields={logStartDate:{value:'2026-09-30'},logEndDate:{value:'2026-10-01'},
        logFetchHotel:{value:''},logTableBody:{},logLoadBtn:{}};
    const h=adminHarness({signed:{date:'2026-10-01',hotelKeyword:'A',deptName:'房務',items:renamed,clientSig:'H',driverSig:'D'}});
    Object.assign(h.context,{document:{getElementById:id=>fields[id]},legacyDatePrefixes,
        ensureMasterData:async()=>{},getItemSortIndex:()=>0,populateLogDropdowns:()=>{},
        standardizeDate:d=>d,collection:(_,name)=>name,where:(...v)=>v,query:(...v)=>v,
        getDocsFromServer:async q=>({forEach:cb=>{
            const rows=q[0]==='inventory_records'?[{id:'inv',date:'2026-10-01',hotel:'A 房務',item:'浴巾',count:'100',doubleCount:'99'}]:
                [{id:'signed',...h.docs.get('signed')}];
            rows.forEach(r=>cb({id:r.id,data:()=>plain(r)}));
        }})});
    vm.runInContext('let masterData=[];',h.context);
    vm.runInContext('window.loadLogData = '+section('boss_admin.html','window.loadLogData = ','function populateLogDropdowns()'),h.context);
    await h.context.window.loadLogData();
    const records=plain(vm.runInContext('logRecords',h.context));
    assert.equal(records.length,1);assert.equal(records[0].items.length,1);
    assert.equal(records[0].items[0].itemName,'大浴巾');
    assert.equal(records[0].items[0].bqQty,'99');
    assert.equal(h.docs.get('signed').items.length,1);
    assert.equal(h.docs.get('signed').clientSig,'H');
});
