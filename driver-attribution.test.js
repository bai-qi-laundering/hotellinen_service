import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    scheduleDate, parseRouteSheet, parseScheduleSheet, attributeDriver, hotelRouteText,
    isDriverPerformanceExcluded,
    UNASSIGNED_ROUTE, DRIVER_SOURCE_MANUAL, DRIVER_SOURCE_SCHEDULE,
    UNATTRIBUTED_NO_DATA, UNATTRIBUTED_NO_ROUTE, UNATTRIBUTED_NO_SCHEDULE,
    UNATTRIBUTED_UNSIGNED, UNATTRIBUTED_MANUAL_UNASSIGNED,
    normalizeRouteName,
    storedDriverSource, planDriverWritebacks, driverWritebackFields, scheduleReleasePatch,
    driverChoicePatch, commitDriverWritebacks, copiedDriverFields, driverStatusLabels,
    DRIVER_RECORD_MANUAL, DRIVER_RECORD_SCHEDULE, RESTORE_SCHEDULE_CHOICE, MANUAL_UNASSIGNED_CHOICE,
} from './driver-attribution.js';

const routeRows = [
    ['路線名稱', '包含飯店關鍵字'],
    ['北區', '君悅, 晶華，文旅、H2O'],
    ['南區\n', ' 驛館 \n, 承億 '],
    ['後排', '君悅'],
];

const scheduleRows = [
    ['日期', '司機姓名', '負責路線'],
    ['2024-05-11T16:00:00.000Z', '排班阿明', '北區'],
    ['2026/8/13', '小李\n', '南區'],
    ['2026-08-13', '被覆蓋', '南區'],
    ['2026-08-13', ' 小張 ', '南區'],
];

test('路線關鍵字支援逗號、全形逗號、頓號，並清掉換行與空白', () => {
    const routes = parseRouteSheet(routeRows);
    assert.deepEqual(routes.find(route => route.name === '北區').keywords, ['君悅', '晶華', '文旅', 'H2O']);
    assert.deepEqual(routes.find(route => route.name === '南區').keywords, ['驛館', '承億']);
    assert.deepEqual(routes.map(route => route.name), ['北區', '南區', '後排']);
    assert.deepEqual(parseRouteSheet(null), []);
});

test('飯店加部門、去空白、不分大小寫；一樣長的關鍵字維持表上順序', () => {
    const routes = parseRouteSheet(routeRows);
    assert.equal(hotelRouteText('君 悅', '房務'), '君 悅 房務');
    assert.equal(hotelRouteText('君悅', '君悅'), '君悅');
    const first = attributeDriver({
        hotelKeyword: '君 悅', deptName: '房務', date: '2026-08-12', routes, schedules: {},
    });
    assert.equal(first.route, '北區');
    assert.equal(first.driver, null);
    assert.equal(first.source, null);
    const h2o = attributeDriver({
        hotelKeyword: 'h2o', deptName: '西餐', date: '2024-05-12', routes, schedules: {},
    });
    assert.equal(h2o.route, '北區');
});

test('Apps Script 的 UTC 日期改回台灣日期，一般日期字串不位移', () => {
    assert.equal(scheduleDate('2024-05-11T16:00:00.000Z'), '2024-05-12');
    assert.equal(scheduleDate('2026-08-12'), '2026-08-12');
    assert.equal(scheduleDate('2026/8/3'), '2026-08-03');
    assert.equal(scheduleDate('2026-08-12T00:00:00'), '2026-08-12');
    assert.equal(scheduleDate(''), '');
    const schedules = parseScheduleSheet(scheduleRows);
    assert.equal(schedules['2024-05-12']['北區'], '排班阿明');
    assert.equal(schedules['2026-08-13']['南區'], '小張');
    assert.equal(schedules['日期'], undefined);
});

