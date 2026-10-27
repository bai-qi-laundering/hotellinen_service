// 出貨單日期 for 特處.
// (1) a 收送日設定 row whose 部門 is 特處
// (2) otherwise any row for that hotel, using 收件後的下一個收送日
// (3) otherwise the same fallback as index.html getTargetDateStr
//     (same-day list, 捷中正 previous day, everyone else next day)
// Fixed delivery days start searching the day AFTER the fold-sign date.
// The sign date itself is never used, even when it is a delivery weekday.

import { formatMd } from './special-time.js';

// Kept in lockstep with index.html todayHotels / yesterdayHotels.
export const SAME_DAY_HOTELS = ['歐遊', 'H2O', '花季Ａ館', '花季Ｃ館', '花季', '文七', '好六', '媚力泊'];
export const PREVIOUS_DAY_HOTELS = ['捷中正'];

const WEEKDAY_NAME = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_MAP = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

function normalizeName(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, '').trim();
}

function normalizeDept(value) {
    const dept = normalizeName(value);
    return ['餐飲部', '房務部'].includes(dept) ? dept.slice(0, -1) : dept;
}

function isSpecialDept(value) {
    const dept = normalizeDept(value);
    return dept === '特處' || dept === '特處部';
}

function calendarDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) throw new Error('日期格式錯誤');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    const back = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (back !== iso) throw new Error('日期不存在');
    return date;
}

function isoFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(iso, amount) {
    const date = calendarDate(iso);
    date.setDate(date.getDate() + amount);
    return isoFromDate(date);
}

export function parseDeliveryDays(value) {
    if (Array.isArray(value) && value.length && value.every(item => Number.isInteger(Number(item)) && String(item).trim() !== '')) {
        const days = value.map(item => Number(item));
        if (days.every(day => day >= 0 && day <= 6)) return [...new Set(days)];
        return null;
    }
    const source = Array.isArray(value) ? value.join('、') : value;
    const text = String(source || '').normalize('NFKC').replace(/星期|禮拜|週|周/g, '');
    const parts = text.split(/[、,，;；/|\s]+/).filter(Boolean);
    const compact = parts.length === 1 && [...parts[0]].every(ch => Object.prototype.hasOwnProperty.call(WEEKDAY_MAP, ch) || /^[0-7]$/.test(ch));
    const tokens = compact ? [...parts[0]] : parts;
    const days = [];
    for (const token of tokens) {
        if (Object.prototype.hasOwnProperty.call(WEEKDAY_MAP, token)) days.push(WEEKDAY_MAP[token]);
        else if (/^[0-7]$/.test(token)) days.push(Number(token) % 7);
        else return null;
    }
    return days.length ? [...new Set(days)] : null;
}

export function formatDeliveryDays(days) {
    return WEEKDAY_ORDER.filter(day => days.includes(day)).map(day => WEEKDAY_NAME[day]).join('');
}

function nextDeliveryDate(iso, days) {
    const date = calendarDate(iso);
    for (let offset = 1; offset <= 7; offset += 1) {
        date.setDate(date.getDate() + 1);
        if (days.includes(date.getDay())) return isoFromDate(date);
    }
    return null;
}

function usableRows(schedules) {
    if (!Array.isArray(schedules)) return [];
    const rows = [];
    for (const row of schedules) {
        const hotel = String(row?.hotel || '').trim();
        const department = String(row?.department || '').trim();
        const rule = String(row?.rule || '').trim();
        if (!hotel || !department) continue;
        if (rule && rule !== '收件後的下一個收送日') continue;
        const days = parseDeliveryDays(row.days);
        if (!days || !days.length) continue;
        rows.push({ hotel, department, days, rule: '收件後的下一個收送日' });
    }
    return rows;
}

// Step 3 only: index.html getTargetDateStr when that hotel has no schedule row.
export function legacyTargetDate(hotel, refDate) {
    calendarDate(refDate);
    if (SAME_DAY_HOTELS.some(keyword => hotel.includes(keyword))) {
        return { shipDate: refDate, shipRule: '沿用盤點規則・當日打單' };
    }
    if (PREVIOUS_DAY_HOTELS.some(keyword => hotel.includes(keyword))) {
        return { shipDate: addDays(refDate, -1), shipRule: '沿用盤點規則・前一日（捷中正）' };
    }
    return { shipDate: addDays(refDate, 1), shipRule: '沿用盤點規則・隔日打單' };
}

export function computeShipDate(hotel, signedDate, schedules) {
    const name = String(hotel || '').trim();
    if (!name) throw new Error('缺少飯店');
    calendarDate(signedDate);
    const rows = usableRows(schedules).filter(row => normalizeName(row.hotel) === normalizeName(name));
    const special = rows.find(row => isSpecialDept(row.department));
    const chosen = special || rows[0];
    if (chosen) {
        const shipDate = nextDeliveryDate(signedDate, chosen.days);
        if (shipDate) {
            const who = special ? '特處' : chosen.department;
            return {
                shipDate,
                shipRule: `收送日設定・${who}・${formatDeliveryDays(chosen.days)}・收件後的下一個收送日`,
                step: special ? 1 : 2,
            };
        }
    }
    return { ...legacyTargetDate(name, signedDate), step: 3 };
}

export function shipDateLabel(shipDate, shipRule) {
    if (!shipDate) return '';
    return `出貨單日期 ${formatMd(shipDate)}・${shipRule || ''}`;
}
