// Receipt-page 特處 lines. Same special_items shape as the LINE webhook, without parsing free text.

import { displayItemName } from './special-parser.js';

export const RECEIPT_SOURCE = '簽收單';

function clean(value) {
    return String(value || '').trim().replace(/[\/\\]/g, '-');
}

function departmentName(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, '').trim();
}

export function isSpecialReceiptRow(row) {
    const department = departmentName(row?.department);
    return department === '特處' || department === '特處部';
}

// Items come from the receipt's already-loaded sendwash settings, in sheet order.
// A hotel with no 特處 rows gets an empty list; there is no built-in fallback.
export function receiptSpecialItems(settings, hotel) {
    const page = String(hotel || '').trim();
    if (!page) return [];
    const names = [];
    const seen = new Set();
    for (const row of settings || []) {
        if (String(row?.hotel || '').trim() !== page || !isSpecialReceiptRow(row)) continue;
        const shown = displayItemName(row.item);
        if (!shown || seen.has(shown)) continue;
        seen.add(shown);
        names.push(shown);
    }
    return names;
}

export function sameReceiptHotel(pageHotel, ...candidates) {
    const page = String(pageHotel || '').trim();
    if (!page) return false;
    return candidates.every(value => String(value ?? '').trim() === page);
}

export function normalizeReceiptLines(lines, catalog) {
    const allowed = new Set(catalog || []);
    const totals = new Map();
    const order = [];
    for (const line of lines || []) {
        const item = String(line?.item || '').trim();
        if (!allowed.has(item)) throw new Error(item ? `品項不在特處清單：${item}` : '請選擇特處品項');
        const raw = String(line?.qty ?? '').trim();
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
            throw new Error('數量要填大於 0 的整數');
        }
        if (!totals.has(item)) order.push(item);
        totals.set(item, (totals.get(item) || 0) + Number(raw));
    }
    if (!order.length) throw new Error('請先加入特處品項');
    return order.map(item => ({ item, qty: totals.get(item) }));
}

export function receiptSpecialId(receivedDate, hotel, item) {
    return `sp_receipt_${clean(receivedDate)}_${clean(hotel)}_${clean(item)}`;
}

export function receiptEntryId(receivedDate, hotel) {
    return `en_receipt_${clean(receivedDate)}_${clean(hotel)}`;
}

export function buildReceiptSpecialDocs({ hotel, receivedDate, lines, time, entryId }) {
    const pageHotel = String(hotel || '').trim();
    const date = String(receivedDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期不正確');
    if (!pageHotel) throw new Error('缺少飯店');
    if (!time) throw new Error('缺少寫入時間');
    const sharedEntryId = entryId || receiptEntryId(date, pageHotel);
    return (lines || []).map(line => {
        const item = String(line.item || '').trim();
        const qty = Number(line.qty);
        return {
            id: receiptSpecialId(date, pageHotel, item),
            hotel: pageHotel,
            receivedDate: date,
            item,
            qty,
            source: RECEIPT_SOURCE,
            createdAt: time,
            round: 1,
            status: '待摺疊',
            history: [{ type: 'created', time, qty, round: 1 }],
            foldSignature: '',
            foldSignedAt: '',
            shipDate: '',
            shipRule: '',
            officeName: item,
            officeSignature: '',
            sentAt: '',
            unknown: false,
            entryId: sharedEntryId,
            splitOf: '',
            deleted: false,
            deletedAt: '',
            edits: [],
            lineUserId: '',
            lineDisplayName: '',
            lineMessageId: '',
        };
    });
}

// Second submit of the same receipt line replaces the quantity. It does not add another document.
export function nextReceiptWrite(existing, nextDoc) {
    if (!existing || existing.deleted) return { action: 'create', doc: nextDoc };
    if (existing.source !== RECEIPT_SOURCE || existing.hotel !== nextDoc.hotel || existing.item !== nextDoc.item) {
        throw new Error(`${nextDoc.item} 已經有另一筆特處資料，沒有覆寫。`);
    }
    if ((existing.status && existing.status !== '待摺疊') || existing.foldSignature || existing.foldSignedAt) {
        throw new Error(`${nextDoc.item} 已經進入摺疊或出貨，沒有覆寫。`);
    }
    const createdAt = existing.createdAt || nextDoc.createdAt;
    const doc = {
        ...nextDoc,
        id: nextDoc.id,
        createdAt,
        entryId: existing.entryId || nextDoc.entryId,
        history: [{ type: 'created', time: createdAt, qty: nextDoc.qty, round: 1 }],
    };
    const same = existing.qty === nextDoc.qty && existing.receivedDate === nextDoc.receivedDate;
    return { action: same ? 'same' : 'update', doc };
}
