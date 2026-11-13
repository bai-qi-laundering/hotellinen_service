// 司機業績歸屬：手動指派優先，否則用試算表路線關鍵字，再沿用該路線生效日當天或之前最近一筆排班。
// logistics_records.driverSource 為 manual，或舊資料已有 assignedDriver 但沒有 driverSource，以後台司機為準，不自動覆蓋。
// driverSource 為 schedule，或還沒有司機，則用當下排班重算。
// planDriverWritebacks 只產出「排班有司機、且欄位與目前不同」的回寫；回洗、特處、客衣不回寫。
// 路線以飯店為單位：hotelKeyword 與 deptName 拼在一起比對，同一家飯店的各部門落在同一條路線。
// 關鍵字可用半形逗號、全形逗號、頓號分隔；比對時去掉空白、連字號與換行，且不分大小寫。
// 較長的關鍵字優先，所以「日航制服」會贏過「日航」，與路線在表上的順序無關。
// 一樣長時，試算表上先列出的路線贏。鴨點棧華夏只列在 3109-2。
// 排班日期一律轉成台北時間的 YYYY-MM-DD。Apps Script 若把試算表日期編成 UTC
// （例如 2024-05-11T16:00:00.000Z），那是台灣時間的隔天（2024-05-12）。
// 斜線日期 2026/11/01 同樣轉成 2026-11-01。路線代號用去空白字串比較，數字 3109 與 "3109" 相同。

export const UNASSIGNED_ROUTE = '未分類路線';
export const DRIVER_SOURCE_MANUAL = '後台指派';
export const DRIVER_SOURCE_SCHEDULE = '排班表';
export const UNATTRIBUTED_NO_ROUTE = '對不到路線';
export const UNATTRIBUTED_NO_SCHEDULE = '路線尚未排班';
export const UNATTRIBUTED_NO_DATA = '無排班資料載入';
export const DRIVER_RECORD_MANUAL = 'manual';
export const DRIVER_RECORD_SCHEDULE = 'schedule';
export const RESTORE_SCHEDULE_CHOICE = '__restore_schedule__';
export const DRIVER_WRITE_BATCH_LIMIT = 500;

const DRIVER_FIELD_KEYS = ['assignedDriver', 'driverSource', 'driverRoute', 'driverEffectiveDate'];

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

export function normalizeRouteName(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        return plateFromSheetDate(taipeiDate(value)) || taipeiDate(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const rounded = Math.round(value);
        if (Math.abs(value - rounded) < 1e-6) return String(rounded);
        return String(value);
    }
    const text = cleanSheetCell(value);
    if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
    return plateFromSheetDate(text) || text;
}

// Sheets 常把車牌 3109-2 自動變成該年該月 1 日。只還原四位數大於 3000 的這種日期，避免碰到真正的出貨日。
function plateFromSheetDate(text) {
    const match = String(text || '').match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 3000 || day !== 1 || month < 1 || month > 12) return '';
    return `${year}-${month}`;
}

