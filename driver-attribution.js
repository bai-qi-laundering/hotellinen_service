// 司機業績歸屬：後台指派優先，否則用試算表路線關鍵字與當日排班。
// 只做計算，不寫回 Firestore。路線比對沿用 2026-08 的規則：
// 飯店關鍵字可用半形逗號、全形逗號、頓號分隔；比對時去掉空白與換行，且不分大小寫，先列出的路線先贏。
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
    const routes = {};
    (rows || []).forEach((row, index) => {
        if (index === 0 || !Array.isArray(row)) return;
        const routeName = cleanSheetCell(row[0]);
        const keywords = String(row[1] ?? '')
            .split(/[,，、]/)
            .map(keyword => keyword.replace(/[\r\n\t]/g, '').trim())
            .filter(Boolean);
        if (routeName && keywords.length) routes[routeName] = keywords;
    });
    return routes;
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
    for (const [routeName, keywords] of Object.entries(routes || {})) {
        const hit = (keywords || []).some(keyword => {
            const key = compactKey(keyword);
            return key && hotelKey.includes(key);
        });
        if (hit) return routeName;
    }
    return UNASSIGNED_ROUTE;
}

export function attributeDriver({ assignedDriver, hotelKeyword, deptName, date, routes, schedules } = {}) {
    const route = matchRoute(hotelKeyword, deptName, routes);
    const manual = cleanSheetCell(assignedDriver);
    if (manual) return { driver: manual, route, source: DRIVER_SOURCE_MANUAL };
    const scheduled = schedules?.[date]?.[route] || '';
    if (scheduled) return { driver: scheduled, route, source: DRIVER_SOURCE_SCHEDULE };
    return { driver: null, route, source: null };
}
