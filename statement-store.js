// 對帳單送件資料：正式路徑寫入 Firestore statement_cases。
// 雲端暫時失敗時先留在這台電腦，下次打開送件中心再補送。

import {
    applyLineRecipient,
    applySentRegistration,
    caseDocumentId,
    latestVersion,
    publishSnapshot,
    sortCases,
} from './statement-case.js';

export const STATEMENT_COLLECTION = 'statement_cases';
export const CASE_CACHE_KEY = 'baiqi_statement_cases_v1';
export const OUTBOX_KEY = 'baiqi_statement_outbox_v1';

function emptyOutbox() {
    return { publishes: [], registers: [], recipients: [] };
}

function readJson(storage, key, fallback) {
    try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

export function isLogicError(error) {
    return /內容不完整|已經有更新|找不到|先不要登記|沒有這份/.test(String(error?.message || error || ''));
}

function rememberCache(storage, cases) {
    const map = {};
    cases.forEach(item => { if (item?.id) map[item.id] = item; });
    writeJson(storage, CASE_CACHE_KEY, map);
}

function readCache(storage) {
    const map = readJson(storage, CASE_CACHE_KEY, {});
    return Object.values(map || {}).filter(item => item && item.id && item.customerKey);
}

export function createLocalRepository(storage) {
    function read() {
        const map = readJson(storage, CASE_CACHE_KEY, {});
        return map && typeof map === 'object' ? map : {};
    }
    function write(map) {
        writeJson(storage, CASE_CACHE_KEY, map);
    }
    return {
        cloud: false,
        async publish(snapshot, now = new Date().toISOString()) {
            const id = await caseDocumentId(snapshot.customerKey, snapshot.startDate, snapshot.endDate);
            const all = read();
            const result = await publishSnapshot(all[id] || null, snapshot, now);
            const doc = plain({ ...result.doc, id, cloudPending: false });
            all[id] = doc;
            write(all);
            return { action: result.action, doc, cloud: false };
        },
        async list() {
            return sortCases(Object.values(read()).map(item => ({ ...item, state: item.state, cloudPending: false })));
        },
        async register(id, expectedVersion, format, sentAt) {
            const all = read();
            if (!all[id]) throw new Error('找不到這份帳單，請重新整理。');
            const doc = plain(applySentRegistration(all[id], expectedVersion, format, sentAt));
            all[id] = doc;
            write(all);
            return doc;
        },
        async saveRecipient(id, lineRecipient, now = new Date().toISOString()) {
            const all = read();
            if (!all[id]) throw new Error('找不到這份帳單，請重新整理。');
            const doc = plain(applyLineRecipient(all[id], lineRecipient, now));
            all[id] = doc;
            write(all);
            return doc;
        },
    };
}

async function commitPublish(db, fns, snapshot, now) {
    const id = await caseDocumentId(snapshot.customerKey, snapshot.startDate, snapshot.endDate);
    const ref = fns.doc(db, STATEMENT_COLLECTION, id);
    return fns.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const existing = snap.exists() ? { id, ...snap.data() } : null;
        const result = await publishSnapshot(existing, snapshot, now);
        if (result.action === 'unchanged' && existing && (result.doc.lineRecipient || '') === (existing.lineRecipient || '') && result.doc.updatedAt === existing.updatedAt) {
            return { action: result.action, doc: plain({ ...existing, id }) };
        }
        const stored = plain({ ...result.doc, id, cloudPending: false });
        tx.set(ref, stored);
        return { action: result.action, doc: stored };
    });
}