export function parseRouteSheet(rows) {
    const routes = [];
    (rows || []).forEach((row, index) => {
        if (index === 0 || !Array.isArray(row)) return;
        const name = normalizeRouteName(row[0]);
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
        const routeName = normalizeRouteName(row[2]);
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
    return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/[－—–\-]/g, '').toLowerCase();
}

export function scheduleEntries(schedules) {
    if (Array.isArray(schedules)) return schedules.filter(row => row && row.date && row.route && row.driver);
    const entries = [];
    for (const [date, routes] of Object.entries(schedules || {})) {
        for (const [route, driver] of Object.entries(routes || {})) {
            if (date && route && driver) entries.push({ date, route: normalizeRouteName(route), driver });
        }
    }
    return entries;
}

export function carriedDriver(schedules, route, date) {
    const name = normalizeRouteName(route);
    const day = scheduleDate(date) || cleanSheetCell(date);
    if (!name || !day) return null;
    let best = null;
    for (const row of scheduleEntries(schedules)) {
        if (normalizeRouteName(row.route) !== name) continue;
        if (row.date > day) continue;
        if (!best || row.date >= best.date) best = row;
    }
    return best;
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
            bestRoute = normalizeRouteName(routeName);
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

// 舊資料沒有 driverSource、但已經有負責司機時，一律視為手動，避免被排班蓋掉。
export function storedDriverSource(record = {}) {
    const source = cleanSheetCell(record?.driverSource);
    if (source === DRIVER_RECORD_MANUAL || source === DRIVER_RECORD_SCHEDULE) return source;
    if (cleanSheetCell(record?.assignedDriver)) return DRIVER_RECORD_MANUAL;
    return '';
}

export function driverFieldsUnchanged(record, fields) {
    if (!fields) return true;
    return DRIVER_FIELD_KEYS.every(key => cleanSheetCell(record?.[key]) === cleanSheetCell(fields[key]));
}

export function manualDriverPatch(driverName) {
    const name = cleanSheetCell(driverName);
    if (!name || name === RESTORE_SCHEDULE_CHOICE) return null;
    return {
        assignedDriver: name,
        driverSource: DRIVER_RECORD_MANUAL,
        driverRoute: '',
        driverEffectiveDate: '',
    };
}

// 搬單或補建物流單時保留來源。只有名字、沒有來源的舊資料會帶成 manual。
export function copiedDriverFields(source = {}) {
    const kind = storedDriverSource(source);
    if (kind === DRIVER_RECORD_SCHEDULE) {
        return {
            assignedDriver: cleanSheetCell(source?.assignedDriver),
            driverSource: DRIVER_RECORD_SCHEDULE,
            driverRoute: cleanSheetCell(source?.driverRoute),
            driverEffectiveDate: cleanSheetCell(source?.driverEffectiveDate),
        };
    }
    if (kind === DRIVER_RECORD_MANUAL) {
        return {
            assignedDriver: cleanSheetCell(source?.assignedDriver),
            driverSource: DRIVER_RECORD_MANUAL,
            driverRoute: '',
            driverEffectiveDate: '',
        };
    }
    return { assignedDriver: '', driverSource: '', driverRoute: '', driverEffectiveDate: '' };
}

function scheduleAttribution(record, context = {}) {
    return attributeDriver({
        assignedDriver: '',
        driverSource: DRIVER_RECORD_SCHEDULE,
        hotelKeyword: record?.hotelKeyword,
        deptName: record?.deptName,
        date: record?.date,
        routes: context.routes,
        schedules: context.schedules,
        schedulesLoaded: context.schedulesLoaded !== false,
    });
}

function scheduleFieldsFromAttribution(attribution) {
    return {
        assignedDriver: attribution.driver,
        driverSource: DRIVER_RECORD_SCHEDULE,
        driverRoute: attribution.route,
        driverEffectiveDate: attribution.effectiveDate || '',
    };
}

// 自動回寫只在排班算得出司機、而且和目前欄位不同時才有內容。手動與對不到路線／沒排班回傳 null。
export function driverWritebackFields(record, context = {}) {
    if (!record || record.manualDeletedReceipt) return null;
    if (isDriverPerformanceExcluded({ hotelKeyword: record.hotelKeyword, deptName: record.deptName })) return null;
    if (storedDriverSource(record) === DRIVER_RECORD_MANUAL) return null;
    const attribution = scheduleAttribution(record, context);
    if (!attribution.driver || attribution.source !== DRIVER_SOURCE_SCHEDULE) return null;
    const fields = scheduleFieldsFromAttribution(attribution);
    return driverFieldsUnchanged(record, fields) ? null : fields;
}

export function planDriverWritebacks(records, context = {}) {
    const plans = [];
    for (const record of records || []) {
        const id = cleanSheetCell(record?.id);
        if (!id) continue;
        const fields = driverWritebackFields(record, context);
        if (!fields) continue;
        plans.push({ id, fields });
    }
    return plans;
}

// 手動改回未指派，或點「恢復排班」：清掉手動鎖，改回當下排班。已經一樣就不必再寫。
export function scheduleReleasePatch(record, context = {}) {
    const excluded = isDriverPerformanceExcluded({ hotelKeyword: record?.hotelKeyword, deptName: record?.deptName });
    // 排班表沒讀到時不要清掉現有司機，避免按「恢復排班」把手動指定抹掉。
    if (!excluded && context.schedulesLoaded === false) return null;
    let fields;
    if (excluded) {
        fields = { assignedDriver: '', driverSource: DRIVER_RECORD_SCHEDULE, driverRoute: '', driverEffectiveDate: '' };
    } else {
        const computed = driverWritebackFields({
            ...record,
            assignedDriver: '',
            driverSource: DRIVER_RECORD_SCHEDULE,
            driverRoute: '',
            driverEffectiveDate: '',
            manualDeletedReceipt: false,
        }, context);
        fields = computed || { assignedDriver: '', driverSource: DRIVER_RECORD_SCHEDULE, driverRoute: '', driverEffectiveDate: '' };
    }
    return driverFieldsUnchanged(record, fields) ? null : fields;
}

export function driverChoicePatch(record, choice, context = {}) {
    const value = cleanSheetCell(choice);
    if (!value || value === RESTORE_SCHEDULE_CHOICE) return scheduleReleasePatch(record, context);
    const fields = manualDriverPatch(value);
    if (!fields || driverFieldsUnchanged(record, fields)) return null;
    return fields;
}

export function chunkDriverWritebacks(plans, size = DRIVER_WRITE_BATCH_LIMIT) {
    const list = Array.isArray(plans) ? plans : [];
    const limit = Math.min(Math.max(Number(size) || DRIVER_WRITE_BATCH_LIMIT, 1), DRIVER_WRITE_BATCH_LIMIT);
    const chunks = [];
    for (let index = 0; index < list.length; index += limit) chunks.push(list.slice(index, index + limit));
    return chunks;
}

// 只寫有變動的文件，每批最多 500 筆。呼叫端要傳入已經載入的計畫，這裡不再讀 Firestore。
export async function commitDriverWritebacks(plans, deps = {}) {
    const list = (Array.isArray(plans) ? plans : []).filter(plan => plan && cleanSheetCell(plan.id) && plan.fields);
    if (!list.length) return 0;
    const { writeBatch, doc, db } = deps;
    if (typeof writeBatch !== 'function' || typeof doc !== 'function') throw new Error('回寫司機需要 Firestore batch');
    let written = 0;
    for (const chunk of chunkDriverWritebacks(list)) {
        const batch = writeBatch(db);
        for (const plan of chunk) {
            batch.set(doc(db, 'logistics_records', plan.id), plan.fields, { merge: true });
        }
        await batch.commit();
        written += chunk.length;
    }
    return written;
}

export function attributeDriver({ assignedDriver, driverSource, hotelKeyword, deptName, date, routes, schedules, schedulesLoaded = true } = {}) {
    const route = matchRoute(hotelKeyword, deptName, routes);
    const manualName = cleanSheetCell(assignedDriver);
    const sourceKind = cleanSheetCell(driverSource);
    const manualLock = sourceKind === DRIVER_RECORD_MANUAL || (sourceKind !== DRIVER_RECORD_SCHEDULE && !!manualName);
    if (manualLock) {
        return {
            driver: manualName || null,
            route,
            source: DRIVER_SOURCE_MANUAL,
            reason: null,
            effectiveDate: '',
        };
    }
    if (route === UNASSIGNED_ROUTE) {
        return { driver: null, route, source: null, reason: UNATTRIBUTED_NO_ROUTE, effectiveDate: '' };
    }
    if (schedulesLoaded === false || schedules == null) {
        return { driver: null, route, source: null, reason: UNATTRIBUTED_NO_DATA, effectiveDate: '' };
    }
    const carried = carriedDriver(schedules, route, date);
    if (carried) {
        return {
            driver: carried.driver,
            route,
            source: DRIVER_SOURCE_SCHEDULE,
            reason: null,
            effectiveDate: carried.date,
        };
    }
    return { driver: null, route, source: null, reason: UNATTRIBUTED_NO_SCHEDULE, effectiveDate: '' };
}
