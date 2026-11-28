// Pure state changes for one special_items line. The page persists the upserts.

import { displayItemName } from './special-parser.js';
import { computeShipDate } from './special-shipdate.js';
import { formatMd, formatTaipeiStamp, taipeiParts } from './special-time.js';

export const WASH_STATUS = '待洗滌';
export const SPREAD_STATUS = '待撐開';
export const FOLD_STATUS = '待摺疊';
export const REWORK_STATUS = '重工中';
export const SIGNED_STATUS = '已簽名';
export const SENT_STATUS = '已送出';
export const QTY_HOLD_STATUS = '數量不符';

// 床單、被套、枕套 go through 撐開. 枕頭、床包、浴巾 do not.
export function needsSpread(item) {
    const name = String(item || '').normalize('NFKC').replace(/\s+/g, '');
    return /床單|被套|枕套/.test(name);
}

export function slipKey(doc) {
    if (doc?.entryId) return `e:${doc.entryId}`;
    return `h:${doc?.hotel || ''}|${doc?.receivedDate || ''}`;
}

// Wash signs one hotel for one display day. Returned items use the return day;
// everything else uses the original hotel send date. Change this to regroup.
export function washDisplayDate(doc) {
    return doc?.returnDate || doc?.receivedDate || '';
}

export function washGroupKey(doc) {
    return `${doc?.hotel || ''}|${washDisplayDate(doc)}`;
}

// Office signs every ready item of one hotel together. Change this to regroup.
export function officeGroupKey(doc) {
    return String(doc?.hotel || '');
}

export const OFFICE_BLOCK_STATUSES = [WASH_STATUS, SPREAD_STATUS, FOLD_STATUS, REWORK_STATUS, QTY_HOLD_STATUS];

function stageFields(qty) {
    return {
        expectedQty: qty,
        washSignature: '',
        washSignedAt: '',
        spreadSignature: '',
        spreadSignedAt: '',
        discrepancyOpen: false,
        discrepancyAckAt: '',
    };
}

// Old in-flight rows keep their status. Missing stage fields are filled for display only.
// 待摺疊 / 重工中 stay at 摺疊, 已簽名 stays at 辦公室, 已送出 stays written.
export function normalizeInFlight(doc) {
    if (!doc) return doc;
    const qty = Number(doc.qty);
    const expected = Number.isInteger(doc.expectedQty) ? doc.expectedQty : (Number.isInteger(qty) ? qty : 0);
    return {
        ...doc,
        expectedQty: expected,
        washSignature: doc.washSignature || '',
        washSignedAt: doc.washSignedAt || '',
        spreadSignature: doc.spreadSignature || '',
        spreadSignedAt: doc.spreadSignedAt || '',
        discrepancyOpen: !!doc.discrepancyOpen,
        discrepancyAckAt: doc.discrepancyAckAt || '',
        returnDate: doc.returnDate || '',
        returnSignature: doc.returnSignature || '',
        returnSignedAt: doc.returnSignedAt || '',
    };
}

