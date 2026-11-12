import { cleanDescription, quoteInvoice } from './einvoice-amount.js';
import {
    buildEnvelope,
    cancelInvoicePayload,
    hostForEnv,
    isDuplicate,
    isUncertain,
    issuedFrom,
    normalizeCreds,
    openInvoicePayload,
    orderIdFor,
    parseResponse,
    publicResponse,
    queryInvoicePayload,
    taipeiDateTime,
    ymdCompact,
} from './einvoice-client.js';

const LOCK_MS = 120000;

function caseRef(db, id) {
    return db.collection('statement_cases').doc(id);
}

function latestOf(doc) {
    const versions = doc?.versions || [];
    return versions.find(version => Number(version.version) === Number(doc.latestVersion)) || versions[versions.length - 1] || null;
}

function invoiceNumberOf(doc) {
    return String(doc?.invoiceNumber || doc?.invoiceRecord?.number || '').trim();
}

function lockHeld(lock, actor, now) {
    if (!lock?.at) return false;
    const at = Date.parse(lock.at);
    if (!Number.isFinite(at) || Date.parse(now) - at >= LOCK_MS) return false;
    return lock.uid !== actor;
}

function assertCase(data, version) {
    if (!data) throw new Error('找不到這份帳單，請重新整理。');
    if (Number(data.latestVersion) !== Number(version)) throw new Error('帳單已有新版本，請重新整理後再開發票。');
    const latest = latestOf(data);
    if (!latest?.snapshot) throw new Error('找不到這一版的帳單內容。');
    return latest;
}

export function markInvoiced(doc, patch) {
    const next = JSON.parse(JSON.stringify(doc));
    next.invoiceStatus = 'invoiced';
    next.invoicedVersion = patch.version;
    next.invoiceNumber = patch.invoiceNumber;
    next.invoiceDate = patch.invoiceDate;
    next.provider = 'universalec';
    next.invoiceKind = patch.kind;
    next.invoiceBuyerId = patch.buyerId;
    next.invoiceBuyerName = patch.buyerName;
    next.invoiceDescription = patch.description || '';
    next.invoiceOrderId = patch.orderID || null;
    next.invoiceRaw = patch.raw;
    next.invoiceRecord = {
        number: patch.invoiceNumber,
        method: 'electronic',
        date: patch.invoiceDate,
        amount: patch.total,
        version: patch.version,
        at: patch.at,
        provider: 'universalec',
        randomNumber: patch.randomNumber || '',
        orderID: patch.orderID || '',
    };
    next.invoiceDraft = null;
    next.invoiceLock = null;
    next.updatedAt = patch.at;
    const version = (next.versions || []).find(item => Number(item.version) === Number(patch.version));
    if (version) {
        version.invoiceNumber = patch.invoiceNumber;
        version.invoiceDate = patch.invoiceDate;
        version.provider = 'universalec';
        version.invoiceRaw = patch.raw;
    }
    return next;
}

export function markVoided(doc, patch) {
    const next = JSON.parse(JSON.stringify(doc));
    const history = Array.isArray(next.invoiceHistory) ? next.invoiceHistory : [];
    history.push({
        number: invoiceNumberOf(doc),
        date: doc.invoiceDate || '',
        reason: patch.reason,
        at: patch.at,
        provider: 'universalec',
        kind: doc.invoiceKind || '',
        orderID: doc.invoiceOrderId || '',
        raw: patch.raw,
    });
    next.invoiceHistory = history;
    next.invoiceStatus = next.state === 'sent' ? 'ready' : 'none';
    next.invoicedVersion = null;
    next.invoiceNumber = null;
    next.invoiceDate = null;
    next.provider = null;
    next.invoiceKind = null;
    next.invoiceBuyerId = null;
    next.invoiceBuyerName = null;
    next.invoiceOrderId = null;
    next.invoiceRaw = null;
    next.invoiceRecord = null;
    next.invoiceDraft = null;
    next.invoiceLock = null;
    next.updatedAt = patch.at;
    for (const version of next.versions || []) {
        if (version.invoiceNumber === history[history.length - 1].number) {
            version.invoiceNumber = null;
            version.invoiceDate = null;
            version.provider = null;
            version.invoiceRaw = null;
            version.voidedAt = patch.at;
        }
    }
    return next;
}

function buyerIdForVoid(doc) {
    if (doc?.invoiceKind === 'b2c') throw new Error('這張發票沒有 8 碼統編，不能作廢。');
    const id = String(doc?.invoiceBuyerId || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(id)) throw new Error('這張發票沒有 8 碼統編，不能作廢。');
    return id;
}

