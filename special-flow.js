// Pure state changes for one special_items line. The page persists the upserts.

import { displayItemName } from './special-parser.js';
import { formatMd, formatTaipeiStamp } from './special-time.js';

export const FOLD_STATUS = '待摺疊';
export const REWORK_STATUS = '重工中';
export const SIGNED_STATUS = '已簽名';
export const SENT_STATUS = '已送出';

function clone(doc) {
    return {
        ...doc,
        history: (doc.history || []).map(event => ({ ...event })),
        edits: (doc.edits || []).map(edit => ({
            ...edit,
            before: edit.before ? { ...edit.before } : edit.before,
            after: edit.after ? { ...edit.after } : edit.after,
        })),
    };
}

function replace(docs, nextDoc) {
    return docs.map(doc => (doc.id === nextDoc.id ? nextDoc : doc));
}

function requireOpen(doc) {
    if (!doc || doc.deleted) throw new Error('找不到這筆品項');
    if (doc.status !== FOLD_STATUS && doc.status !== REWORK_STATUS) throw new Error('這筆已經簽名或送出');
}

export function newSpecialId() {
    return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newEntryId() {
    return `en_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function reworkBadge(doc) {
    if (!doc || doc.status !== REWORK_STATUS) return '';
    const events = doc.history || [];
    const event = [...events].reverse().find(item => item.type === 'rework' && item.round === doc.round)
        || [...events].reverse().find(item => item.type === 'rework');
    return `重工中・第${doc.round}輪・${event?.reason || ''}`;
}

export function signedMark(doc) {
    if (!doc?.foldSignedAt || (doc.status !== SIGNED_STATUS && doc.status !== SENT_STATUS)) return '';
    return `✓ ${formatTaipeiStamp(doc.foldSignedAt)}`;
}

export function reworkHistoryText(doc) {
    return (doc?.history || [])
        .filter(event => event.type === 'rework')
        .map(event => `第${event.round || ''}輪・${event.reason || ''}・${formatTaipeiStamp(event.time)}`)
        .join('\n');
}

export function addParsedEntry(docs, entry, { time, source = 'manual', idFactory, entryId } = {}) {
    if (!entry?.ok) throw new Error(entry?.message || '無法寫入');
    if (!time) throw new Error('缺少寫入時間');
    if (typeof idFactory !== 'function') throw new Error('缺少單號');
    const sharedEntryId = entryId || newEntryId();
    let next = docs.map(clone);
    const upserts = [];
    for (const line of entry.lines) {
        const open = next.filter(doc =>
            !doc.deleted
            && doc.hotel === entry.hotel
            && doc.receivedDate === entry.receivedDate
            && doc.item === line.item
            && (doc.status === FOLD_STATUS || doc.status === REWORK_STATUS));
        const target = open.find(doc => doc.status === FOLD_STATUS) || open[0];
        if (target) {
            const updated = clone(target);
            updated.qty += line.qty;
            updated.unknown = !!(updated.unknown || line.unknown);
            updated.history.push({ type: 'created', time, qty: line.qty, round: updated.round });
            next = replace(next, updated);
            upserts.push(updated);
            continue;
        }
        const created = {
            id: idFactory(),
            hotel: entry.hotel,
            receivedDate: entry.receivedDate,
            item: line.item,
            qty: line.qty,
            source,
            createdAt: time,
            round: 1,
            status: FOLD_STATUS,
            history: [{ type: 'created', time, qty: line.qty, round: 1 }],
            foldSignature: '',
            foldSignedAt: '',
            shipDate: '',
            shipRule: '',
            officeName: line.item,
            officeSignature: '',
            sentAt: '',
            unknown: !!line.unknown,
            entryId: sharedEntryId,
            edits: [],
            deleted: false,
            deletedAt: '',
        };
        next = [...next, created];
        upserts.push(created);
    }
    return { docs: next, upserts };
}

export function signItem(docs, id, { shipQty, signature, reason, shipDate, shipRule, time, idFactory }) {
    const current = docs.find(doc => doc.id === id);
    requireOpen(current);
    const qty = Number(shipQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > current.qty) throw new Error('可出貨數量不正確');
    if (!signature) throw new Error('請先簽名');
    if (!shipDate || !shipRule) throw new Error('出貨單日期還沒算出來');
    if (!time) throw new Error('缺少簽名時間');
    const why = String(reason || '').trim();
    if (qty < current.qty && !why) throw new Error('數量沒有全部出貨，請選擇退回原因');
    const signed = clone(current);
    signed.qty = qty;
    signed.status = SIGNED_STATUS;
    signed.foldSignature = signature;
    signed.foldSignedAt = time;
    signed.shipDate = shipDate;
    signed.shipRule = shipRule;
    signed.officeName = signed.officeName || signed.item;
    if (qty < current.qty) signed.history.push({ type: 'split', time, qty, reason: why, round: current.round });
    signed.history.push({ type: 'signed', time, qty, signature, round: current.round });
    let next = replace(docs.map(clone), signed);
    const upserts = [signed];
    if (qty < current.qty) {
        if (typeof idFactory !== 'function') throw new Error('缺少單號');
        const remainQty = current.qty - qty;
        const remain = clone(current);
        remain.id = idFactory();
        remain.qty = remainQty;
        remain.status = REWORK_STATUS;
        remain.round = current.round + 1;
        remain.foldSignature = '';
        remain.foldSignedAt = '';
        remain.shipDate = '';
        remain.shipRule = '';
        remain.officeName = current.item;
        remain.officeSignature = '';
        remain.sentAt = '';
        remain.history.push({ type: 'split', time, qty: remainQty, reason: why, round: remain.round });
        remain.history.push({ type: 'rework', time, qty: remainQty, reason: why, round: remain.round });
        next = [...next, remain];
        upserts.push(remain);
    }
    return { docs: next, upserts };
}

export function reworkItem(docs, id, { reworkQty, reason, signature, time, idFactory }) {
    const current = docs.find(doc => doc.id === id);
    requireOpen(current);
    const why = String(reason || '').trim();
    if (!why) throw new Error('請選擇退回原因');
    if (!time) throw new Error('缺少時間');
    const qty = Number(reworkQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > current.qty) throw new Error('退回數量不正確');
    if (qty === current.qty) {
        const updated = clone(current);
        updated.status = REWORK_STATUS;
        updated.round = current.round + 1;
        const event = { type: 'rework', time, qty, reason: why, round: updated.round };
        if (signature) event.signature = signature;
        updated.history.push(event);
        return { docs: replace(docs.map(clone), updated), upserts: [updated] };
    }
    if (typeof idFactory !== 'function') throw new Error('缺少單號');
    const stay = clone(current);
    stay.qty = current.qty - qty;
    stay.history.push({ type: 'split', time, qty: stay.qty, reason: why, round: current.round });
    const dirty = clone(current);
    dirty.id = idFactory();
    dirty.qty = qty;
    dirty.status = REWORK_STATUS;
    dirty.round = current.round + 1;
    dirty.foldSignature = '';
    dirty.foldSignedAt = '';
    dirty.shipDate = '';
    dirty.shipRule = '';
    dirty.officeName = current.item;
    dirty.officeSignature = '';
    dirty.sentAt = '';
    dirty.history.push({ type: 'split', time, qty, reason: why, round: dirty.round });
    const event = { type: 'rework', time, qty, reason: why, round: dirty.round };
    if (signature) event.signature = signature;
    dirty.history.push(event);
    return { docs: [...replace(docs.map(clone), stay), dirty], upserts: [stay, dirty] };
}

function liveDoc(docs, id) {
    const current = docs.find(doc => doc.id === id);
    if (!current || current.deleted) throw new Error('找不到這筆品項');
    return current;
}

export function editItem(docs, id, { hotel, item, qty, time, acceptResign } = {}) {
    const current = liveDoc(docs, id);
    if (current.status === SENT_STATUS) throw new Error('已送出，無法修改');
    if (!time) throw new Error('缺少時間');
    const nextHotel = String(hotel ?? '').trim();
    if (!nextHotel) throw new Error('請填飯店');
    const nextItem = displayItemName(item);
    const nextQty = Number(qty);
    if (!Number.isInteger(nextQty) || nextQty < 1) throw new Error('數量不正確');
    if (nextHotel === current.hotel && nextItem === current.item && nextQty === current.qty) {
        return { docs, upserts: [] };
    }
    const signed = current.status === SIGNED_STATUS || !!current.foldSignature;
    if (signed && !acceptResign) {
        const error = new Error('這筆已簽名。修改後要重新簽名');
        error.needsResign = true;
        throw error;
    }
    const next = clone(current);
    const before = { hotel: current.hotel, item: current.item, qty: current.qty };
    const after = { hotel: nextHotel, item: nextItem, qty: nextQty };
    next.hotel = nextHotel;
    next.item = nextItem;
    next.qty = nextQty;
    if (nextItem !== current.item) next.unknown = false;
    next.edits.push({ time, before, after, clearedSignature: signed });
    next.history.push({ type: 'edited', time, qty: nextQty, round: next.round });
    if (signed) {
        next.status = FOLD_STATUS;
        next.foldSignature = '';
        next.foldSignedAt = '';
        next.shipDate = '';
        next.shipRule = '';
        next.officeSignature = '';
        next.sentAt = '';
        next.officeName = nextItem;
    } else if (!next.officeName || next.officeName === current.item || nextItem !== current.item) {
        next.officeName = nextItem;
    }
    return { docs: replace(docs.map(clone), next), upserts: [next] };
}

export function deleteItem(docs, id, { time } = {}) {
    const current = liveDoc(docs, id);
    if (current.status === SENT_STATUS) throw new Error('已送出，無法修改');
    if (!time) throw new Error('缺少時間');
    const next = clone(current);
    next.deleted = true;
    next.deletedAt = time;
    next.history.push({ type: 'deleted', time, qty: next.qty, round: next.round });
    return { docs: replace(docs.map(clone), next), upserts: [next] };
}

export function entryMates(docs, doc) {
    if (!doc?.entryId || doc.deleted) return [];
    const mates = (docs || []).filter(row => row.entryId === doc.entryId && !row.deleted);
    if (mates.some(row => row.status === SENT_STATUS)) return [];
    return mates;
}

export function deleteEntry(docs, entryId, { time } = {}) {
    if (!entryId) throw new Error('這筆不是同一次輸入');
    if (!time) throw new Error('缺少時間');
    const mates = (docs || []).filter(row => row.entryId === entryId && !row.deleted);
    if (!mates.length) throw new Error('找不到這筆品項');
    if (mates.some(row => row.status === SENT_STATUS)) throw new Error('這次輸入有已經送出的品項');
    const upserts = mates.map(doc => {
        const next = clone(doc);
        next.deleted = true;
        next.deletedAt = time;
        next.history.push({ type: 'deleted', time, qty: next.qty, round: next.round });
        return next;
    });
    const byId = new Map(upserts.map(doc => [doc.id, doc]));
    return { docs: docs.map(doc => byId.get(doc.id) || clone(doc)), upserts };
}

export function updateOfficeName(docs, id, name) {
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('出貨品名不可空白');
    const current = liveDoc(docs, id);
    if (current.status !== SIGNED_STATUS) throw new Error('已送出的品名不能再改');
    if (current.officeName === clean) return { docs, upserts: [] };
    const nextDoc = clone(current);
    nextDoc.officeName = clean;
    return { docs: replace(docs, nextDoc), upserts: [nextDoc] };
}

export function sendSheet(docs, ids, { signature, time }) {
    if (!signature) throw new Error('請先簽名');
    if (!time) throw new Error('缺少送出時間');
    const wanted = [...new Set(ids || [])];
    if (!wanted.length) throw new Error('沒有可送出的品項');
    const targets = wanted.map(id => docs.find(doc => doc.id === id));
    if (targets.some(doc => !doc || doc.deleted)) throw new Error('找不到要送出的品項');
    if (targets.some(doc => doc.status !== SIGNED_STATUS)) throw new Error('只有已簽名、尚未送出的品項可以匯入出貨單');
    if (targets.some(doc => !String(doc.officeName || '').trim())) throw new Error('請填寫出貨品名');
    const upserts = targets.map(doc => {
        const next = clone(doc);
        next.status = SENT_STATUS;
        next.officeSignature = signature;
        next.sentAt = time;
        next.history.push({ type: 'sent', time, qty: next.qty, signature, round: next.round });
        return next;
    });
    const byId = new Map(upserts.map(doc => [doc.id, doc]));
    return { docs: docs.map(doc => byId.get(doc.id) || clone(doc)), upserts };
}

export function foldCards(docs, query = '') {
    const needle = String(query || '').trim().toLowerCase();
    const open = (docs || []).filter(doc => !doc.deleted && doc.status !== SENT_STATUS);
    const dates = [...new Set(open.map(doc => doc.receivedDate))].sort((a, b) => b.localeCompare(a));
    const cards = [];
    for (const date of dates) {
        const hotels = [];
        const rows = open
            .filter(doc => doc.receivedDate === date)
            .slice()
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
        for (const row of rows) {
            const hay = `${row.hotel} ${row.item} ${row.officeName || ''}`.toLowerCase();
            if (needle && !hay.includes(needle)) continue;
            let group = hotels.find(hotel => hotel.hotel === row.hotel);
            if (!group) {
                group = { hotel: row.hotel, lines: [] };
                hotels.push(group);
            }
            group.lines.push(row);
        }
        if (hotels.length) cards.push({ date, label: formatMd(date), hotels });
    }
    return cards;
}

export function officeSheets(docs) {
    const groups = new Map();
    for (const row of docs || []) {
        if (row.deleted || (row.status !== SIGNED_STATUS && row.status !== SENT_STATUS)) continue;
        const sent = row.status === SENT_STATUS;
        const key = JSON.stringify([row.hotel, row.shipDate || '', row.shipRule || '', sent ? row.sentAt || '' : 'open']);
        if (!groups.has(key)) {
            groups.set(key, {
                hotel: row.hotel,
                shipDate: row.shipDate || '',
                shipRule: row.shipRule || '',
                sent,
                sentAt: sent ? row.sentAt || '' : '',
                officeSignature: row.officeSignature || '',
                items: [],
            });
        }
        const group = groups.get(key);
        group.items.push(row);
        if (row.officeSignature) group.officeSignature = row.officeSignature;
    }
    return [...groups.values()].sort((a, b) =>
        Number(a.sent) - Number(b.sent)
        || String(a.shipDate).localeCompare(String(b.shipDate))
        || a.hotel.localeCompare(b.hotel, 'zh-Hant'));
}
