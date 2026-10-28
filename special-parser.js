// Free-text parser for 特處 linen. The LINE webhook uses parseSpecialEntry.
// The folding page only shows items that webhook already wrote.

import { formatMd, taipeiToday } from './special-time.js';

export const DEFAULT_SPECIAL_ITEMS = [
    '床單', '被套', '枕頭', '枕套', '足巾', '大毛', '中毛', '小毛',
    '浴袍', '浴巾', '毛巾', '方巾', '地巾',
];

// Voice-dictation misses. The key is what staff say; the value is the linen name.
export const ITEM_ALIASES = {
    '足金': '足巾',
    '祖巾': '足巾',
    '族巾': '足巾',
    '被罩': '被套',
    '床单': '床單',
    '枕投': '枕頭',
    '枕头': '枕頭',
    '浴跑': '浴袍',
};

const MEASURE = new Set([...'條件床個張顆套片組雙']);
const QTY_MARK = new Set([...'*xX×＊']);
const HAN_DIGIT = { '零': '0', '〇': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9' };
const ASCII_DIGIT = { '0': '零', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八', '9': '九' };
const CN_VALUE = { '一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

function stripPunctuation(value) {
    return String(value || '').replace(/[\s，。、,.！!？?；;：:「」『』""''（）()【】[\]…—～~·・／/\\_=+@#$%^&|<>]+/g, '');
}

export function displayItemName(name) {
    const core = String(name || '').trim().replace(/^(特處)+/, '');
    if (!core) throw new Error('品項名稱是空的');
    return `特處${core}`;
}

export function normalizeEntryText(text) {
    return stripPunctuation(String(text || '').normalize('NFKC')).replace(/今天|今日|那個|嗯/g, '');
}

function hotelCharsEqual(hotelChar, inputChar) {
    if (hotelChar === inputChar) return true;
    if (HAN_DIGIT[hotelChar] && HAN_DIGIT[hotelChar] === inputChar) return true;
    if (ASCII_DIGIT[hotelChar] && ASCII_DIGIT[hotelChar] === inputChar) return true;
    if ((hotelChar === '二' || hotelChar === '兩' || hotelChar === '两') && inputChar === '2') return true;
    if (hotelChar === '2' && (inputChar === '二' || inputChar === '兩' || inputChar === '两')) return true;
    if (hotelChar === '二' && (inputChar === '兩' || inputChar === '两')) return true;
    return false;
}

// Returns how many input characters the hotel name consumes, or null.
// A digit written in place of the hotel's own numeral (好6 = 好六) is part of the hotel.
function hotelPrefixLength(input, hotel) {
    const name = stripPunctuation(String(hotel || '').normalize('NFKC'));
    if (!name) return null;
    let i = 0;
    let j = 0;
    while (j < name.length && i < input.length) {
        if (!hotelCharsEqual(name[j], input[i])) return null;
        i += 1;
        j += 1;
    }
    return j === name.length ? i : null;
}

function matchHotel(input, hotels) {
    let best = null;
    for (const hotel of hotels) {
        const consumed = hotelPrefixLength(input, String(hotel || '').trim());
        if (consumed == null) continue;
        const canonicalLen = stripPunctuation(String(hotel).normalize('NFKC')).length;
        if (!best || consumed > best.consumed || (consumed === best.consumed && canonicalLen > best.canonicalLen)) {
            best = { hotel: String(hotel).trim(), consumed, canonicalLen };
        }
    }
    return best;
}

export function buildItemCatalog(extraItems = []) {
    const list = [];
    const seen = new Set();
    function add(token, canonical) {
        const key = String(token || '');
        if (!key || seen.has(key)) return;
        seen.add(key);
        list.push({ token: key, canonical });
    }
    const system = [...extraItems].map(name => String(name || '').trim()).filter(Boolean);
    system.sort((a, b) => b.length - a.length);
    for (const raw of system) {
        const normalized = stripPunctuation(String(raw).normalize('NFKC'));
        if (!normalized) continue;
        add(normalized, raw);
        const stripped = normalized.replace(/^(特處)+/, '');
        if (stripped) add(stripped, raw.startsWith('特處') ? raw : stripped);
    }
    for (const [alias, target] of Object.entries(ITEM_ALIASES)) add(alias, target);
    for (const name of DEFAULT_SPECIAL_ITEMS) add(name, name);
    list.sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token, 'zh-Hant'));
    return list;
}

function matchCatalog(text, index, catalog) {
    let best = null;
    function consider(from) {
        for (const entry of catalog) {
            if (text.startsWith(entry.token, from)) {
                const cand = { canonical: entry.canonical, end: from + entry.token.length, unknown: false };
                if (!best || cand.end > best.end) best = cand;
                return;
            }
        }
    }
    consider(index);
    let from = index;
    while (text.startsWith('特處', from)) {
        from += 2;
        consider(from);
    }
    return best;
}

function parseNumber(text, index) {
    const ch = text[index];
    if (ch >= '0' && ch <= '9') {
        let end = index + 1;
        while (end < text.length && text[end] >= '0' && text[end] <= '9') end += 1;
        const value = Number(text.slice(index, end));
        if (!Number.isSafeInteger(value) || value <= 0) return null;
        return { value, end };
    }
    if (ch === '十') {
        let value = 10;
        let end = index + 1;
        if (CN_VALUE[text[end]]) {
            value += CN_VALUE[text[end]];
            end += 1;
        }
        return { value, end };
    }
    if (CN_VALUE[ch]) {
        if (text[index + 1] === '十') {
            let value = CN_VALUE[ch] * 10;
            let end = index + 2;
            if (CN_VALUE[text[end]]) {
                value += CN_VALUE[text[end]];
                end += 1;
            }
            return { value, end };
        }
        return { value: CN_VALUE[ch], end: index + 1 };
    }
    return null;
}

function optionalMeasure(text, index, catalog) {
    if (index >= text.length || !MEASURE.has(text[index])) return index;
    if (matchCatalog(text, index, catalog)) return index;
    return index + 1;
}

function readUnknown(text, index, catalog) {
    if (index >= text.length) return null;
    if (parseNumber(text, index) || QTY_MARK.has(text[index])) return null;
    let end = index;
    while (end < text.length) {
        if (end > index && (parseNumber(text, end) || matchCatalog(text, end, catalog) || QTY_MARK.has(text[end]))) break;
        end += 1;
    }
    const name = text.slice(index, end);
    if (!name) return null;
    return { canonical: name, end, unknown: true };
}

// A numeral inside an unknown hotel name (好七) is not a quantity.
// It only starts the item list when a measure word and/or an item follows it.
function looksLikeQuantity(text, index, catalog) {
    const number = parseNumber(text, index);
    if (!number) return false;
    const cursor = optionalMeasure(text, number.end, catalog);
    return !!(matchCatalog(text, cursor, catalog) || readUnknown(text, cursor, catalog));
}

function guessHotel(text, catalog) {
    for (let i = 0; i < text.length; i += 1) {
        if (looksLikeQuantity(text, i, catalog) || matchCatalog(text, i, catalog)) return text.slice(0, i);
    }
    return text;
}

function parseItemLines(text, catalog) {
    const rows = [];
    let i = 0;
    while (i < text.length) {
        if (QTY_MARK.has(text[i])) {
            i += 1;
            continue;
        }
        const leading = parseNumber(text, i);
        if (leading) {
            let cursor = optionalMeasure(text, leading.end, catalog);
            const item = matchCatalog(text, cursor, catalog) || readUnknown(text, cursor, catalog);
            if (!item) {
                i += 1;
                continue;
            }
            rows.push({ canonical: item.canonical, qty: leading.value, unknown: item.unknown });
            i = item.end;
            continue;
        }
        const item = matchCatalog(text, i, catalog);
        if (item) {
            let cursor = item.end;
            if (cursor < text.length && QTY_MARK.has(text[cursor])) cursor += 1;
            const trailing = parseNumber(text, cursor);
            let qty = 1;
            if (trailing) {
                qty = trailing.value;
                cursor = optionalMeasure(text, trailing.end, catalog);
            }
            rows.push({ canonical: item.canonical, qty, unknown: false });
            i = cursor;
            continue;
        }
        const unknown = readUnknown(text, i, catalog);
        if (unknown) {
            let cursor = unknown.end;
            if (cursor < text.length && QTY_MARK.has(text[cursor])) cursor += 1;
            const trailing = parseNumber(text, cursor);
            let qty = 1;
            if (trailing) {
                qty = trailing.value;
                cursor = optionalMeasure(text, trailing.end, catalog);
            }
            rows.push({ canonical: unknown.canonical, qty, unknown: true });
            i = cursor;
            continue;
        }
        i += 1;
    }
    return rows;
}

function mergeLines(rows) {
    const map = new Map();
    const order = [];
    for (const row of rows) {
        const item = displayItemName(row.canonical);
        if (!map.has(item)) {
            map.set(item, { item, qty: row.qty, unknown: !!row.unknown });
            order.push(item);
        } else {
            const current = map.get(item);
            current.qty += row.qty;
            current.unknown = current.unknown || !!row.unknown;
        }
    }
    return order.map(key => map.get(key));
}

export function formatEntryMessage(receivedDate, hotel, lines) {
    const body = lines.map(line => `${line.item}*${line.qty}${line.unknown ? '（新品項？）' : ''}`).join(' ');
    return `已寫入 ${formatMd(receivedDate)}：${hotel} ${body}`;
}

export function parseSpecialEntry(text, options = {}) {
    const hotels = Array.isArray(options.hotels) ? options.hotels : [];
    if (!hotels.length) return { ok: false, code: 'no-hotels', message: '飯店清單還沒載入' };
    const receivedDate = options.receivedDate || taipeiToday();
    const normalized = normalizeEntryText(text);
    if (!normalized) return { ok: false, code: 'empty', message: '請輸入內容' };
    const catalog = buildItemCatalog(options.items || []);
    const hotelHit = matchHotel(normalized, hotels);
    if (!hotelHit) {
        const guess = guessHotel(normalized, catalog);
        return {
            ok: false,
            code: 'hotel',
            hotelGuess: guess,
            message: guess ? `找不到飯店：${guess}` : '找不到飯店',
        };
    }
    const rows = parseItemLines(normalized.slice(hotelHit.consumed), catalog);
    const lines = mergeLines(rows).filter(line => line.qty > 0);
    if (!lines.length) return { ok: false, code: 'no-items', hotel: hotelHit.hotel, message: '沒有辨識到品項' };
    if (lines.some(line => line.qty > 9999)) return { ok: false, code: 'qty', hotel: hotelHit.hotel, message: '數量看起來不對，請改成 9999 以內' };
    return {
        ok: true,
        hotel: hotelHit.hotel,
        receivedDate,
        lines,
        message: formatEntryMessage(receivedDate, hotelHit.hotel, lines),
    };
}