function alreadyResult(doc) {
    return {
        already: true,
        invoiceNumber: invoiceNumberOf(doc),
        invoiceDate: doc.invoiceDate || doc.invoiceRecord?.date || '',
    };
}

async function post(creds, send, clock, path, reqData) {
    const stamp = taipeiDateTime(clock());
    const body = buildEnvelope({ ...creds, createDateTime: stamp.createDateTime, reqData });
    const json = await send(path, body);
    return { json, stamp, body };
}

async function queryState(creds, send, clock, orderID, fallbackDate) {
    const { json } = await post(creds, send, clock, '/queryInvoice', queryInvoicePayload({
        orderID,
        sellerId: creds.companyID,
    }));
    const parsed = parseResponse(json);
    const raw = publicResponse(json);
    if (parsed.statusCode === '3') return { state: 'missing', raw };
    if (!parsed.ok) throw new Error(parsed.statusDesc || '查詢已開立發票失敗。');
    const data = parsed.respData && typeof parsed.respData === 'object' ? parsed.respData : {};
    const status = data.status == null || data.status === '' ? '0' : String(data.status);
    if (status === '1') return { state: 'void', raw };
    if (status === '3') return { state: 'rejected', raw };
    const issued = issuedFrom(data, fallbackDate);
    if (!issued) return { state: 'missing', raw };
    return { state: 'issued', issued, raw };
}

async function releaseLock(db, ref) {
    await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const data = snap.data();
        if (data.invoiceStatus === 'invoiced') return;
        tx.set(ref, { ...data, invoiceLock: null });
    }).catch(() => {});
}

export async function issueStatement({ db, send, creds: rawCreds, caseId, version, description, actor, now = new Date().toISOString(), clock = () => new Date() }) {
    const creds = normalizeCreds(rawCreds);
    const ref = caseRef(db, caseId);
    const prepared = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        const latest = assertCase(data, version);
        if (invoiceNumberOf(data) && Number(data.invoicedVersion) === Number(version)) return { done: alreadyResult(data) };
        if (invoiceNumberOf(data)) {
            throw new Error(`上一版已開立發票 ${invoiceNumberOf(data)}，請先作廢再為這一版開立。`);
        }
        if (lockHeld(data.invoiceLock, actor, now)) throw new Error('這張帳單正在開立發票，請稍後再看結果，不要重複按。');
        const quote = quoteInvoice(latest.snapshot);
        if (quote.buyer?.kind !== 'b2b' || !/^\d{8}$/.test(String(quote.buyer?.taxId || ''))) {
            throw new Error('這位客戶沒有 8 碼統編，不能開立發票。請先到結帳系統補上統編。');
        }
        const text = cleanDescription(description, latest.snapshot);
        const reissue = Array.isArray(data.invoiceHistory) ? data.invoiceHistory.length : 0;
        const orderID = orderIdFor(caseId, version, reissue);
        const hadDraft = data.invoiceDraft?.version === Number(version) && data.invoiceDraft?.orderID === orderID;
        const payload = openInvoicePayload({
            orderID,
            sellerId: creds.companyID,
            buyer: quote.buyer,
            description: text,
            sales: quote.sales,
            tax: quote.tax,
            total: quote.total,
        });
        tx.set(ref, {
            ...data,
            invoiceLock: { version: Number(version), at: now, uid: actor },
            invoiceDraft: { version: Number(version), orderID, at: now },
        });
        return { quote, text, orderID, hadDraft, payload };
    });
    if (prepared.done) return prepared.done;

    const finish = async (issued, raw) => db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (invoiceNumberOf(data) && Number(data.invoicedVersion) === Number(version)) return alreadyResult(data);
        const next = markInvoiced(data, {
            version: Number(version),
            invoiceNumber: issued.number,
            invoiceDate: issued.date || taipeiDateTime(clock()).isoDate,
            kind: 'b2b',
            buyerId: prepared.quote.buyer.taxId,
            buyerName: prepared.quote.buyer.name,
            total: prepared.quote.total,
            description: prepared.text,
            orderID: prepared.orderID,
            randomNumber: issued.randomNumber,
            at: now,
            raw,
        });
        tx.set(ref, next);
        return {
            already: false,
            invoiceNumber: issued.number,
            invoiceDate: next.invoiceDate,
            kind: 'b2b',
        };
    });

    try {
        const fallbackDate = taipeiDateTime(clock()).isoDate;
        if (prepared.hadDraft) {
            const found = await queryState(creds, send, clock, prepared.orderID, fallbackDate);
            if (found.state === 'issued') return finish(found.issued, found.raw);
        }
        let response;
        try {
            response = await post(creds, send, clock, '/openInvoice', prepared.payload);
        } catch (error) {
            if (!isUncertain(error)) throw error;
            try {
                const found = await queryState(creds, send, clock, prepared.orderID, fallbackDate);
                if (found.state === 'issued') return finish(found.issued, found.raw);
            } catch (queryError) {
                if (!isUncertain(queryError)) throw queryError;
            }
            throw error;
        }
        const parsed = parseResponse(response.json);
        if (!parsed.ok) {
            if (isDuplicate(parsed)) {
                const found = await queryState(creds, send, clock, prepared.orderID, fallbackDate);
                if (found.state === 'issued') return finish(found.issued, found.raw);
            }
            throw new Error(parsed.statusDesc || '汎宇沒有接受這張發票。');
        }
        const issued = issuedFrom(parsed.respData, response.stamp.isoDate);
        if (!issued) throw new Error(parsed.statusDesc || '汎宇沒有回傳發票號碼。');
        return finish(issued, publicResponse(response.json));
    } catch (error) {
        await releaseLock(db, ref);
        throw error;
    }
}

