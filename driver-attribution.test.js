import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    scheduleDate, parseRouteSheet, parseScheduleSheet, attributeDriver, hotelRouteText,
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
    assert.deepEqual(routes['北區'], ['君悅', '晶華', '文旅', 'H2O']);
    assert.deepEqual(routes['南區'], ['驛館', '承億']);
    assert.deepEqual(Object.keys(routes), ['北區', '南區', '後排']);
    assert.deepEqual(parseRouteSheet(null), {});
});

test('飯店加部門、去空白、不分大小寫，先列出的路線先贏', () => {
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

test('finance.html 司機業績同時用指派與排班，不寫回 Firestore，其餘計價維持不變', () => {
    const html = fs.readFileSync(new URL('./finance.html', import.meta.url), 'utf8');
    const fn = html.slice(html.indexOf('async function calculateDriverPerformance()'), html.indexOf('function renderDriverCards()'));
    assert.match(fn, /attributeDriver\(/);
    assert.match(fn, /assignedDriver:\s*d\.assignedDriver/);
    assert.match(fn, /routes:\s*sheetRoutes/);
    assert.match(fn, /schedules:\s*sheetSchedules/);
    assert.match(fn, /manualDeletedReceipt/);
    assert.match(fn, /回洗/);
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
    assert.match(html, /baiqi_driver_schedule_v1/);
});