export function createFirestoreRepository(db, fns, storage) {
    function outbox() {
        const box = readJson(storage, OUTBOX_KEY, emptyOutbox());
        return {
            publishes: Array.isArray(box.publishes) ? box.publishes : [],
            registers: Array.isArray(box.registers) ? box.registers : [],
            recipients: Array.isArray(box.recipients) ? box.recipients : [],
        };
    }
    function saveOutbox(box) {
        writeJson(storage, OUTBOX_KEY, box);
    }
    async function publishNow(snapshot, now) {
        const result = await commitPublish(db, fns, snapshot, now);
        const cache = readJson(storage, CASE_CACHE_KEY, {});
        cache[result.doc.id] = result.doc;
        writeJson(storage, CASE_CACHE_KEY, cache);
        return { ...result, cloud: true };
    }
    return {
        cloud: true,
        async publish(snapshot, now = new Date().toISOString()) {
            try {
                return await publishNow(snapshot, now);
            } catch (error) {
                if (isLogicError(error)) throw error;
                const box = outbox();
                const key = `${snapshot.customerKey}|${snapshot.startDate}|${snapshot.endDate}`;
                const next = { key, snapshot, now };
                const index = box.publishes.findIndex(item => item.key === key);
                if (index >= 0) box.publishes[index] = next;
                else box.publishes.push(next);
                saveOutbox(box);
                const wrapped = new Error(error?.message || String(error));
                wrapped.queued = true;
                throw wrapped;
            }
        },
        async register(id, expectedVersion, format, sentAt) {
            const ref = fns.doc(db, STATEMENT_COLLECTION, id);
            try {
                const doc = await fns.runTransaction(db, async tx => {
                    const snap = await tx.get(ref);
                    if (!snap.exists()) throw new Error('找不到這份帳單，請重新整理。');
                    const next = plain(applySentRegistration({ id, ...snap.data() }, expectedVersion, format, sentAt));
                    tx.set(ref, next);
                    return next;
                });
                const cache = readJson(storage, CASE_CACHE_KEY, {});
                cache[id] = doc;
                writeJson(storage, CASE_CACHE_KEY, cache);
                return doc;
            } catch (error) {
                if (isLogicError(error)) throw error;
                const box = outbox();
                box.registers.push({ id, expectedVersion, format, sentAt });
                saveOutbox(box);
                const wrapped = new Error(error?.message || String(error));
                wrapped.queued = true;
                throw wrapped;
            }
        },
        async saveRecipient(id, lineRecipient, now = new Date().toISOString()) {
            const ref = fns.doc(db, STATEMENT_COLLECTION, id);
            try {
                const doc = await fns.runTransaction(db, async tx => {
                    const snap = await tx.get(ref);
                    if (!snap.exists()) throw new Error('找不到這份帳單，請重新整理。');
                    const next = plain(applyLineRecipient({ id, ...snap.data() }, lineRecipient, now));
                    tx.set(ref, next);
                    return next;
                });
                const cache = readJson(storage, CASE_CACHE_KEY, {});
                cache[id] = doc;
                writeJson(storage, CASE_CACHE_KEY, cache);
                return doc;
            } catch (error) {
                if (isLogicError(error)) throw error;
                const box = outbox();
                box.recipients.push({ id, lineRecipient, now });
                saveOutbox(box);
                const wrapped = new Error(error?.message || String(error));
                wrapped.queued = true;
                throw wrapped;
            }
        },
        async flush() {
            const box = outbox();
            const remain = emptyOutbox();
            for (const item of box.publishes) {
                try { await publishNow(item.snapshot, item.now); }
                catch (error) { if (!isLogicError(error)) remain.publishes.push(item); }
            }
            for (const item of box.recipients) {
                try { await this.saveRecipient(item.id, item.lineRecipient, item.now); }
                catch (error) {
                    if (!isLogicError(error)) remain.recipients.push(item);
                }
            }
            for (const item of box.registers) {
                try { await this.register(item.id, item.expectedVersion, item.format, item.sentAt); }
                catch (error) { if (!isLogicError(error)) remain.registers.push(item); }
            }
            saveOutbox(remain);
            return remain;
        },
        async list() {
            let remain = emptyOutbox();
            let cloudError = null;
            try { remain = await this.flush(); }
            catch (error) { cloudError = error; }
            const overlay = async cases => {
                let next = cases.map(item => ({ ...item, cloudPending: false }));
                for (const item of remain.publishes) {
                    const id = await caseDocumentId(item.snapshot.customerKey, item.snapshot.startDate, item.snapshot.endDate);
                    const existing = next.find(row => row.id === id) || null;
                    const result = await publishSnapshot(existing, item.snapshot, item.now);
                    const top = latestVersion(result.doc);
                    const serverHas = !!(existing && top && (existing.versions || []).some(version => version.version === top.version && version.fingerprint === top.fingerprint));
                    next = next.filter(row => row.id !== id);
                    next.push(plain({ ...result.doc, id, cloudPending: !serverHas }));
                }
                for (const item of remain.recipients) {
                    const existing = next.find(row => row.id === item.id);
                    if (!existing) continue;
                    existing.lineRecipient = item.lineRecipient || existing.lineRecipient;
                    existing.cloudPending = true;
                }
                for (const item of remain.registers) {
                    const existing = next.find(row => row.id === item.id);
                    if (!existing) continue;
                    try {
                        const updated = plain(applySentRegistration(existing, item.expectedVersion, item.format, item.sentAt));
                        updated.cloudPending = true;
                        next = next.filter(row => row.id !== item.id);
                        next.push(updated);
                    } catch { /* 版本已經不同，保留雲端那一版 */ }
                }
                return sortCases(next);
            };
            try {
                const snap = await fns.getDocsFromServer(fns.collection(db, STATEMENT_COLLECTION));
                const cases = snap.docs
                    .map(row => ({ id: row.id, ...row.data() }))
                    .filter(row => row.customerKey && Array.isArray(row.versions));
                const visible = await overlay(cases);
                rememberCache(storage, visible.filter(item => !item.cloudPending));
                return { cases: visible, cloudError, fromCache: false };
            } catch (error) {
                return { cases: await overlay(readCache(storage)), cloudError: error, fromCache: true };
            }
        },
    };
}