export async function voidStatement({ db, send, creds: rawCreds, caseId, version, reason, actor, now = new Date().toISOString(), clock = () => new Date() }) {
    const creds = normalizeCreds(rawCreds);
    const why = String(reason || '').trim();
    if (!why) throw new Error('請填寫作廢原因。');
    if (why.length > 20) throw new Error('作廢原因請在 20 字以內。');
    const ref = caseRef(db, caseId);
    const prepared = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        assertCase(data, version);
        if (data.invoiceStatus !== 'invoiced' || !invoiceNumberOf(data)) throw new Error('這一版沒有可作廢的發票。');
        if (data.provider !== 'universalec') throw new Error('這張是在貨款登記手開的，請在原處處理，這裡不能作廢。');
        if (lockHeld(data.invoiceLock, actor, now)) throw new Error('這張帳單正在處理發票，請稍後再試。');
        const buyerId = buyerIdForVoid(data);
        const reissue = Array.isArray(data.invoiceHistory) ? data.invoiceHistory.length : 0;
        tx.set(ref, { ...data, invoiceLock: { version: Number(version), at: now, uid: actor, op: 'void' } });
        return {
            number: invoiceNumberOf(data),
            invoiceDate: data.invoiceDate || data.invoiceRecord?.date,
            buyerId,
            orderID: data.invoiceOrderId || orderIdFor(caseId, version, reissue),
        };
    });
    const payload = cancelInvoicePayload({
        orderID: prepared.orderID,
        sellerId: creds.companyID,
        buyerId: prepared.buyerId,
        invNo: prepared.number,
        invDate: ymdCompact(prepared.invoiceDate),
        reason: why,
    });
    const responseHolder = { raw: null };
    const finish = () => db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (data.invoiceStatus !== 'invoiced') return;
        tx.set(ref, markVoided(data, { reason: why, at: now, raw: responseHolder.raw }));
    });
    try {
        let response;
        try {
            response = await post(creds, send, clock, '/cancelInvoice', payload);
        } catch (error) {
            if (!isUncertain(error)) throw error;
            let found;
            try {
                found = await queryState(creds, send, clock, prepared.orderID, prepared.invoiceDate);
            } catch (queryError) {
                if (!isUncertain(queryError)) throw queryError;
                throw error;
            }
            if (found?.state === 'void') {
                responseHolder.raw = found.raw;
                await finish();
                return { voided: true, invoiceNumber: prepared.number };
            }
            throw error;
        }
        const parsed = parseResponse(response.json);
        if (!parsed.ok && !isDuplicate(parsed)) throw new Error(parsed.statusDesc || '汎宇沒有接受作廢。');
        responseHolder.raw = publicResponse(response.json);
        await finish();
        return { voided: true, invoiceNumber: prepared.number };
    } catch (error) {
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) return;
            tx.set(ref, { ...snap.data(), invoiceLock: null });
        }).catch(() => {});
        throw error;
    }
}

export async function testConnection({ send, creds: rawCreds, clock = () => new Date() }) {
    const creds = normalizeCreds(rawCreds);
    const response = await post(creds, send, clock, '/queryInvoice', queryInvoicePayload({
        orderID: 'connection-check',
        sellerId: creds.companyID,
    }));
    const parsed = parseResponse(response.json);
    if (parsed.statusCode !== '0' && parsed.statusCode !== '3') {
        throw new Error(parsed.statusDesc || '電子發票連線失敗。');
    }
    return { ok: true, message: parsed.statusDesc || '連線成功', time: response.stamp.createDateTime };
}
