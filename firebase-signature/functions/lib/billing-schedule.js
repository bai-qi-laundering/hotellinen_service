// 結帳日有三種：
// `25th` = 每月 25 日，期間為上月 26 日～本月 25 日。
// `month` = 每月最後一天，期間為當月 1 日～最後一天。
// `1st` = 每月 1 日，期間為前一個曆月（上月 1 日～上月最後一天）。
// 空白字串代表這筆設定明確不自動結帳，沿用財務頁既有規則。
import { legacyDatePrefixes } from './logistics-items.js';
import { canonicalHotelKeyword, settlementGroup } from './auto-close.js';

export const BILLING_TIME_ZONE = 'Asia/Taipei';
export const BILLING_HOUR = 9;
export const BILLING_MINUTE = 30;
// 1 日是 1 號組。28–31 只為了讓 2 月與 30 天的月份仍能在「最後一天」啟動。
// 不是 1 日、25 日，也不是該月最後一天時，函式在讀 Firestore 之前就結束。
export const BILLING_CRON = '30 9 1,25,28,29,30,31 * *';
export const KNOWN_BILLING_GROUPS = Object.freeze(['25th', 'month', '1st']);

export function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 回傳今天要結的組別。不是結帳日就回 null，呼叫端不得讀資料庫。
export function billingGroupForDate(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) return null;
    const last = lastDayOfMonth(year, month);
    if (day < 1 || day > last) return null;
    if (day === 1) return '1st';
    if (day === 25) return '25th';
    if (day === last) return 'month';
    return null;
}

export function shouldReadFirestore({ date, enabled }) {
    return !!enabled && billingGroupForDate(date) !== null;
}

export function hotelKeywordsFromTemplate(template) {
    const names = new Set();
    for (const item of template?.items || []) {
        const name = String(item?.baseName || '').trim();
        if (name) names.add(name);
    }
    return [...names];
}

export function dueHotelKeywords(baseNames, groups, group) {
    if (!KNOWN_BILLING_GROUPS.includes(group)) return [];
    const due = new Set();
    for (const name of baseNames || []) {
        const trimmed = String(name || '').trim();
        if (trimmed && settlementGroup(trimmed, groups) === group) due.add(trimmed);
    }
    // 設定裡的舊名（天幕）改成物流名稱（天慕）後才查，避免同一家查兩次或用錯名字出單。
    for (const [name, value] of Object.entries(groups || {})) {
        const trimmed = canonicalHotelKeyword(name);
        if (trimmed && value === group) due.add(trimmed);
    }
    return [...due].sort((a, b) => a.localeCompare(b, 'zh-TW'));
}

// 便宜的記憶體檢查：設定裡出現名單以外的結帳日、或名稱對不到物流飯店時記一筆。
export function settlementWarnings(baseNames, groups) {
    const warnings = [];
    const seen = new Set();
    const push = warning => {
        const key = `${warning.type}\n${warning.customer}`;
        if (seen.has(key)) return;
        seen.add(key);
        warnings.push(warning);
    };
    const names = new Set((baseNames || []).map(name => String(name || '').trim()).filter(Boolean));
    for (const [customer, raw] of Object.entries(groups || {})) {
        const value = String(raw ?? '');
        const canonical = canonicalHotelKeyword(customer);
        if (!KNOWN_BILLING_GROUPS.includes(value) && value !== '') push({ type: 'unknown_day', customer: canonical, value });
        if (!names.has(canonical)) push({ type: 'not_in_template', customer: canonical, value });
    }
    for (const customer of names) {
        const value = String(settlementGroup(customer, groups) ?? '');
        if (value === '') push({ type: 'no_billing_day', customer, value });
        else if (!KNOWN_BILLING_GROUPS.includes(value)) push({ type: 'unknown_day', customer, value });
    }
    return warnings;
}

// 只查這家飯店、這段期間。零填充的 YYYY-MM-DD 用一條區間；
// 舊的「2026-9-26」這種不補零日期才另外用月份前綴，避免整月所有飯店一起掃。
export function hotelPeriodQueries(start, end) {
    const queries = [{ kind: 'range', start, end }];
    for (const prefix of legacyDatePrefixes(start, end)) {
        if (/^\d{4}-\d-$/.test(prefix)) queries.push({ kind: 'prefix', prefix });
    }
    queries.push({ kind: 'timestamp', start, end });
    return queries;
}
