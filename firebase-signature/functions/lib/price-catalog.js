// Shared price lookup for the finance page, statements, and the signature function.
// A blank cell or a failed read is "unknown", never $0. An explicit 0 stays 0.

export function parsePriceCell(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined) return null;
    const text = String(value).trim()
        .replace(/,/g, '')
        .replace(/＄/g, '$')
        .replace(/^NT\$/i, '')
        .replace(/^\$/, '')
        .replace(/元$/, '')
        .trim();
    if (text === '') return null;
    const price = Number(text);
    return Number.isFinite(price) ? price : null;
}

export function normalizePriceDate(value) {
    const text = String(value ?? '').trim();
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
    if (!match) return null;
    const [, y, m, d] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) return null;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function sheetPricesFromRows(rows) {
    const prices = {};
    (rows || []).forEach((row, index) => {
        if (index === 0 || !Array.isArray(row)) return;
        const hotel = String(row[0] ?? '').trim();
        const dept = String(row[1] ?? '').trim();
        const item = String(row[2] ?? '').trim();
        const price = parsePriceCell(row[3]);
        if (!hotel || !item || price === null) return;
        const combined = dept && dept !== hotel ? `${hotel} ${dept}` : hotel;
        const key = `${combined}_${item}`;
        const rawStart = String(row[4] ?? '').trim();
        if (!rawStart) {
            if (prices[key] && typeof prices[key] === 'object') prices[key].baseline = price;
            else prices[key] = price;
            return;
        }
        const start = normalizePriceDate(rawStart);
        if (!start) throw new Error(`價格總表第 ${index + 1} 列生效日無效，請填 YYYY-MM-DD`);
        if (!prices[key] || typeof prices[key] !== 'object') {
            prices[key] = { baseline: parsePriceCell(prices[key]), history: [] };
        }
        const duplicate = prices[key].history.find(rule => rule.start === start);
        if (duplicate && duplicate.price !== price) throw new Error(`價格總表第 ${index + 1} 列有同品項同生效日的不同價格`);
        if (!duplicate) prices[key].history.push({ start, price });
    });
    return prices;
}

export function datedPrice(rules, hotel, item, date) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
    const key = `${hotel}_${item}`;
    const matches = (rules || [])
        .filter(rule => rule && rule.key === key && String(rule.start || '') <= date)
        .sort((a, b) => String(b.start).localeCompare(String(a.start)));
    for (const rule of matches) {
        const price = parsePriceCell(rule.price);
        if (price !== null) return price;
    }
    return null;
}

function lookup(map, key) {
    if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return null;
    const value = map[key];
    return parsePriceCell(value && typeof value === 'object' ? value.baseline : value);
}

// 客衣部門的「統一折扣」是這一列的價錢，不是「統一價格」，也不看品名裡有沒有客衣。
function guestLaundryLabels(hotel, deptName = '') {
    const name = String(hotel || '').trim();
    const dept = String(deptName || '').trim();
    const labels = [];
    const add = label => {
        const text = String(label || '').trim();
        if (text && !labels.includes(text)) labels.push(text);
    };
    if (dept.includes('客衣')) add(name.endsWith('客衣') ? name : `${name} ${dept}`.trim());
    if (/(?:^|\s)客衣$/.test(name)) add(name);
    return labels;
}

function sheetPriceForDate(value, date) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object') return parsePriceCell(value);
    const dated = normalizePriceDate(date);
    const history = Array.isArray(value.history) ? value.history : [];
    if (dated) {
        const match = history
            .filter(rule => normalizePriceDate(rule?.start) && rule.start <= dated && parsePriceCell(rule.price) !== null)
            .sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
        if (match) return parsePriceCell(match.price);
    }
    return parsePriceCell(value.baseline);
}

// 試算表該飯店客衣部門有「統一折扣」時，回傳那個價錢。沒有這一列就回 null，沿用原本的單價順序。
export function guestLaundryUniformPrice(record, sheetPrices) {
    const hotel = record && typeof record === 'object' ? record.hotel : record;
    const dept = record && typeof record === 'object' ? record.deptName : '';
    const date = record && typeof record === 'object' ? record.date : null;
    if (!sheetPrices) return null;
    for (const label of guestLaundryLabels(hotel, dept)) {
        const key = `${label}_統一折扣`;
        if (!Object.prototype.hasOwnProperty.call(sheetPrices, key)) continue;
        const price = sheetPriceForDate(sheetPrices[key], date);
        if (price !== null) return price;
    }
    return null;
}

