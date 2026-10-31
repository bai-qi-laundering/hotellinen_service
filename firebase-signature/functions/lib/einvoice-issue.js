import { cleanDescription, quoteInvoice } from './einvoice-amount.js';
import {
    b2bCreatePayload,
    b2bVoidPayload,
    b2cCreatePayload,
    b2cVoidPayload,
    buildRequestBody,
    fourDigitRandom,
    isDuplicate,
    isSuccess,
    numbersFromZ21,
    publicResponse,
    rangeFromA01,
    replyOf,
    taipeiParts,
    ymdCompact,
} from './einvoice-client.js';

const LOCK_MS = 120000;

function caseRef(db, id) {
    return db.collection('statement_cases').doc(id);
}

function poolRef(db) {
    return db.collection('inventory_config').doc('einvoice_number_pool');
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
    next.invoiceRaw = patch.raw;
    next.invoiceRecord = {
        number: patch.invoiceNumber,
        method: 'electronic',
        date: patch.invoiceDate,
        amount: patch.total,
        version: patch.version,
        at: patch.at,
        provider: 'universalec',
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

async function takeNumber(db, caseId, now) {
    const ref = poolRef(db);
    return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : { unused: [], used: {} };
        const unused = [...(data.unused || [])];
        const used = { ...(data.used || {}) };
        while (unused.length && used[unused[0].number]) unused.shift();
        if (!unused.length) return null;
        const next = unused.shift();
        used[next.number] = caseId;
        tx.set(ref, { unused, used, updatedAt: now }, { merge: true });
        return next;
    });
}

async function rememberNumbers(db, numbers, now) {
    const ref = poolRef(db);
    await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : { unused: [], used: {} };
        const used = { ...(data.used || {}) };
        const unused = [...(data.unused || [])];
        const have = new Set([...unused.map(row => row.number), ...Object.keys(used)]);
        for (const row of numbers) {
            if (!row?.number || have.has(row.number)) continue;
            unused.push({ number: row.number, random: row.random || '' });
            have.add(row.number);
        }
        tx.set(ref, { unused, used, updatedAt: now }, { merge: true });
    });
}

async function allocateNumber(db, send, creds, systime, caseId, now) {
    const ready = await takeNumber(db, caseId, now);
    if (ready) return ready;
    const z21 = await send(buildRequestBody({ functionCode: 'Z21', payload: {}, wrapper: 'INDEX', creds, systime }));
    let numbers = isSuccess(z21) ? numbersFromZ21(z21) : [];
    if (!numbers.length) {
        const a01 = await send(buildRequestBody({ functionCode: 'A01', payload: {}, wrapper: 'INDEX', creds, systime }));
        if (!isSuccess(a01) && !isSuccess(z21)) {
            throw new Error(replyOf(a01).message || replyOf(z21).message || '取不到發票號碼。');
        }
        numbers = rangeFromA01(a01);
    }
    if (!numbers.length) throw new Error('汎宇沒有回傳可用的發票號碼。');
    await rememberNumbers(db, numbers, now);
    const taken = await takeNumber(db, caseId, now);
    if (!taken) throw new Error('發票號碼剛被用完，請再按一次。');
    return taken;
}

function kindOf(doc) {
    if (doc?.invoiceKind === 'b2b' || doc?.invoiceKind === 'b2c') return doc.invoiceKind;
    const id = String(doc?.invoiceBuyerId || '');
    if (!id || id === '0000000000') return 'b2c';
    return 'b2b';
}

function alreadyResult(doc) {
    return {
        already: true,
        invoiceNumber: invoiceNumberOf(doc),
        invoiceDate: doc.invoiceDate || doc.invoiceRecord?.date || '',
    };
}

