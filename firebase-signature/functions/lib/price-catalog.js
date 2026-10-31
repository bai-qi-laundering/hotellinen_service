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
        prices[`${combined}_${item}`] = price;
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
    return parsePriceCell(map[key]);
}

// Effective-date history, then the Firebase catalog, then a parsed sheet cell.
export function catalogPrice({ hotel, item, date = null, rules = [], customPrices = {}, sheetPrices = {} } = {}) {
    const effective = datedPrice(rules, hotel, item, date);
    if (effective !== null) return { price: effective, source: 'effective' };
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
    const effective = datedPrice(catalog?.rules, record?.hotel, record?.item, record?.date);
    if (effective !== null) return applyHoliday(effective, holidayPercent);
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