test('有指派司機時以後台為準，否則用當日排班，兩邊都沒有就未歸屬', () => {
    const routes = parseRouteSheet(routeRows);
    const schedules = parseScheduleSheet(scheduleRows);
    const manual = attributeDriver({
        assignedDriver: ' 後台小王 ',
        hotelKeyword: '驛館',
        deptName: '餐廳',
        date: '2026-08-13',
        routes,
        schedules,
    });
    assert.deepEqual(manual, { driver: '後台小王', route: '南區', source: DRIVER_SOURCE_MANUAL, reason: null, effectiveDate: '' });

    const scheduled = attributeDriver({
        assignedDriver: '',
        hotelKeyword: '驛館',
        deptName: '餐廳',
        date: '2026-08-13',
        routes,
        schedules,
    });
    assert.deepEqual(scheduled, { driver: '小張', route: '南區', source: DRIVER_SOURCE_SCHEDULE, reason: null, effectiveDate: '2026-08-13' });

    const blankManual = attributeDriver({
        assignedDriver: '   ',
        hotelKeyword: 'H2O',
        deptName: '房務',
        date: '2024-05-12',
        routes,
        schedules,
    });
    assert.equal(blankManual.driver, '排班阿明');
    assert.equal(blankManual.source, DRIVER_SOURCE_SCHEDULE);

    const unmatched = attributeDriver({
        assignedDriver: null,
        hotelKeyword: '不存在的飯店',
        deptName: '房務',
        date: '2026-08-13',
        routes,
        schedules,
    });
    assert.deepEqual(unmatched, { driver: null, route: UNASSIGNED_ROUTE, source: null, reason: UNATTRIBUTED_NO_ROUTE, effectiveDate: '' });

    const routeOnly = attributeDriver({
        hotelKeyword: '承億',
        deptName: '房務',
        date: '2026-08-01',
        routes,
        schedules,
    });
    assert.equal(routeOnly.route, '南區');
    assert.equal(routeOnly.driver, null);
    assert.equal(routeOnly.reason, UNATTRIBUTED_NO_SCHEDULE);
    const later = attributeDriver({
        hotelKeyword: '承億', deptName: '房務', date: '2026-08-20', routes, schedules,
    });
    assert.equal(later.driver, '小張');
    assert.equal(later.effectiveDate, '2026-08-13');
});

const ownerRoutes = [
    ['路線名稱', '包含飯店關鍵字'],
    ['3109', '文一, 日航, 文旅, 好地方, 泊思行旅, 鼎王, 鉑麗'],
    ['3109-2', '富野, 秝芯, 癮室, 良一, 良西, 駱駝, 良站, 日航制服, 鴨點棧華夏'],
    ['5939', '帕鉑, 頭等艙, 鈞怡, 捷站前, 比歐, 然一, 喜達絲'],
    ['6759', '英迪格, 承億, 林森, 文七, 好六, 花季, 媚力泊'],
    ['9739', '宮賞, 家和, 秝二, 侯工所, 河畔, 老新, 永心, 福客來, 鴨點棧明誠, 高盧, H2O'],
    ['5739', '歐遊, 洲際, 巨蛋, 驛館, 捷中正, 天子閣'],
];

test('日航制服比日航長，所以贏過路線順序；同一家飯店的其他部門仍走日航', () => {
    const routes = parseRouteSheet(ownerRoutes);
    const uniform = attributeDriver({ hotelKeyword: '日航', deptName: '制服', date: '2026-11-02', routes, schedules: {} });
    const rooms = attributeDriver({ hotelKeyword: '日航', deptName: '房務', date: '2026-11-02', routes, schedules: {} });
    const restaurant = attributeDriver({ hotelKeyword: '日航', deptName: '餐廳', date: '2026-11-02', routes, schedules: {} });
    const asHotel = attributeDriver({ hotelKeyword: '日航制服', deptName: '房務', date: '2026-11-02', routes, schedules: {} });
    assert.equal(uniform.route, '3109-2');
    assert.equal(rooms.route, '3109');
    assert.equal(restaurant.route, '3109');
    assert.equal(asHotel.route, '3109-2');
    const manualUniform = attributeDriver({
        assignedDriver: '後台小王', hotelKeyword: '日航', deptName: '制服', date: '2026-11-02', routes, schedules: {},
    });
    assert.deepEqual(manualUniform, { driver: '後台小王', route: '3109-2', source: DRIVER_SOURCE_MANUAL, reason: null, effectiveDate: '' });
    const yiguanRooms = attributeDriver({ hotelKeyword: '驛館', deptName: '房務', routes, schedules: {} });
    const yiguanRestaurant = attributeDriver({ hotelKeyword: '驛館', deptName: '餐廳', routes, schedules: {} });
    assert.equal(yiguanRooms.route, '5739');
    assert.equal(yiguanRestaurant.route, '5739');
});

