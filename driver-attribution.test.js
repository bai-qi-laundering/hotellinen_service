import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    scheduleDate, parseRouteSheet, parseScheduleSheet, attributeDriver, hotelRouteText,
    isDriverPerformanceExcluded,
    UNASSIGNED_ROUTE, DRIVER_SOURCE_MANUAL, DRIVER_SOURCE_SCHEDULE,
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
    assert.deepEqual(manual, { driver: '後台小王', route: '南區', source: DRIVER_SOURCE_MANUAL });

    const scheduled = attributeDriver({
        assignedDriver: '',
        hotelKeyword: '驛館',
        deptName: '餐廳',
        date: '2026-08-13',
        routes,
        schedules,
    });
    assert.deepEqual(scheduled, { driver: '小張', route: '南區', source: DRIVER_SOURCE_SCHEDULE });

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
    assert.deepEqual(unmatched, { driver: null, route: UNASSIGNED_ROUTE, source: null });

    const routeOnly = attributeDriver({
        hotelKeyword: '承億',
        deptName: '房務',
        date: '2026-08-01',
        routes,
        schedules,
    });
    assert.equal(routeOnly.route, '南區');
    assert.equal(routeOnly.driver, null);
});

const ownerRoutes = [
    ['路線名稱', '包含飯店關鍵字'],
    ['3109-2', '富野, 秝芯, 癮室, 良一, 良西, 駱駝, 良站, 日航制服, 鴨點棧華夏'],
    ['3109', '文一, 日航, 文旅, 好地方, 泊思行旅, 鴨點棧華夏, 鼎王, 鉑麗'],
    ['5739', '歐遊, 洲際, 巨蛋, 驛館, 捷中正, 天子閣'],
    ['9739', '宮賞, 家和, 秝二, 侯工所, 河畔, 老新, 永心, 福客來, 鴨點棧明誠, 高盧, H2O'],
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
    assert.deepEqual(manualUniform, { driver: '後台小王', route: '3109-2', source: DRIVER_SOURCE_MANUAL });
    const yiguanRooms = attributeDriver({ hotelKeyword: '驛館', deptName: '房務', routes, schedules: {} });
    const yiguanRestaurant = attributeDriver({ hotelKeyword: '驛館', deptName: '餐廳', routes, schedules: {} });
    assert.equal(yiguanRooms.route, '5739');
    assert.equal(yiguanRestaurant.route, '5739');
});

test('鴨點棧華夏兩邊一樣長時，試算表上先列出的路線贏', () => {
    const laterPlateFirst = parseRouteSheet(ownerRoutes);
    assert.equal(attributeDriver({ hotelKeyword: '鴨點棧華夏', deptName: '房務', routes: laterPlateFirst, schedules: {} }).route, '3109-2');
    assert.equal(attributeDriver({ hotelKeyword: '鴨點棧明誠', deptName: '房務', routes: laterPlateFirst, schedules: {} }).route, '9739');
    const ownerOrder = parseRouteSheet([
        ownerRoutes[0],
        ownerRoutes[2],
        ownerRoutes[1],
        ownerRoutes[3],
        ownerRoutes[4],
    ]);
    assert.equal(attributeDriver({ hotelKeyword: '鴨點棧華夏', deptName: '房務', routes: ownerOrder, schedules: {} }).route, '3109');
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

test('finance.html 司機業績同時用指派與排班，不寫回 Firestore，其餘計價維持不變', () => {
    const html = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    const fn = html.slice(html.indexOf('async function calculateDriverPerformance()'), html.indexOf('function renderDriverCards()'));
    assert.match(fn, /attributeDriver\(/);
    assert.match(fn, /assignedDriver:\s*d\.assignedDriver/);
    assert.match(fn, /routes:\s*sheetRoutes/);
    assert.match(fn, /schedules:\s*sheetSchedules/);
    assert.match(fn, /manualDeletedReceipt/);
    assert.match(fn, /isDriverPerformanceExcluded\(\{ hotelKeyword: d\.hotelKeyword, deptName: d\.deptName \}\)/);
    assert.match(fn, /isDriverPerformanceExcluded\(\{ itemName: item\.itemName \}\)/);
    assert.ok(fn.indexOf('isDriverPerformanceExcluded') < fn.indexOf('attributeDriver('));
    assert.match(fn, /resolveItemBillingQty/);
    assert.match(fn, /reportRecordPrice/);
    assert.match(fn, /getLogisticsDocsForPeriod\(startDate, endDate, true\)/);
    assert.match(fn, /syncMasterDataFromSheet\(\)/);
    assert.match(fn, /if \(!driverScheduleReady\)/);
    assert.match(fn, /readSheetPrices\(\)/);
    assert.equal(fn.includes('setDoc'), false);
    assert.equal(fn.includes('updateDoc'), false);
    assert.equal(fn.includes('addDoc'), false);
    assert.equal(fn.includes('getDoc'), false);
    assert.equal(fn.includes('getDocs'), false);
    assert.match(html, /判定路線/);
    assert.match(html, /<th[^>]*>來源<\/th>/);
    assert.match(html, /後台指派/);
    assert.match(html, /排班表/);
    assert.match(html, /0\.029/);
    assert.match(html, /parseRouteSheet\(json\.routes\)/);
    assert.match(html, /parseScheduleSheet\(json\.schedules\)/);
    assert.match(html, /baiqi_driver_schedule_v2/);
});