export function departmentReadPlan(dept) {
    if (dept === 'wash') return { statuses: [WASH_STATUS], discrepancy: false, sentByShipDate: false };
    if (dept === 'spread') return { statuses: [SPREAD_STATUS], discrepancy: false, sentByShipDate: false };
    if (dept === 'fold') return { statuses: [FOLD_STATUS, REWORK_STATUS], discrepancy: false, sentByShipDate: false };
    if (dept === 'office') return { statuses: [SIGNED_STATUS], upstream: OFFICE_BLOCK_STATUSES, discrepancy: true, sentByShipDate: true };
    return { statuses: [], discrepancy: false, sentByShipDate: false };
}

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
            && doc.status === WASH_STATUS);
        const target = open[0];
        if (target) {
            const updated = clone(target);
            updated.qty += line.qty;
            updated.expectedQty = (Number.isInteger(updated.expectedQty) ? updated.expectedQty : target.qty) + line.qty;
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
            status: WASH_STATUS,
            history: [{ type: 'created', time, qty: line.qty, round: 1 }],
            ...stageFields(line.qty),
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

function isOpenStatus(doc) {
    return !!doc && !doc.deleted && (doc.status === FOLD_STATUS || doc.status === REWORK_STATUS);
}

export function splitChildren(docs, doc) {
    if (!doc || doc.deleted || doc.status !== SIGNED_STATUS) return [];
    const linked = (docs || []).filter(row => row.splitOf === doc.id && isOpenStatus(row));
    if (linked.length) return linked;
    const signedAt = doc.foldSignedAt;
    if (!signedAt) return [];
    return (docs || []).filter(row =>
        isOpenStatus(row)
        && row.id !== doc.id
        && !row.splitOf
        && row.hotel === doc.hotel
        && row.item === doc.item
        && row.receivedDate === doc.receivedDate
        && (row.history || []).some(event => event.type === 'split' && event.time === signedAt));
}

export function signPoolQty(docs, doc) {
    if (!doc) return 0;
    if (doc.status !== SIGNED_STATUS) return Number(doc.qty) || 0;
    return Number(doc.qty) + splitChildren(docs, doc).reduce((sum, row) => sum + Number(row.qty || 0), 0);
}

function markDeleted(doc, time) {
    const next = clone(doc);
    next.deleted = true;
    next.deletedAt = time;
    next.history.push({ type: 'deleted', time, qty: next.qty, round: next.round });
    next.edits.push({
        time,
        before: { hotel: doc.hotel, item: doc.item, qty: doc.qty },
        after: { hotel: doc.hotel, item: doc.item, qty: doc.qty },
        clearedSignature: false,
        deleted: true,
    });
    return next;
}

function routeReworkToWash(next, time, signature = '') {
    next.status = WASH_STATUS;
    next.expectedQty = next.qty;
    next.returnDate = taipeiParts(time).date;
    next.returnSignature = signature;
    next.returnSignedAt = time;
    next.washSignature = '';
    next.washSignedAt = '';
    next.spreadSignature = '';
    next.spreadSignedAt = '';
    next.foldedQty = null;
    next.officeReceived = null;
    next.officeCheckedAt = '';
    next.officeQtyFlag = false;
    next.discrepancyOpen = false;
    next.discrepancyAckAt = '';
    const reason = [...next.history].reverse().find(event => event.type === 'rework')?.reason || '';
    next.history.push({ type: 'return-wash', time, qty: next.qty, reason, signature, round: next.round });
    return next;
}

function reworkRemainder(source, { id, qty, reason, time, parentId, round }) {
    const remain = clone(source);
    if (id) remain.id = id;
    remain.qty = qty;
    remain.status = REWORK_STATUS;
    remain.round = round || (Number(source.round) || 1) + 1;
    remain.splitOf = parentId;
    remain.foldSignature = '';
    remain.foldSignedAt = '';
    remain.foldedQty = null;
    remain.shipDate = '';
    remain.shipRule = '';
    remain.officeName = source.item;
    remain.officeSignature = '';
    remain.sentAt = '';
    remain.deleted = false;
    remain.deletedAt = '';
    remain.history.push({ type: 'split', time, qty, reason, round: remain.round });
    remain.history.push({ type: 'rework', time, qty, reason, round: remain.round });
    return routeReworkToWash(remain, time);
}

export function signItem(docs, id, { shipQty, signature, reason, shipDate, shipRule, time, idFactory }) {
    const current = docs.find(doc => doc.id === id);
    if (!current || current.deleted) throw new Error('找不到這筆品項');
    if (current.status === SENT_STATUS) throw new Error('已送出，無法修改');
    const resigning = current.status === SIGNED_STATUS;
    if (!resigning && current.status !== FOLD_STATUS && current.status !== REWORK_STATUS) throw new Error('這筆已經簽名或送出');
    const children = resigning ? splitChildren(docs, current) : [];
    const pool = resigning ? signPoolQty(docs, current) : current.qty;
    const qty = Number(shipQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > pool) throw new Error('可出貨數量不正確');
    if (!signature) throw new Error('請先簽名');
    if (!time) throw new Error('缺少簽名時間');
    const why = String(reason || '').trim();
    if (qty < pool && !why) throw new Error('數量沒有全部出貨，請選擇退回原因');
    const signed = clone(current);
    if (resigning) {
        signed.edits.push({
            time,
            before: {
                hotel: current.hotel,
                item: current.item,
                qty: current.qty,
                foldSignedAt: current.foldSignedAt || '',
                foldSignature: current.foldSignature || '',
            },
            after: {
                hotel: current.hotel,
                item: current.item,
                qty,
                foldSignedAt: time,
                foldSignature: signature,
            },
            clearedSignature: false,
        });
        signed.history.push({
            type: 'resigned',
            time,
            qty,
            previousQty: current.qty,
            previousSignedAt: current.foldSignedAt || '',
            round: current.round,
        });
    }
    signed.qty = qty;
    signed.foldedQty = qty;
    signed.status = SIGNED_STATUS;
    signed.foldSignature = signature;
    signed.foldSignedAt = time;
    signed.shipDate = shipDate || '';
    signed.shipRule = shipRule || '';
    signed.officeName = signed.officeName || signed.item;
    if (qty < pool) signed.history.push({ type: 'split', time, qty, reason: why, round: current.round });
    signed.history.push({ type: 'signed', time, qty, signature, round: current.round });
    let next = replace(docs.map(clone), signed);
    const upserts = [signed];
    const remainQty = pool - qty;
    if (!resigning) {
        if (remainQty > 0) {
            if (typeof idFactory !== 'function') throw new Error('缺少單號');
            const remain = reworkRemainder(current, { id: idFactory(), qty: remainQty, reason: why, time, parentId: current.id });
            next = [...next, remain];
            upserts.push(remain);
        }
        return { docs: next, upserts };
    }
    if (remainQty === 0) {
        for (const child of children) {
            const gone = markDeleted(child, time);
            next = replace(next, gone);
            upserts.push(gone);
        }
        return { docs: next, upserts };
    }
    if (children.length) {
        const [keep, ...rest] = children;
        const remain = reworkRemainder(keep, {
            qty: remainQty,
            reason: why,
            time,
            parentId: current.id,
            round: Math.max(Number(keep.round) || 1, current.round + 1),
        });
        next = replace(next, remain);
        upserts.push(remain);
        for (const extra of rest) {
            const gone = markDeleted(extra, time);
            next = replace(next, gone);
            upserts.push(gone);
        }
        return { docs: next, upserts };
    }
    if (typeof idFactory !== 'function') throw new Error('缺少單號');
    const remain = reworkRemainder(current, { id: idFactory(), qty: remainQty, reason: why, time, parentId: current.id });
    next = [...next, remain];
    upserts.push(remain);
    return { docs: next, upserts };
}

export function reworkItem(docs, id, { reworkQty, reason, signature, time, idFactory }) {
    const current = liveDoc(docs, id);
    if (![FOLD_STATUS, REWORK_STATUS, SIGNED_STATUS].includes(current.status)) throw new Error('已送出，無法退回重工');
    const why = String(reason || '').trim();
    if (!why) throw new Error('請選擇退回原因');
    if (!time) throw new Error('缺少時間');
    const qty = Number(reworkQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > current.qty) throw new Error('退回數量不正確');
    if (qty === current.qty) {
        const updated = clone(current);
        updated.status = REWORK_STATUS;
        updated.foldSignature = '';
        updated.foldSignedAt = '';
        updated.shipDate = '';
        updated.shipRule = '';
        updated.officeSignature = '';
        updated.sentAt = '';
        updated.round = current.round + 1;
        const event = { type: 'rework', time, qty, reason: why, round: updated.round };
        if (signature) event.signature = signature;
        updated.history.push(event);
        routeReworkToWash(updated, time, signature);
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
    dirty.splitOf = current.id;
    routeReworkToWash(dirty, time, signature);
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

export function deleteItem(docs, id, { time, allowSent } = {}) {
    const current = liveDoc(docs, id);
    if (current.status === SENT_STATUS && !allowSent) throw new Error('已送出，無法修改');
    if (!time) throw new Error('缺少時間');
    const next = markDeleted(current, time);
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

export function foldedHandedQty(doc) {
    if (Number.isInteger(doc?.foldedQty)) return doc.foldedQty;
    return Number(doc?.qty);
}

export function officeReceivedQty(doc, received = {}) {
    if (doc && Object.prototype.hasOwnProperty.call(received, doc.id)) return Number(received[doc.id]);
    if (Number.isInteger(doc?.officeReceived)) return doc.officeReceived;
    return foldedHandedQty(doc);
}

export function officeSendBlockers(docs, ids, received = {}) {
    const blockers = [];
    const wanted = [...new Set(ids || [])];
    if (!wanted.length) {
        blockers.push({ code: 'empty', message: '沒有可送出的品項' });
        return blockers;
    }
    const targets = wanted.map(id => (docs || []).find(doc => doc.id === id));
    if (targets.some(doc => !doc || doc.deleted)) {
        blockers.push({ code: 'missing', message: '找不到要送出的品項' });
        return blockers;
    }
    if (targets.some(doc => doc.status !== SIGNED_STATUS)) {
        blockers.push({ code: 'status', message: '只有摺疊完成、辦公室還沒送出的品項可以送出' });
        return blockers;
    }
    if (targets.some(doc => !String(doc.officeName || '').trim())) {
        blockers.push({ code: 'name', message: '請填寫出貨品名' });
    }
    const hotel = officeGroupKey(targets[0]);
    if (targets.some(doc => officeGroupKey(doc) !== hotel)) {
        blockers.push({ code: 'hotel', message: '一次只能送出同一家飯店' });
        return blockers;
    }
    for (const doc of targets) {
        const got = officeReceivedQty(doc, received);
        if (!Number.isInteger(got) || got < 0) blockers.push({ code: 'qty', message: `${doc.item} 的實收數量不正確`, id: doc.id });
    }
    return blockers;
}

// Outstanding work is shown beside the hotel/send date. It never blocks 送出.
export function officeOutstanding(docs, hotel, receivedDate) {
    return (docs || []).filter(doc => !doc.deleted && doc.hotel === hotel && (!receivedDate || doc.receivedDate === receivedDate) && OFFICE_BLOCK_STATUSES.includes(doc.status));
}

export function officeQtyFlags(docs, ids, received = {}) {
    const flags = [];
    for (const id of ids || []) {
        const doc = (docs || []).find(row => row.id === id);
        if (!doc) continue;
        const folded = foldedHandedQty(doc);
        const got = officeReceivedQty(doc, received);
        if (!Number.isInteger(got) || got === folded) continue;
        flags.push({ code: 'qty', id, folded, got, message: `${doc.item} 摺疊送出 ${folded}，辦公室實收 ${got}` });
    }
    return flags;
}

export function sendSheet(docs, ids, { signature, time, schedules, received } = {}) {
    if (!signature) throw new Error('請先簽名');
    if (!time) throw new Error('缺少送出時間');
    const blockers = officeSendBlockers(docs, ids, received);
    if (blockers.length) {
        const error = new Error(blockers.map(item => item.message).join('；'));
        error.blockers = blockers;
        throw error;
    }
    const wanted = [...new Set(ids || [])];
    const targets = wanted.map(id => docs.find(doc => doc.id === id));
    const upserts = targets.map(doc => {
        const next = clone(doc);
        if (schedules !== undefined) {
            const { shipDate, shipRule } = computeShipDate(doc.hotel, taipeiParts(time).date, schedules);
            next.shipDate = shipDate;
            next.shipRule = shipRule;
        }
        const handed = foldedHandedQty(doc);
        const got = officeReceivedQty(doc, received);
        next.foldedQty = handed;
        next.officeReceived = got;
        next.officeCheckedAt = time;
        if (got !== handed) {
            next.officeQtyFlag = true;
            next.history.push({ type: 'office-qty', time, qty: got, previousQty: handed, signature, round: next.round || 1 });
            next.qty = got;
        }
        next.status = SENT_STATUS;
        next.officeSignature = signature;
        next.sentAt = time;
        next.history.push({ type: 'sent', time, qty: next.qty, signature, round: next.round });
        return next;
    });
    const byId = new Map(upserts.map(doc => [doc.id, doc]));
    return { docs: docs.map(doc => byId.get(doc.id) || clone(doc)), upserts };
}

export function signWashBatch(docs, ids, { signature, time, actuals = {} } = {}) {
    if (!signature) throw new Error('請先簽名');
    if (!time) throw new Error('缺少簽名時間');
    const wanted = [...new Set(ids || [])];
    if (!wanted.length) throw new Error('沒有可簽收的品項');
    const targets = wanted.map(id => {
        const doc = (docs || []).find(row => row.id === id);
        if (!doc || doc.deleted) throw new Error('找不到這筆品項');
        if (doc.status !== WASH_STATUS) throw new Error('這張單已經洗滌簽收');
        return doc;
    });
    const key = washGroupKey(targets[0]);
    if (targets.some(doc => washGroupKey(doc) !== key)) throw new Error('請一次簽同一家飯店、同一個日期的品項');
    const mates = (docs || []).filter(doc => !doc.deleted && doc.status === WASH_STATUS && washGroupKey(doc) === key);
    if (mates.length !== targets.length || mates.some(doc => !wanted.includes(doc.id))) {
        throw new Error('這間飯店這個日期的品項要一起簽名');
    }
    const upserts = targets.map(doc => {
        const expectedQty = Number.isInteger(doc.expectedQty) ? doc.expectedQty : Number(doc.qty);
        const raw = Object.prototype.hasOwnProperty.call(actuals, doc.id) ? actuals[doc.id] : doc.qty;
        const actual = Number(raw);
        if (!Number.isInteger(actual) || actual < 0) throw new Error('實點數量不正確');
        const next = clone(doc);
        next.expectedQty = expectedQty;
        next.qty = actual;
        next.washSignature = signature;
        next.washSignedAt = time;
        const mismatch = actual !== expectedQty;
        next.discrepancyOpen = mismatch;
        if (mismatch) next.discrepancyAckAt = '';
        next.status = actual < 1 ? QTY_HOLD_STATUS : (needsSpread(next.item) ? SPREAD_STATUS : FOLD_STATUS);
        const event = { type: 'washed', time, qty: actual, signature, round: next.round || 1 };
        if (mismatch) event.reason = `對點 ${expectedQty}，實點 ${actual}`;
        next.history.push(event);
        return next;
    });
    const byId = new Map(upserts.map(doc => [doc.id, doc]));
    return { docs: (docs || []).map(doc => byId.get(doc.id) || clone(doc)), upserts };
}

const RETURNABLE = new Set([SPREAD_STATUS, FOLD_STATUS, REWORK_STATUS]);

function splitExpected(source, keptQty, returnedQty) {
    const expected = Number.isInteger(source.expectedQty) ? source.expectedQty : source.qty;
    if (expected === source.qty) return { stay: keptQty, back: returnedQty };
    return { stay: expected, back: returnedQty };
}

export function returnWashHistory(doc) {
    return (doc?.history || []).filter(event => event.type === 'return-wash');
}

export function reworkNote(doc) {
    const events = returnWashHistory(doc);
    if (!events.length && !doc?.returnDate) return '';
    const last = events[events.length - 1];
    const bits = [`重工 ${events.length || 1} 次`];
    if (doc?.returnDate) bits.push(`退回 ${formatMd(doc.returnDate)}`);
    if (last?.reason) bits.push(last.reason);
    return bits.join('・');
}

export function returnToWash(docs, id, { qty, reason, signature, time, idFactory, returnDate } = {}) {
    const current = liveDoc(docs, id);
    if (!RETURNABLE.has(current.status)) throw new Error('只有撐開或摺疊中的品項可以退回洗滌');
    if (current.status === SENT_STATUS) throw new Error('已送出，無法修改');
    if (!time) throw new Error('缺少時間');
    const count = Number(qty ?? current.qty);
    if (!Number.isInteger(count) || count < 1 || count > Number(current.qty)) throw new Error('退回數量不正確');
    const why = String(reason || '').trim();
    const backDate = returnDate || taipeiParts(time).date;
    const round = (Number(current.round) || 1) + 1;
    const asReturned = (source, returnedQty, newId) => {
        const next = clone(source);
        if (newId) {
            next.id = newId;
            next.splitOf = source.id;
        }
        next.qty = returnedQty;
        next.expectedQty = returnedQty;
        next.status = WASH_STATUS;
        next.round = round;
        next.returnDate = backDate;
        next.returnSignature = signature || '';
        next.returnSignedAt = time;
        next.washSignature = '';
        next.washSignedAt = '';
        next.spreadSignature = '';
        next.spreadSignedAt = '';
        next.foldSignature = '';
        next.foldSignedAt = '';
        next.foldedQty = null;
        next.shipDate = '';
        next.shipRule = '';
        next.officeSignature = '';
        next.sentAt = '';
        next.officeReceived = '';
        next.discrepancyOpen = false;
        next.discrepancyAckAt = '';
        const event = { type: 'return-wash', time, qty: returnedQty, round };
        if (why) event.reason = why;
        if (signature) event.signature = signature;
        next.history.push(event);
        return next;
    };
    if (count === Number(current.qty)) {
        const next = asReturned(current, count);
        return { docs: replace(docs.map(clone), next), upserts: [next] };
    }
    if (typeof idFactory !== 'function') throw new Error('缺少單號');
    const expected = splitExpected(current, Number(current.qty) - count, count);
    const stay = clone(current);
    stay.qty = Number(current.qty) - count;
    stay.expectedQty = expected.stay;
    stay.history.push({ type: 'split', time, qty: stay.qty, reason: why || '退回洗滌', round: current.round });
    const returned = asReturned(current, count, idFactory());
    return { docs: [...replace(docs.map(clone), stay), returned], upserts: [stay, returned] };
}

export function signSpreadItem(docs, id, { signature, time } = {}) {
    const current = liveDoc(docs, id);
    if (current.status !== SPREAD_STATUS) throw new Error('這筆不在撐開');
    if (!signature) throw new Error('請先簽名');
    if (!time) throw new Error('缺少簽名時間');
    const next = clone(current);
    next.status = FOLD_STATUS;
    next.spreadSignature = signature;
    next.spreadSignedAt = time;
    next.history.push({ type: 'spread', time, qty: next.qty, signature, round: next.round || 1 });
    return { docs: replace(docs.map(clone), next), upserts: [next] };
}

export function ackDiscrepancy(docs, id, { time } = {}) {
    const current = liveDoc(docs, id);
    if (!current.discrepancyOpen) return { docs, upserts: [] };
    if (!time) throw new Error('缺少時間');
    const next = clone(current);
    next.discrepancyOpen = false;
    next.discrepancyAckAt = time;
    next.history.push({
        type: 'discrepancy-ack',
        time,
        qty: next.qty,
        round: next.round || 1,
        reason: `對點 ${next.expectedQty}，實點 ${next.qty}`,
    });
    return { docs: replace(docs.map(clone), next), upserts: [next] };
}

export function openDiscrepancies(docs) {
    return (docs || [])
        .filter(doc => !doc.deleted && doc.discrepancyOpen)
        .sort((a, b) => String(b.washSignedAt || b.createdAt || '').localeCompare(String(a.washSignedAt || a.createdAt || '')) || a.id.localeCompare(b.id));
}

export function itemWhere(doc) {
    const map = {
        [WASH_STATUS]: '洗滌',
        [SPREAD_STATUS]: '撐開',
        [FOLD_STATUS]: '摺疊',
        [REWORK_STATUS]: '摺疊',
        [SIGNED_STATUS]: '辦公室',
        [SENT_STATUS]: '已寫入盤點',
        [QTY_HOLD_STATUS]: '辦公室（數量不符）',
    };
    return map[doc?.status] || doc?.status || '';
}

export function itemTrail(doc) {
    const steps = [];
    const legacy = !doc?.washSignedAt && [FOLD_STATUS, REWORK_STATUS, SIGNED_STATUS, SENT_STATUS].includes(doc?.status);
    if (legacy) steps.push('改版前就在作業中');
    if (doc?.washSignedAt) steps.push(`洗滌 ${formatTaipeiStamp(doc.washSignedAt)}`);
    if (doc?.spreadSignedAt) steps.push(`撐開 ${formatTaipeiStamp(doc.spreadSignedAt)}`);
    if (doc?.foldSignedAt) steps.push(`摺疊 ${formatTaipeiStamp(doc.foldSignedAt)}`);
    if (doc?.sentAt) steps.push(`辦公室 ${formatTaipeiStamp(doc.sentAt)}`);
    return { where: itemWhere(doc), steps, legacy };
}

function templateRanks({ hotels = [], catalog = new Map() } = {}) {
    const hotelRanks = new Map(hotels.map((hotel, index) => [hotel, index]));
    const itemRanks = new Map([...catalog].map(([hotel, entry]) => [hotel, new Map(entry.names.map((name, index) => [name, index]))]));
    return {
        hotel: (name) => hotelRanks.get(name) ?? Number.MAX_SAFE_INTEGER,
        item: (row) => itemRanks.get(row.hotel)?.get(row.officeName || row.item) ?? itemRanks.get(row.hotel)?.get(row.item) ?? Number.MAX_SAFE_INTEGER,
    };
}

function queueCards(docs, statuses, query = '', order = {}) {
    const ranks = templateRanks(order);
    const allowed = new Set(statuses);
    const normalizeSearch = value => String(value || '').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
    const needle = normalizeSearch(query);
    const open = (docs || []).filter(doc => !doc.deleted && allowed.has(doc.status));
    const dates = [...new Set(open.map(doc => doc.receivedDate))].sort((a, b) => b.localeCompare(a));
    const cards = [];
    for (const date of dates) {
        const hotels = [];
        const rows = open
            .filter(doc => doc.receivedDate === date)
            .slice()
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
        for (const row of rows) {
            const hay = normalizeSearch(`${row.hotel} ${row.item} ${row.officeName || ''}`);
            if (needle && !hay.includes(needle)) continue;
            let group = hotels.find(hotel => hotel.hotel === row.hotel);
            if (!group) {
                group = { hotel: row.hotel, lines: [] };
                hotels.push(group);
            }
            group.lines.push(row);
        }
        hotels.sort((a, b) => ranks.hotel(a.hotel) - ranks.hotel(b.hotel));
        for (const group of hotels) group.lines.sort((a, b) => ranks.item(a) - ranks.item(b));
        if (hotels.length) cards.push({ date, label: formatMd(date), hotels });
    }
    return cards;
}

export function foldCards(docs, query = '', order = {}) {
    return queueCards(docs, [FOLD_STATUS, REWORK_STATUS], query, order);
}

export function spreadCards(docs, query = '', order = {}) {
    return queueCards(docs, [SPREAD_STATUS], query, order);
}

export function washSlips(docs, query = '', order = {}) {
    const ranks = templateRanks(order);
    const normalizeSearch = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    const needle = normalizeSearch(query);
    const pending = (docs || []).filter(doc => !doc.deleted && doc.status === WASH_STATUS);
    const dates = [...new Set(pending.map(doc => washDisplayDate(doc)))].sort((a, b) => b.localeCompare(a));
    const cards = [];
    for (const date of dates) {
        const rows = pending.filter(doc => washDisplayDate(doc) === date);
        const slips = [];
        for (const row of rows) {
            const key = washGroupKey(row);
            let slip = slips.find(item => item.key === key);
            if (!slip) {
                slip = { key, hotel: row.hotel, lines: [], returned: !!row.returnDate };
                slips.push(slip);
            }
            if (row.returnDate) slip.returned = true;
            slip.lines.push(row);
        }
        const visible = [];
        for (const slip of slips) {
            const hay = normalizeSearch(`${slip.hotel} ${slip.lines.map(line => `${line.item} ${line.officeName || ''}`).join(' ')}`);
            if (needle && !hay.includes(needle)) continue;
            slip.lines.sort((a, b) => ranks.item(a) - ranks.item(b) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
            visible.push(slip);
        }
        visible.sort((a, b) => ranks.hotel(a.hotel) - ranks.hotel(b.hotel) || a.hotel.localeCompare(b.hotel, 'zh-Hant'));
        if (visible.length) cards.push({ date, label: formatMd(date), returned: visible.some(slip => slip.returned), slips: visible });
    }
    return cards;
}

export function demoDepartmentDocs() {
    const created = '2026-11-22T01:00:00.000Z';
    const washTime = '2026-11-22T02:10:00.000Z';
    const spreadTime = '2026-11-22T04:20:00.000Z';
    const foldTime = '2026-11-22T06:40:00.000Z';
    const officeTime = '2026-11-21T03:00:00.000Z';
    const demoSign = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><path d="M6 32 C28 6 48 42 150 14" fill="none" stroke="#123" stroke-width="3"/></svg>')}`;
    const row = (fields) => ({
        round: 1,
        history: [{ type: 'created', time: created, qty: fields.qty, round: 1 }],
        source: '簽收單',
        createdAt: created,
        foldSignature: '',
        foldSignedAt: '',
        shipDate: '',
        shipRule: '',
        officeSignature: '',
        sentAt: '',
        unknown: false,
        splitOf: '',
        deleted: false,
        deletedAt: '',
        edits: [],
        washSignature: '',
        washSignedAt: '',
        spreadSignature: '',
        spreadSignedAt: '',
        discrepancyOpen: false,
        discrepancyAckAt: '',
        ...fields,
        officeName: fields.officeName || fields.item,
        expectedQty: fields.expectedQty ?? fields.qty,
    });
    return [
        row({ id: 'w1', hotel: '驛館', receivedDate: '2026-11-23', item: '特處床單', qty: 4, status: WASH_STATUS, entryId: 'en_demo_yi' }),
        row({ id: 'w2', hotel: '驛館', receivedDate: '2026-11-23', item: '特處被套', qty: 2, status: WASH_STATUS, entryId: 'en_demo_yi' }),
        row({ id: 'w3', hotel: '驛館', receivedDate: '2026-11-23', item: '特處枕套', qty: 6, status: WASH_STATUS, entryId: 'en_demo_yi' }),
        row({ id: 'w4', hotel: '驛館', receivedDate: '2026-11-23', item: '特處浴巾', qty: 3, status: WASH_STATUS, entryId: 'en_demo_yi' }),
        row({ id: 's1', hotel: '巨蛋', receivedDate: '2026-11-22', item: '特處床單', qty: 2, status: SPREAD_STATUS, entryId: 'en_demo_egg', washSignature: demoSign, washSignedAt: washTime }),
        row({ id: 's2', hotel: '巨蛋', receivedDate: '2026-11-22', item: '特處枕套', qty: 1, status: SPREAD_STATUS, entryId: 'en_demo_egg', washSignature: demoSign, washSignedAt: washTime }),
        row({ id: 'f1', hotel: '巨蛋', receivedDate: '2026-11-22', item: '特處浴巾', qty: 3, status: FOLD_STATUS, entryId: 'en_demo_egg', washSignature: demoSign, washSignedAt: washTime }),
        row({ id: 'f2', hotel: '好六', receivedDate: '2026-11-22', item: '特處被套', qty: 1, status: FOLD_STATUS, entryId: 'en_demo_hao', washSignature: demoSign, washSignedAt: washTime, spreadSignature: demoSign, spreadSignedAt: spreadTime }),
        row({
            id: 'f3', hotel: '文七', receivedDate: '2026-11-21', item: '特處毛巾', qty: 2, status: REWORK_STATUS, entryId: 'en_demo_old', round: 2,
            history: [{ type: 'rework', time: '2026-11-21T08:00:00.000Z', qty: 2, reason: '髒污', round: 2 }],
        }),
        row({ id: 'o1', hotel: '鉑麗', receivedDate: '2026-11-21', item: '特處枕頭', qty: 2, foldedQty: 2, status: SIGNED_STATUS, entryId: 'en_demo_bo', washSignature: demoSign, washSignedAt: washTime, foldSignature: demoSign, foldSignedAt: foldTime }),
        row({ id: 'o2', hotel: '巨蛋', receivedDate: '2026-11-22', item: '特處浴袍', qty: 1, foldedQty: 1, status: SIGNED_STATUS, entryId: 'en_demo_egg', washSignature: demoSign, washSignedAt: washTime, foldSignature: demoSign, foldSignedAt: foldTime }),
        row({
            id: 'rw1', hotel: '好六', receivedDate: '2026-11-20', returnDate: '2026-11-23', item: '特處床單', qty: 1, status: WASH_STATUS, entryId: 'en_demo_back', round: 2,
            returnSignedAt: '2026-11-23T01:00:00.000Z',
            history: [
                { type: 'created', time: created, qty: 2, round: 1 },
                { type: 'return-wash', time: '2026-11-23T01:00:00.000Z', qty: 1, reason: '髒污', round: 2 },
            ],
        }),
        row({
            id: 'd1', hotel: '驛館', receivedDate: '2026-11-22', item: '特處浴巾', qty: 3, expectedQty: 5, status: FOLD_STATUS, entryId: 'en_demo_bad',
            washSignature: demoSign, washSignedAt: washTime, discrepancyOpen: true,
            history: [{ type: 'washed', time: washTime, qty: 3, reason: '對點 5，實點 3', round: 1 }],
        }),
        row({
            id: 'sent1', hotel: '捷站前', receivedDate: '2026-11-20', item: '特處方巾', qty: 4, foldedQty: 5, officeReceived: 4, officeQtyFlag: true, status: SENT_STATUS, entryId: 'en_demo_sent',
            washSignature: demoSign, washSignedAt: washTime, foldSignature: demoSign, foldSignedAt: foldTime,
            officeSignature: demoSign, sentAt: officeTime, shipDate: '2026-11-24',
            shipRule: '收送日設定・特處・收件後的下一個收送日',
            history: [
                { type: 'created', time: created, qty: 5, round: 1 },
                { type: 'office-qty', time: officeTime, qty: 4, previousQty: 5, signature: demoSign, round: 1 },
                { type: 'sent', time: officeTime, qty: 4, signature: demoSign, round: 1 },
            ],
        }),
    ];
}

export function officeSheets(docs, order = {}) {
    const ranks = templateRanks(order);
    const groups = new Map();
    for (const row of docs || []) {
        if (row.deleted || (row.status !== SIGNED_STATUS && row.status !== SENT_STATUS)) continue;
        const sent = row.status === SENT_STATUS;
        const key = JSON.stringify([row.hotel, sent ? row.shipDate || '' : '', sent ? row.shipRule || '' : '', sent ? row.sentAt || '' : 'open']);
        if (!groups.has(key)) {
            groups.set(key, {
                hotel: row.hotel,
                shipDate: sent ? row.shipDate || '' : '',
                shipRule: sent ? row.shipRule || '' : '',
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
    for (const group of groups.values()) {
        group.items.sort((a, b) => String(b.receivedDate || '').localeCompare(String(a.receivedDate || '')) || ranks.item(a) - ranks.item(b) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
        const byDate = [];
        for (const item of group.items) {
            let bucket = byDate.find(entry => entry.date === (item.receivedDate || ''));
            if (!bucket) {
                bucket = { date: item.receivedDate || '', items: [] };
                byDate.push(bucket);
            }
            bucket.items.push(item);
        }
        group.byDate = byDate;
        if (!group.sent) {
            group.waiting = (docs || []).filter(doc => !doc.deleted && officeGroupKey(doc) === group.hotel && OFFICE_BLOCK_STATUSES.includes(doc.status));
            group.blockers = officeSendBlockers(docs, group.items.map(item => item.id));
        } else {
            group.waiting = [];
            group.blockers = [];
        }
    }
    return [...groups.values()].sort((a, b) =>
        Number(a.sent) - Number(b.sent)
        || String(a.shipDate).localeCompare(String(b.shipDate))
        || ranks.hotel(a.hotel) - ranks.hotel(b.hotel)
        || a.hotel.localeCompare(b.hotel, 'zh-Hant'));
}

// Keep a matching sheet intact: the office confirmation must still cover every item.
export function searchableOfficeSheets(sheets, query = '') {
    const norm = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    const needle = norm(query);
    return sheets.map((sheet, index) => ({sheet, index})).filter(({sheet}) =>
        !needle || norm([sheet.hotel, ...(sheet.items || []).flatMap(item => [item.item, item.officeName])].join(' ')).includes(needle));
}