test('鴨點棧華夏只在 3109-2；一樣長的關鍵字仍由試算表先列出的路線贏', () => {
    const routes = parseRouteSheet(ownerRoutes);
    assert.equal(attributeDriver({ hotelKeyword: '鴨點棧華夏', deptName: '房務', routes, schedules: {} }).route, '3109-2');
    assert.equal(attributeDriver({ hotelKeyword: '鴨點棧明誠', deptName: '房務', routes, schedules: {} }).route, '9739');
    const tied = parseRouteSheet([
        ['路線名稱', '包含飯店關鍵字'],
        ['3109', '君悅, 北區'],
        ['後排', '君悅, 南區'],
    ]);
    assert.equal(attributeDriver({ hotelKeyword: '君悅', deptName: '房務', routes: tied, schedules: {} }).route, '3109');
});

test('回洗、特處、客衣不計入司機業績，重洗與一般房務仍要算', () => {
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '驛館', deptName: '回洗' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '驛館', deptName: '回洗部' }), true);
    assert.equal(isDriverPerformanceExcluded({ itemName: '回洗床單' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '驛館', deptName: '特處' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '巨蛋', deptName: '特處部' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '鉑麗', deptName: '房務' }), false);
    assert.equal(isDriverPerformanceExcluded({ itemName: '特處抹布' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '然一', deptName: '客衣' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: 'H2O', deptName: '客衣' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '然一-客衣', deptName: '房務' }), true);
    assert.equal(isDriverPerformanceExcluded({ itemName: '客衣襯衫' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '然一', deptName: '客衣', itemName: '衣服' }), true);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '驛館', deptName: '重洗' }), false);
    assert.equal(isDriverPerformanceExcluded({ hotelKeyword: '驛館', deptName: '房務', itemName: '床單' }), false);
    assert.equal(isDriverPerformanceExcluded({ itemName: '衣服' }), false);
});

