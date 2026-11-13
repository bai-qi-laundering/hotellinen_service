// 司機業績歸屬：後台指派優先，否則用試算表路線關鍵字與當日排班。
// 只做計算，不寫回 Firestore。
// 路線以飯店為單位：hotelKeyword 與 deptName 拼在一起比對，同一家飯店的各部門落在同一條路線。
// 關鍵字可用半形逗號、全形逗號、頓號分隔；比對時去掉空白與換行，且不分大小寫。
// 較長的關鍵字優先，所以「日航制服」會贏過「日航」，與路線在表上的順序無關。
// 一樣長時，試算表上先列出的路線贏（鴨點棧華夏同時在 3109 與 3109-2 時，3109 在前就歸 3109）。
// 排班日期沿用當時的修正：Apps Script 若把試算表日期編成 UTC（例如 2024-05-11T16:00:00.000Z），
// 那是台灣時間的隔天（2024-05-12），不能直接取 Z 前面的日期。

export const UNASSIGNED_ROUTE = '未分類路線';
export const DRIVER_SOURCE_MANUAL = '後台指派';
export const DRIVER_SOURCE_SCHEDULE = '排班表';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function cleanSheetCell(value) {
    return String(value ?? '').replace(/[\r\n\t]/g, '').trim();
}

function taipeiDate(instant) {
    const shifted = new Date(instant.getTime() + TAIPEI_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function scheduleDate(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '' : taipeiDate(value);
    }
    let text = cleanSheetCell(value);
    if (!text) return '';
    if (text.includes('T') && text.includes('Z')) {
        const instant = new Date(text);
        if (!Number.isNaN(instant.getTime())) return taipeiDate(instant);
    }
    if (text.includes('T')) text = text.split('T')[0];
    const parts = text.split(/[-/]/);
    if (parts.length >= 3 && /^\d{4}$/.test(parts[0].trim())) {
        const month = parts[1].replace(/\D/g, '');
        const day = parts[2].replace(/\D/g, '').slice(0, 2);
        if (month && day) return `${parts[0].trim()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return '';
}

export function parseRouteSheet(rows) {
    const routes = [];
    (rows || []).forEach((row, index) => {
        if (index === 0 || !Array.isArray(row)) return;
        const name = cleanSheetCell(row[0]);
        const keywords = String(row[1] ?? '')
            .split(/[,，、]/)
            .map(keyword => keyword.replace(/[\r\n\t]/g, '').trim())
            .filter(Boolean);
        if (name && keywords.length) routes.push({ name, keywords });
    });
    return routes;
}

function routeList(routes) {
    if (Array.isArray(routes)) return routes;
    return Object.entries(routes || {}).map(([name, keywords]) => ({ name, keywords }));
}

export function parseScheduleSheet(rows) {
    const schedules = {};
    (rows || []).forEach((row, index) => {
        if (index === 0 || !Array.isArray(row)) return;
        const date = scheduleDate(row[0]);
        const driverName = cleanSheetCell(row[1]);
        const routeName = cleanSheetCell(row[2]);
        if (!date || !driverName || !routeName) return;
        if (!schedules[date]) schedules[date] = {};
        schedules[date][routeName] = driverName;
    });
    return schedules;
}

export function hotelRouteText(hotelKeyword, deptName) {
    const hotel = cleanSheetCell(hotelKeyword);
    const dept = cleanSheetCell(deptName);
    if (dept && dept !== hotel) return `${hotel} ${dept}`;
    return hotel;
}

function compactKey(value) {
    return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

export function matchRoute(hotelKeyword, deptName, routes) {
    const hotelKey = compactKey(hotelRouteText(hotelKeyword, deptName));
    if (!hotelKey) return UNASSIGNED_ROUTE;
    let bestRoute = '';
    let bestLength = 0;
    for (const route of routeList(routes)) {
        const routeName = route?.name;
        const keywords = route?.keywords;
        let routeLength = 0;
        for (const keyword of keywords || []) {
            const key = compactKey(keyword);
            if (key && hotelKey.includes(key) && key.length > routeLength) routeLength = key.length;
        }
        if (routeLength > bestLength) {
            bestRoute = routeName;
            bestLength = routeLength;
        }
    }
    return bestRoute || UNASSIGNED_ROUTE;
}

// 物流單上的回洗、特處、客衣不計入司機業績（整張部門單或單一品項皆同）。
// 回洗沿用原本的品名／部門判斷。特處是 deptName「特處」或「特處部」，品名也常以「特處」開頭。
// 客衣是各飯店的部門（deptName 含「客衣」，例如然一＋客衣），不是另一套品名規則。
export function isDriverPerformanceExcluded({ hotelKeyword, deptName, itemName } = {}) {
    const marked = value => {
        const text = String(value ?? '');
        return text.includes('回洗') || text.includes('特處') || text.includes('客衣');
    };
    if (itemName != null && marked(itemName)) return true;
    if (hotelKeyword == null && deptName == null) return false;
    return marked(hotelKeyword) || marked(deptName) || marked(hotelRouteText(hotelKeyword, deptName));
}

export function attributeDriver({ assignedDriver, hotelKeyword, deptName, date, routes, schedules } = {}) {
    const route = matchRoute(hotelKeyword, deptName, routes);
    const manual = cleanSheetCell(assignedDriver);
    if (manual) return { driver: manual, route, source: DRIVER_SOURCE_MANUAL };
    const scheduled = schedules?.[date]?.[route] || '';
    if (scheduled) return { driver: scheduled, route, source: DRIVER_SOURCE_SCHEDULE };
    return { driver: null, route, source: null };
}