// Compare dated sheet contracts and dated manual changes by their start date.
// Firebase wins a same-day tie; an older manual change cannot mask a new contract.
function effectiveRule(catalog, hotel, item, date) {
    if (!normalizePriceDate(date)) return null;
    const key = `${hotel}_${item}`;
    const sheet = catalog?.sheetPrices?.[key];
    const sheetRules = sheet && typeof sheet === 'object' && Array.isArray(sheet.history) ? sheet.history : [];
    return [
        ...sheetRules.map(rule => ({ ...rule, source: 'sheet-effective', priority: 0 })),
        ...(catalog?.rules || []).filter(rule => rule?.key === key).map(rule => ({ ...rule, source: 'effective', priority: 1 })),
    ].filter(rule => normalizePriceDate(rule.start) && rule.start <= date && parsePriceCell(rule.price) !== null)
        .sort((a, b) => b.start.localeCompare(a.start) || b.priority - a.priority)[0] || null;
}

// Effective-date history, then the Firebase catalog, then a parsed sheet cell.
export function catalogPrice({ hotel, item, date = null, rules = [], customPrices = {}, sheetPrices = {} } = {}) {
    const uniform = guestLaundryUniformPrice({ hotel, date }, sheetPrices);
    if (uniform !== null) return { price: uniform, source: 'sheet-unified' };
    const effective = effectiveRule({ rules, sheetPrices }, hotel, item, date);
    if (effective) return { price: parsePriceCell(effective.price), source: effective.source };
    const exact = `${hotel}_${item}`;
    const unified = `${hotel}_統一折扣`;
    const custom = lookup(customPrices, exact);
    if (custom !== null) return { price: custom, source: 'firebase' };
    const sheet = lookup(sheetPrices, exact);
    if (sheet !== null) return { price: sheet, source: 'sheet' };
    const customUnified = lookup(customPrices, unified);
    if (customUnified !== null) return { price: customUnified, source: 'firebase-unified' };
    const sheetUnified = lookup(sheetPrices, unified);
    if (sheetUnified !== null) return { price: sheetUnified, source: 'sheet-unified' };
    return { price: null, source: 'missing' };
}

function applyHoliday(price, percent) {
    const rate = Number(percent) || 0;
    if (!rate) return price;
    return Math.round((price * (1 + rate / 100) + Number.EPSILON) * 10) / 10;
}

// null means the price was not found. Callers must not turn that into $0.
export function unitPriceForRecord(record, catalog, holidayPercent = 0) {
    const uniform = guestLaundryUniformPrice(record, catalog?.sheetPrices);
    if (uniform !== null) return applyHoliday(uniform, holidayPercent);
    const effective = effectiveRule(catalog, record?.hotel, record?.item, record?.date);
    if (effective) return applyHoliday(parsePriceCell(effective.price), holidayPercent);
    if (record?.manualPriceOverride) {
        return parsePriceCell(record.currentPrice !== undefined ? record.currentPrice : record.savedPrice);
    }
    let original = null;
    if (record?.savedPrice !== undefined && record.savedPrice !== null && record.savedPrice !== '') {
        original = parsePriceCell(record.savedPrice);
    }
    if (original === null) {
        original = catalogPrice({ ...catalog, rules: [], hotel: record?.hotel, item: record?.item, date: record?.date }).price;
    }
    if (original === null) return null;
    return applyHoliday(original, holidayPercent);
}

// A failed read passes an empty piece. That piece must not erase the last good copy.
export function mergePriceCatalog(previous = {}, update = {}) {
    const next = {
        sheetPrices: previous.sheetPrices || {},
        customPrices: previous.customPrices || {},
        effectivePriceRules: previous.effectivePriceRules || [],
        sheetClients: previous.sheetClients || {},
    };
    if (update.sheetPrices && Object.keys(update.sheetPrices).length) next.sheetPrices = update.sheetPrices;
    if (update.customPrices && Object.keys(update.customPrices).length) next.customPrices = update.customPrices;
    if (Array.isArray(update.effectivePriceRules) && update.effectivePriceRules.length) next.effectivePriceRules = update.effectivePriceRules;
    if (update.sheetClients && Object.keys(update.sheetClients).length) next.sheetClients = update.sheetClients;
    return next;
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function attemptWithBackoff(task, { attempts = 3, delayMs = 400, onRetry } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) {
            if (onRetry) onRetry(attempt, attempts, lastError);
            await sleep(delayMs * 2 ** (attempt - 1));
        }
        try {
            return await task(attempt);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || '讀取失敗'));
}