test('finance.html 司機業績以手動為最終，排班則重算並只回寫有變動的單', () => {
    const html = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    const fn = html.slice(html.indexOf('async function calculateDriverPerformance()'), html.indexOf('function renderDriverCards()'));
    assert.match(fn, /attributeDriver\(/);
    assert.match(fn, /assignedDriver:\s*d\.assignedDriver/);
    assert.match(fn, /driverSource:\s*d\.driverSource/);
    assert.match(fn, /driverSig:\s*d\.driverSig/);
    assert.match(fn, /driverSig:\s*data\.driverSig/);
    assert.match(fn, /planDriverWritebacks\(/);
    assert.match(fn, /commitDriverWritebacks\(driverPlans, \{ writeBatch, doc, db \}\)/);
    assert.match(fn, /routes:\s*sheetRoutes/);
    assert.match(fn, /schedules:\s*sheetSchedules/);
    assert.match(fn, /schedulesLoaded:\s*driverScheduleReady/);
    assert.match(fn, /reason:\s*attribution\.reason/);
    assert.match(html, /未歸屬原因/);
    assert.match(fn, /manualDeletedReceipt/);
    assert.match(fn, /isDriverPerformanceExcluded\(\{ hotelKeyword: d\.hotelKeyword, deptName: d\.deptName \}\)/);
    assert.match(fn, /isDriverPerformanceExcluded\(\{ itemName: item\.itemName \}\)/);
    assert.ok(fn.indexOf('isDriverPerformanceExcluded') < fn.indexOf('attributeDriver('));
    assert.match(fn, /resolveItemBillingQty/);
    assert.match(fn, /reportRecordPrice/);
    assert.match(fn, /getLogisticsDocsForPeriod\(startDate, endDate, true\)/);
    assert.match(fn, /financeMasterCacheFresh\(\)/);
    assert.match(fn, /priceCacheFresh \? refreshDriverRoutesFromSheet\(\) : syncMasterDataFromSheet\(\)/);
    assert.equal(fn.includes('if (!driverScheduleReady)'), false);
    const refreshFn = html.slice(html.indexOf('async function refreshDriverRoutesFromSheet'), html.indexOf('function applyDriverMasterRows'));
    assert.match(refreshFn, /readSheetPrices\(\)/);
    assert.match(refreshFn, /applyDriverMasterRows/);
    assert.equal(refreshFn.includes('getDoc'), false);
    assert.equal(refreshFn.includes('getDocs'), false);
    assert.equal(fn.includes('setDoc'), false);
    assert.equal(fn.includes('updateDoc'), false);
    assert.equal(fn.includes('addDoc'), false);
    assert.equal(fn.includes('getDoc'), false);
    assert.equal(fn.includes('getDocs'), false);
    assert.match(html, /判定路線/);
    assert.match(html, /<th[^>]*>來源<\/th>/);
    assert.match(html, /後台指派/);
    assert.match(html, /排班表 · 自 \$\{r\.effectiveDate\}/);
    assert.match(html, /後台指派' \? '手動'/);
    assert.match(html, /排班表/);
    assert.match(html, /0\.029/);
    assert.match(html, /parseRouteSheet\(json\.routes\)/);
    assert.match(html, /parseScheduleSheet\(json\.schedules\)/);
    assert.match(html, /baiqi_driver_schedule_v2/);
    const admin = fs.readFileSync(new URL('./boss_admin.html', import.meta.url), 'utf8');
    assert.match(admin, /柯柏丞/);
    assert.match(admin, /恢復排班/);
    assert.match(admin, /planDriverWritebacks\(/);
    assert.match(admin, /commitDriverWritebacks\(/);
    assert.match(admin, /driverChoicePatch\(/);
    assert.match(admin, /loadDriverSchedule\(/);
    assert.match(admin, />排班</);
    assert.match(admin, />手動</);
    assert.match(admin, />未簽名</);
    assert.match(admin, /MANUAL_UNASSIGNED_CHOICE/);
    assert.match(admin, /driverSig:\s*d\.driverSig/);
    assert.match(html, /司機未簽名/);
    assert.match(html, /手動設為未指派/);
});

const ownerScheduleRows = [
    ['日期', '司機', '路線'],
    ['2026/11/01', '劉硯茹', 3109],
    ['2026/11/01', '吳宏鴻', '3109-2'],
    ['2026/11/01', '朱韋豪', 5939],
    ['2026/11/01', '鄭弘裕', 6759],
    ['2026/11/01', '羅金賢', 9739],
    ['2026/11/01', '柯柏丞', 5739],
];

test('斜線日期與 UTC 位移都正規化成台北的 YYYY-MM-DD，路線用去空白字串比對', () => {
    assert.equal(scheduleDate('2026/11/01'), '2026-11-01');
    assert.equal(scheduleDate(new Date('2026-10-31T16:00:00.000Z')), '2026-11-01');
    assert.equal(normalizeRouteName(3109), '3109');
    assert.equal(normalizeRouteName(' 3109-2 '), '3109-2');
    assert.equal(normalizeRouteName(5939.0), '5939');
    assert.equal(normalizeRouteName('3109/2/1'), '3109-2');
    assert.equal(normalizeRouteName('2026/11/01'), '2026/11/01');
    const schedules = parseScheduleSheet(ownerScheduleRows);
    assert.equal(schedules['2026-11-01']['3109'], '劉硯茹');
    assert.equal(schedules['2026-11-01']['3109-2'], '吳宏鴻');
    assert.equal(schedules['2026-11-01']['5739'], '柯柏丞');
    assert.deepEqual(Object.keys(schedules['2026-11-01']).sort(), ['3109', '3109-2', '5739', '5939', '6759', '9739']);
});

test('排班列是生效日起沿用，早於該路線第一列的紀錄不歸屬', () => {
    const routes = parseRouteSheet(ownerRoutes);
    const schedules = parseScheduleSheet(ownerScheduleRows);
    const papo = attributeDriver({ hotelKeyword: '帕鉑', deptName: '房務', date: '2026-11-05', routes, schedules });
    const egg = attributeDriver({ hotelKeyword: '巨蛋', deptName: '房務', date: '2026/11/02', routes, schedules });
    const tianzi = attributeDriver({ hotelKeyword: '天子閣', deptName: '餐廳', date: new Date('2026-10-31T16:00:00.000Z'), routes, schedules });
    assert.equal(papo.driver, '朱韋豪');
    assert.equal(papo.route, '5939');
    assert.equal(papo.source, DRIVER_SOURCE_SCHEDULE);
    assert.equal(papo.effectiveDate, '2026-11-01');
    assert.equal(egg.driver, '柯柏丞');
    assert.equal(egg.route, '5739');
    assert.equal(tianzi.driver, '柯柏丞');
    assert.equal(tianzi.route, '5739');

    const before = attributeDriver({ hotelKeyword: '帕鉑', deptName: '房務', date: '2026-10-31', routes, schedules });
    assert.equal(before.driver, null);
    assert.equal(before.route, '5939');
    assert.equal(before.reason, UNATTRIBUTED_NO_SCHEDULE);

    const replaced = parseScheduleSheet([
        ...ownerScheduleRows,
        ['2026/11/10', '新司機', 5739],
    ]);
    const stillKe = attributeDriver({ hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-09', routes, schedules: replaced });
    const next = attributeDriver({ hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-10', routes, schedules: replaced });
    assert.equal(stillKe.driver, '柯柏丞');
    assert.equal(next.driver, '新司機');
    assert.equal(next.effectiveDate, '2026-11-10');

    const unknown = attributeDriver({ hotelKeyword: '不知名旅館', deptName: '房務', date: '2026-11-05', routes, schedules });
    assert.equal(unknown.reason, UNATTRIBUTED_NO_ROUTE);
    const unloaded = attributeDriver({
        hotelKeyword: '帕鉑', deptName: '房務', date: '2026-11-05', routes, schedules: null, schedulesLoaded: false,
    });
    assert.equal(unloaded.reason, UNATTRIBUTED_NO_DATA);
    assert.equal(unloaded.driver, null);
});

test('飯店只依試算表關鍵字歸屬，程式不內建路線或飯店清單', () => {
    const routes = parseRouteSheet(ownerRoutes);
    const schedules = parseScheduleSheet(ownerScheduleRows);
    const missing = attributeDriver({ hotelKeyword: '萊特薇庭', deptName: '房務', date: '2026-11-05', routes, schedules });
    assert.equal(missing.reason, UNATTRIBUTED_NO_ROUTE);
    assert.equal(missing.driver, null);
    const sheet = ownerRoutes.map(row => row.slice());
    sheet.push(['5939', '萊特薇庭']);
    const added = attributeDriver({
        hotelKeyword: '萊特薇庭', deptName: '房務', date: '2026-11-05',
        routes: parseRouteSheet(sheet), schedules,
    });
    assert.equal(added.route, '5939');
    assert.equal(added.driver, '朱韋豪');
    assert.equal(added.source, DRIVER_SOURCE_SCHEDULE);
    assert.equal(attributeDriver({ hotelKeyword: '候工所', deptName: '房務', date: '2026-11-03', routes, schedules }).reason, UNATTRIBUTED_NO_ROUTE);
    assert.equal(attributeDriver({ hotelKeyword: '良站前', deptName: '房務', date: '2026-11-03', routes, schedules }).route, '3109-2');
    assert.equal(attributeDriver({ hotelKeyword: '鴨點棧-華夏', deptName: '房務', date: '2026-11-03', routes, schedules }).route, '3109-2');
    const source = fs.readFileSync(new URL('./driver-attribution.js', import.meta.url), 'utf8');
    const page = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    for (const name of ['萊特薇庭', '候工所', '文旅一心館']) {
        assert.equal(source.includes(name), false);
        assert.equal(page.includes(name), false);
    }
});

const writeRoutes = parseRouteSheet([
    ['路線名稱', '包含飯店關鍵字'],
    ['5739', '巨蛋, 驛館'],
    ['5939', '帕鉑'],
]);
const writeSchedules = parseScheduleSheet([
    ['日期', '司機', '路線'],
    ['2026/11/01', '柯柏丞', 5739],
    ['2026/11/10', '新司機', 5739],
    ['2026/11/01', '朱韋豪', 5939],
]);
const writeContext = { routes: writeRoutes, schedules: writeSchedules, schedulesLoaded: true };

test('driverSource 為 manual 時用指定司機；schedule 則用當下排班，不沿用單上的舊名字', () => {
    const manual = attributeDriver({
        assignedDriver: '後台小王', driverSource: 'manual',
        hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12', ...writeContext,
    });
    assert.equal(manual.driver, '後台小王');
    assert.equal(manual.source, DRIVER_SOURCE_MANUAL);

    const scheduled = attributeDriver({
        assignedDriver: '柯柏丞', driverSource: 'schedule',
        hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12', ...writeContext,
    });
    assert.equal(scheduled.driver, '新司機');
    assert.equal(scheduled.source, DRIVER_SOURCE_SCHEDULE);
    assert.equal(scheduled.effectiveDate, '2026-11-10');
    assert.equal(scheduled.route, '5739');
});

test('回寫只針對排班有變動的單；手動、舊資料、回洗特處客衣、對不到路線都不寫', () => {
    const legacy = { id: 'old', assignedDriver: '後台小王', driverSig: 'signed', hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' };
    assert.equal(storedDriverSource(legacy), DRIVER_RECORD_MANUAL);
    assert.equal(driverWritebackFields(legacy, writeContext), null);

    const manual = { ...legacy, id: 'manual', driverSource: 'manual' };
    assert.equal(driverWritebackFields(manual, writeContext), null);
    assert.equal(storedDriverSource({ driverSource: 'manual', assignedDriver: '' }), DRIVER_RECORD_MANUAL);

    const blank = { id: 'blank', assignedDriver: '', driverSig: 'signed', hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' };
    assert.deepEqual(driverWritebackFields(blank, writeContext), {
        assignedDriver: '新司機', driverSource: 'schedule', driverRoute: '5739', driverEffectiveDate: '2026-11-10',
    });

    const stale = { id: 'stale', assignedDriver: '柯柏丞', driverSource: 'schedule', driverRoute: '5739', driverEffectiveDate: '2026-11-01', driverSig: 'signed', hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' };
    assert.equal(driverWritebackFields(stale, writeContext).assignedDriver, '新司機');

    const same = { id: 'same', assignedDriver: '新司機', driverSource: 'schedule', driverRoute: '5739', driverEffectiveDate: '2026-11-10', driverSig: 'signed', hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' };
    assert.equal(driverWritebackFields(same, writeContext), null);

    for (const deptName of ['回洗', '特處', '客衣']) {
        assert.equal(driverWritebackFields({ id: deptName, assignedDriver: '', driverSig: 'signed', hotelKeyword: '巨蛋', deptName, date: '2026-11-12' }, writeContext), null);
    }
    assert.equal(driverWritebackFields({ id: 'none', assignedDriver: '', driverSig: 'signed', hotelKeyword: '不知名', deptName: '房務', date: '2026-11-12' }, writeContext), null);
    assert.equal(driverWritebackFields({ id: 'early', assignedDriver: '', driverSig: 'signed', hotelKeyword: '帕鉑', deptName: '房務', date: '2026-10-01' }, writeContext), null);
    assert.equal(driverWritebackFields({ id: 'deleted', manualDeletedReceipt: true, assignedDriver: '', driverSig: 'signed', hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' }, writeContext), null);
    assert.equal(driverWritebackFields(blank, { ...writeContext, schedulesLoaded: false }), null);

    const plans = planDriverWritebacks([
        legacy, manual, blank, stale, same,
        { id: '客衣', assignedDriver: '', driverSig: 'signed', hotelKeyword: '然一', deptName: '客衣', date: '2026-11-12' },
        { assignedDriver: '', driverSig: 'signed', hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' },
    ], writeContext);
    assert.deepEqual(plans.map(plan => plan.id), ['blank', 'stale']);

    const updated = { ...stale, ...plans.find(plan => plan.id === 'stale').fields };
    assert.equal(planDriverWritebacks([updated], writeContext).length, 0);
});

test('恢復排班會清掉手動鎖；已經是同一位排班司機就不再寫', () => {
    const manual = { id: 'm', assignedDriver: '後台小王', driverSource: 'manual', driverSig: 'signed', hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' };
    const released = scheduleReleasePatch(manual, writeContext);
    assert.equal(released.assignedDriver, '新司機');
    assert.equal(released.driverSource, DRIVER_RECORD_SCHEDULE);
    assert.equal(driverChoicePatch(manual, RESTORE_SCHEDULE_CHOICE, writeContext).assignedDriver, '新司機');
    assert.equal(scheduleReleasePatch({ ...manual, ...released }, writeContext), null);
    assert.equal(scheduleReleasePatch(manual, { ...writeContext, schedulesLoaded: false }), null);

    const choice = driverChoicePatch(manual, '鄭弘裕', writeContext);
    assert.deepEqual(choice, { assignedDriver: '鄭弘裕', driverSource: 'manual', driverRoute: '', driverEffectiveDate: '' });
    assert.equal(driverChoicePatch({ ...manual, ...choice }, '鄭弘裕', writeContext), null);

    const guest = scheduleReleasePatch({ assignedDriver: '後台小王', driverSource: 'manual', hotelKeyword: '然一', deptName: '客衣', date: '2026-11-12' }, writeContext);
    assert.deepEqual(guest, { assignedDriver: '', driverSource: 'schedule', driverRoute: '', driverEffectiveDate: '' });
    assert.deepEqual(copiedDriverFields(manual), { assignedDriver: '後台小王', driverSource: 'manual', driverRoute: '', driverEffectiveDate: '' });
    assert.equal(copiedDriverFields(released).driverSource, 'schedule');
});

test('司機未簽名不自動歸屬；未指派是手動鎖，恢復排班在未簽名時沒有司機', () => {
    const base = { hotelKeyword: '巨蛋', deptName: '房務', date: '2026-11-12' };
    const unsignedSchedule = {
        id: 'was-schedule', assignedDriver: '柯柏丞', driverSource: 'schedule',
        driverRoute: '5739', driverEffectiveDate: '2026-11-01', driverSig: '', ...base,
    };
    assert.deepEqual(driverWritebackFields(unsignedSchedule, writeContext), {
        assignedDriver: '', driverSource: '', driverRoute: '', driverEffectiveDate: '',
    });
    assert.equal(driverWritebackFields({ ...unsignedSchedule, driverSig: '   ' }, writeContext).assignedDriver, '');
    const cleared = { ...unsignedSchedule, ...driverWritebackFields(unsignedSchedule, writeContext) };
    assert.equal(driverWritebackFields(cleared, writeContext), null);
    assert.equal(planDriverWritebacks([cleared], writeContext).length, 0);
    assert.equal(driverWritebackFields({ ...cleared, driverSig: 'signed' }, writeContext).assignedDriver, '新司機');

    const unsignedBlank = { id: 'never', assignedDriver: '', driverSig: undefined, ...base };
    assert.equal(driverWritebackFields(unsignedBlank, writeContext), null);
    const unsignedLegacy = { id: 'legacy-open', assignedDriver: '後台小王', driverSig: '', ...base };
    assert.equal(driverWritebackFields(unsignedLegacy, writeContext), null);
    assert.equal(storedDriverSource(unsignedLegacy), DRIVER_RECORD_MANUAL);

    const locked = driverChoicePatch({ id: 'm', assignedDriver: '後台小王', driverSource: 'manual', driverSig: 'signed', ...base }, '', writeContext);
    assert.deepEqual(locked, { assignedDriver: '', driverSource: 'manual', driverRoute: '', driverEffectiveDate: '' });
    assert.deepEqual(driverChoicePatch({ id: 'm', assignedDriver: '新司機', driverSource: 'schedule', driverSig: '', ...base }, MANUAL_UNASSIGNED_CHOICE, writeContext), locked);
    assert.equal(driverChoicePatch({ ...base, ...locked, driverSig: 'signed' }, MANUAL_UNASSIGNED_CHOICE, writeContext), null);
    assert.equal(driverChoicePatch({ ...base, ...locked }, '__keep_driver__', writeContext), null);
    assert.equal(driverWritebackFields({ id: 'locked', ...locked, driverSig: 'signed', ...base }, writeContext), null);
    assert.deepEqual(copiedDriverFields({ ...locked, driverSig: '' }), locked);

    const unsignedManual = { id: 'open-manual', assignedDriver: '後台小王', driverSource: 'manual', driverSig: '', ...base };
    assert.deepEqual(scheduleReleasePatch(unsignedManual, writeContext), {
        assignedDriver: '', driverSource: '', driverRoute: '', driverEffectiveDate: '',
    });
    assert.equal(scheduleReleasePatch(unsignedManual, { ...writeContext, schedulesLoaded: false }).assignedDriver, '');
    assert.equal(driverChoicePatch(unsignedManual, RESTORE_SCHEDULE_CHOICE, { ...writeContext, schedulesLoaded: false }).driverSource, '');
    assert.equal(scheduleReleasePatch({ ...unsignedManual, assignedDriver: '', driverSource: '', driverRoute: '', driverEffectiveDate: '' }, writeContext), null);

    const unsignedAttr = attributeDriver({
        assignedDriver: '柯柏丞', driverSource: 'schedule', driverSig: '', ...base, ...writeContext,
    });
    assert.equal(unsignedAttr.driver, null);
    assert.equal(unsignedAttr.route, '5739');
    assert.equal(unsignedAttr.reason, UNATTRIBUTED_UNSIGNED);
    assert.equal(unsignedAttr.source, null);

    const manualStill = attributeDriver({
        assignedDriver: '後台小王', driverSource: 'manual', driverSig: '', ...base, ...writeContext,
    });
    assert.equal(manualStill.driver, '後台小王');
    assert.equal(manualStill.source, DRIVER_SOURCE_MANUAL);
    assert.equal(manualStill.reason, null);

    const legacyStill = attributeDriver({
        assignedDriver: '後台小王', driverSig: '  ', ...base, ...writeContext,
    });
    assert.equal(legacyStill.driver, '後台小王');
    assert.equal(legacyStill.source, DRIVER_SOURCE_MANUAL);

    const manualBlank = attributeDriver({
        assignedDriver: '', driverSource: 'manual', driverSig: 'signed', ...base, ...writeContext,
    });
    assert.equal(manualBlank.driver, null);
    assert.equal(manualBlank.reason, UNATTRIBUTED_MANUAL_UNASSIGNED);
    assert.equal(manualBlank.source, DRIVER_SOURCE_MANUAL);

    const signedSchedule = attributeDriver({
        assignedDriver: '柯柏丞', driverSource: 'schedule', driverSig: 'https://sign.example/d.png', ...base, ...writeContext,
    });
    assert.equal(signedSchedule.driver, '新司機');
    assert.equal(signedSchedule.source, DRIVER_SOURCE_SCHEDULE);

    const plans = planDriverWritebacks([
        unsignedSchedule,
        unsignedBlank,
        unsignedLegacy,
        { id: 'locked', ...locked, driverSig: 'signed', ...base },
        { id: 'blank-signed', assignedDriver: '', driverSig: 'signed', ...base },
    ], writeContext);
    assert.deepEqual(plans.map(plan => plan.id), ['was-schedule', 'blank-signed']);
    assert.equal(plans.find(plan => plan.id === 'was-schedule').fields.assignedDriver, '');
    assert.equal(plans.find(plan => plan.id === 'blank-signed').fields.assignedDriver, '新司機');

    assert.deepEqual(driverStatusLabels({ assignedDriver: '', driverSource: 'manual', driverSig: '' }), ['手動', '未簽名']);
    assert.deepEqual(driverStatusLabels({ assignedDriver: '新司機', driverSource: 'schedule', driverSig: 'signed' }), ['排班']);
    assert.deepEqual(driverStatusLabels({ assignedDriver: '', driverSig: '' }), ['未簽名']);
    assert.deepEqual(driverStatusLabels({ assignedDriver: '後台小王', driverSource: 'manual', driverSig: 'signed' }), ['手動']);
    assert.deepEqual(driverStatusLabels({ assignedDriver: '柯柏丞', driverSource: 'schedule', driverSig: ' \n ' }), ['排班', '未簽名']);
});

test('回寫用 batch，每批最多 500，而且不讀 Firestore', async () => {
    const commits = [];
    const reads = [];
    const writeBatch = () => {
        const ops = [];
        return {
            set(ref, data, options) { ops.push({ ref, data, options }); },
            async commit() { commits.push(ops); },
        };
    };
    const doc = (_db, name, id) => ({ name, id });
    const plans = Array.from({ length: 501 }, (_, index) => ({
        id: `doc-${index}`,
        fields: { assignedDriver: '新司機', driverSource: 'schedule', driverRoute: '5739', driverEffectiveDate: '2026-11-10' },
    }));
    const written = await commitDriverWritebacks(plans, { writeBatch, doc, db: {}, getDoc: () => reads.push('read') });
    assert.equal(written, 501);
    assert.equal(reads.length, 0);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].length, 500);
    assert.equal(commits[1].length, 1);
    assert.equal(commits[0][0].ref.name, 'logistics_records');
    assert.deepEqual(commits[0][0].options, { merge: true });
    assert.equal(await commitDriverWritebacks([], { writeBatch, doc, db: {} }), 0);
});