export async function issueStatement({ db, send, creds, seller, caseId, version, description, actor, now = new Date().toISOString(), clock = () => new Date() }) {
    const ref = caseRef(db, caseId);
    const prepared = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        const latest = assertCase(data, version);
        if (data.invoiceStatus === 'invoiced' && Number(data.invoicedVersion) === Number(version)) return { done: alreadyResult(data) };
        if (data.invoiceStatus === 'invoiced' && invoiceNumberOf(data)) {
            throw new Error(`上一版已開立發票 ${invoiceNumberOf(data)}，請先作廢再為這一版開立。`);
        }
        if (lockHeld(data.invoiceLock, actor, now)) throw new Error('這張帳單正在開立發票，請稍後再看結果，不要重複按。');
        const quote = quoteInvoice(latest.snapshot);
        const text = cleanDescription(description, latest.snapshot);
        const draft = data.invoiceDraft?.version === Number(version) && data.invoiceDraft?.number ? data.invoiceDraft : null;
        tx.set(ref, { ...data, invoiceLock: { version: Number(version), at: now, uid: actor } });
        return { quote, text, draft, kind: quote.buyer.kind };
    });
    if (prepared.done) return prepared.done;

    const stamp = taipeiParts(clock());
    let draft = prepared.draft;
    try {
        if (!draft) {
            const taken = await allocateNumber(db, send, creds, stamp.systime, caseId, now);
            draft = {
                version: Number(version),
                number: taken.number,
                random: taken.random || fourDigitRandom(taken.number),
                kind: prepared.kind,
            };
            const raced = await db.runTransaction(async tx => {
                const snap = await tx.get(ref);
                const data = snap.data();
                if (data.invoiceStatus === 'invoiced' && Number(data.invoicedVersion) === Number(version)) return alreadyResult(data);
                const current = data.invoiceDraft?.version === Number(version) && data.invoiceDraft?.number ? data.invoiceDraft : draft;
                draft = current;
                tx.set(ref, { ...data, invoiceDraft: { ...current, at: now } });
                return null;
            });
            if (raced) return raced;
        }
        const buyer = prepared.quote.buyer;
        const payload = buyer.kind === 'b2b'
            ? b2bCreatePayload({
                number: draft.number,
                ymd: stamp.ymd,
                hms: stamp.hms,
                seller,
                buyer,
                description: prepared.text,
                sales: prepared.quote.sales,
                tax: prepared.quote.tax,
                total: prepared.quote.total,
                address: seller.address,
            })
            : b2cCreatePayload({
                number: draft.number,
                ymd: stamp.ymd,
                hms: stamp.hms,
                seller,
                buyer,
                description: prepared.text,
                sales: prepared.quote.sales,
                tax: prepared.quote.tax,
                total: prepared.quote.total,
                random: draft.random || fourDigitRandom(draft.number),
            });
        const response = await send(buildRequestBody({
            functionCode: payload.INVOICE_CODE,
            payload,
            wrapper: 'Invoice',
            creds,
            systime: stamp.systime,
        }));
        if (!isSuccess(response) && !isDuplicate(response)) {
            throw new Error(replyOf(response).message || '汎宇沒有接受這張發票。');
        }
        const saved = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const data = snap.data();
            if (data.invoiceStatus === 'invoiced' && Number(data.invoicedVersion) === Number(version)) return alreadyResult(data);
            const next = markInvoiced(data, {
                version: Number(version),
                invoiceNumber: draft.number,
                invoiceDate: stamp.isoDate,
                kind: buyer.kind,
                buyerId: buyer.taxId,
                buyerName: buyer.name,
                total: prepared.quote.total,
                description: prepared.text,
                at: now,
                raw: publicResponse(response),
            });
            tx.set(ref, next);
            return { already: false, invoiceNumber: draft.number, invoiceDate: stamp.isoDate, kind: buyer.kind };
        });
        return saved;
    } catch (error) {
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) return;
            const data = snap.data();
            if (data.invoiceStatus === 'invoiced') return;
            tx.set(ref, { ...data, invoiceLock: null });
        }).catch(() => {});
        throw error;
    }
}

export async function voidStatement({ db, send, creds, seller, caseId, version, reason, actor, now = new Date().toISOString(), clock = () => new Date() }) {
    const why = String(reason || '').trim();
    if (!why) throw new Error('請填寫作廢原因。');
    if (why.length > 100) throw new Error('作廢原因請在 100 字以內。');
    const ref = caseRef(db, caseId);
    const prepared = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        assertCase(data, version);
        if (data.invoiceStatus !== 'invoiced' || !invoiceNumberOf(data)) throw new Error('這一版沒有可作廢的發票。');
        if (data.provider !== 'universalec') throw new Error('這張是在貨款登記手開的，請在原處處理，這裡不能作廢。');
        if (lockHeld(data.invoiceLock, actor, now)) throw new Error('這張帳單正在處理發票，請稍後再試。');
        tx.set(ref, { ...data, invoiceLock: { version: Number(version), at: now, uid: actor, op: 'void' } });
        return {
            number: invoiceNumberOf(data),
            invoiceDate: data.invoiceDate || data.invoiceRecord?.date,
            kind: kindOf(data),
            buyerId: data.invoiceBuyerId,
        };
    });
    const stamp = taipeiParts(clock());
    const invoiceYmd = ymdCompact(prepared.invoiceDate);
    const payload = prepared.kind === 'b2c'
        ? b2cVoidPayload({
            number: prepared.number,
            invoiceYmd,
            buyerId: prepared.buyerId || '0000000000',
            sellerId: seller.id,
            cancelYmd: stamp.ymd,
            cancelHms: stamp.hms,
            reason: why,
        })
        : b2bVoidPayload({
            number: prepared.number,
            invoiceYmd,
            buyerId: prepared.buyerId,
            sellerId: seller.id,
            cancelYmd: stamp.ymd,
            cancelHms: stamp.hms,
            reason: why,
        });
    try {
        const response = await send(buildRequestBody({
            functionCode: payload.INVOICE_CODE,
            payload,
            wrapper: 'Invoice',
            creds,
            systime: stamp.systime,
        }));
        if (!isSuccess(response) && !isDuplicate(response)) {
            throw new Error(replyOf(response).message || '汎宇沒有接受作廢。');
        }
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const data = snap.data();
            if (data.invoiceStatus !== 'invoiced') return;
            tx.set(ref, markVoided(data, { reason: why, at: now, raw: publicResponse(response) }));
        });
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

export async function testConnection({ send, creds, clock = () => new Date() }) {
    const stamp = taipeiParts(clock());
    const response = await send(buildRequestBody({ functionCode: 'Y01', payload: {}, wrapper: 'INDEX', creds, systime: stamp.systime }));
    const { reply, message } = replyOf(response);
    if (reply !== '1') throw new Error(message || '電子發票連線失敗。');
    return { ok: true, message: message || '連線成功', time: response?.INDEX?.SYSTIME || stamp.systime };
}
