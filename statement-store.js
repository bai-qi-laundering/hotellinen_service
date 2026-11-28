import { statementCustomerKey } from './firebase-signature/functions/lib/logistics-items.js?v=20261128-dept-alias';
import './scoped-reads.js?v=20261119-read2';
// 對帳單送件資料：正式路徑寫入 Firestore statement_cases。
// 雲端暫時失敗時先留在這台電腦，下次打開送件中心再補送。

import {
    applyLineRecipient,
    applySentRegistration,
    caseDocumentId,
    latestVersion,
    publishSnapshot,
    sortCases,
    statementDeleteBlockReason,
} from './statement-case.js?v=20261125-delete-case';
import { matchingCombinedAccount, membersOfStatementTarget } from './firebase-signature/functions/lib/statement-groups.js?v=20261125-delete-case';

export const STATEMENT_COLLECTION = 'statement_cases';
export const AUTO_RUN_COLLECTION = 'statement_auto_runs';
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

function rememberCache(storage, cases, month = '') {
    const previous = month ? readJson(storage, CASE_CACHE_KEY, {}) : {};
    const map = {};
    if (month && previous && typeof previous === 'object') Object.entries(previous).forEach(([id, item]) => { if (String(item?.endDate || '').slice(0, 7) !== month) map[id] = item; });
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
        async publish(snapshot, now = new Date().toISOString(), options = {}) {
            const id = await caseDocumentId(snapshot.customerKey, snapshot.startDate, snapshot.endDate);
            const all = read();
            const result = await publishSnapshot(all[id] || null, snapshot, now, options);
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
        async remove(id) {
            const all = read();
            if (!all[id]) throw new Error('找不到這份帳單，請重新整理。');
            const reason = statementDeleteBlockReason(all[id]);
            if (reason) throw new Error(reason);
            delete all[id];
            write(all);
        },
    };
}

async function commitPublish(db, fns, snapshot, now, options) {
    const id = await caseDocumentId(snapshot.customerKey, snapshot.startDate, snapshot.endDate);
    const ref = fns.doc(db, STATEMENT_COLLECTION, id);
    return fns.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const existing = snap.exists() ? { id, ...snap.data() } : null;
        const result = await publishSnapshot(existing, snapshot, now, options);
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
    async function publishNow(snapshot, now, options) {
        const result = await commitPublish(db, fns, snapshot, now, options);
        const cache = readJson(storage, CASE_CACHE_KEY, {});
        cache[result.doc.id] = result.doc;
        writeJson(storage, CASE_CACHE_KEY, cache);
        return { ...result, cloud: true };
    }
    return {
        cloud: true,
        async publish(snapshot, now = new Date().toISOString(), options = {}) {
            try {
                return await publishNow(snapshot, now, options);
            } catch (error) {
                if (isLogicError(error)) throw error;
                const box = outbox();
                const key = `${snapshot.customerKey}|${snapshot.startDate}|${snapshot.endDate}`;
                const next = { key, snapshot, now, options };
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
                try { await publishNow(item.snapshot, item.now, item.options || {}); }
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
        async remove(id) {
            const ref = fns.doc(db, STATEMENT_COLLECTION, id);
            const runRef = fns.doc(db, AUTO_RUN_COLLECTION, id);
            try {
                await fns.runTransaction(db, async tx => {
                    const snap = await tx.get(ref);
                    if (!snap.exists()) throw new Error('找不到這份帳單，請重新整理。');
                    const current = { id, ...snap.data() };
                    const reason = statementDeleteBlockReason(current);
                    if (reason) throw new Error(reason);
                    const account = matchingCombinedAccount(membersOfStatementTarget(current.customerKey));
                    const memberRefs = [];
                    if (account) {
                        for (const member of account.members) {
                            const memberId = await caseDocumentId(member, current.startDate, current.endDate);
                            if (memberId !== id) memberRefs.push(fns.doc(db, AUTO_RUN_COLLECTION, memberId));
                        }
                    }
                    const runSnap = await tx.get(runRef);
                    const memberSnaps = [];
                    for (const memberRef of memberRefs) memberSnaps.push(await tx.get(memberRef));
                    tx.delete(ref);
                    if (runSnap.exists()) tx.delete(runRef);
                    memberSnaps.forEach((memberSnap, index) => {
                        if (memberSnap.exists() && memberSnap.data()?.combinedCaseId === id) tx.delete(memberRefs[index]);
                    });
                });
            } catch (error) {
                if (!/找不到這份帳單/.test(String(error?.message || error))) throw error;
            }
            try {
                const cache = readJson(storage, CASE_CACHE_KEY, {});
                if (cache && typeof cache === 'object') {
                    delete cache[id];
                    writeJson(storage, CASE_CACHE_KEY, cache);
                }
                const box = outbox();
                const publishes = [];
                for (const item of box.publishes) {
                    const itemId = await caseDocumentId(item.snapshot?.customerKey, item.snapshot?.startDate, item.snapshot?.endDate);
                    if (itemId !== id) publishes.push(item);
                }
                box.publishes = publishes;
                box.registers = box.registers.filter(item => item.id !== id);
                box.recipients = box.recipients.filter(item => item.id !== id);
                saveOutbox(box);
            } catch (error) {
                console.warn('帳單已從雲端刪除，但這台電腦的暫存沒清掉', error);
            }
        },
        async list({ skipFlush = false, month = '', keyword = '', customerNames = [] } = {}) {
            let remain = emptyOutbox();
            let cloudError = null;
            if (skipFlush) remain = outbox();
            else {
                try { remain = await this.flush(); }
                catch (error) { cloudError = error; }
            }
            const overlay = async cases => {
                let next = cases.map(item => ({ ...item, cloudPending: false }));
                for (const item of remain.publishes) {
                    const id = await caseDocumentId(item.snapshot.customerKey, item.snapshot.startDate, item.snapshot.endDate);
                    const existing = next.find(row => row.id === id) || null;
                    const result = await publishSnapshot(existing, item.snapshot, item.now, item.options || {});
                    const top = latestVersion(result.doc);
                    const serverVersion = existing && top && (existing.versions || []).find(version => version.version === top.version && version.fingerprint === top.fingerprint);
                    const serverHas = !!(serverVersion && (!item.options?.force || serverVersion.createdAt === top.createdAt));
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
            let snap;
            try {
                const collectionRef = fns.collection(db, STATEMENT_COLLECTION);
                if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('結帳月份格式不正確');
                const key=ScopedReads.norm(keyword);
                let customerKeys=null, matchingKeys=[];
                if(key){
                    // Resolve a partial name from configuration and already cached labels, without reading all statements.
                    if(fns.getDocFromServer){
                        const config=await fns.getDocFromServer(fns.doc(db,'inventory_config','master_template'));
                        const rows=config.exists()?(config.data().items||[]):[];
                        matchingKeys=rows.filter(row=>[row.baseName,row.hotel,[row.baseName,row.deptName].filter(Boolean).join(' '),statementCustomerKey(row.baseName,row.hotel,row.deptName)].some(name=>ScopedReads.norm(name).includes(key))).map(row=>statementCustomerKey(row.baseName,row.hotel,row.deptName));
                    }
                    customerNames.push(...readCache(storage).flatMap(row=>[row.customerKey,row.customerName]));
                    customerKeys=[...new Set([...matchingKeys,...customerNames.filter(name=>ScopedReads.norm(name).includes(key))].flatMap(ScopedReads.variants))];
                    for(const value of ScopedReads.variants(keyword))if(!customerKeys.includes(value))customerKeys.push(value);
                }
                const api={...fns};
                let plans;
                if(customerKeys&&month){
                    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
                    plans=ScopedReads.queries(api,db,STATEMENT_COLLECTION,month+'-01',end,{field:'customerKey',values:customerKeys,dateField:'endDate',canonicalDates:true});
                }else if(customerKeys){
                    plans=ScopedReads.chunks(customerKeys,30).map(names=>fns.query(collectionRef,fns.where('customerKey','in',names)));
                }else plans=[month?fns.query(collectionRef,fns.where('endDate','>=',month+'-01'),fns.where('endDate','<',month+'-32')):collectionRef];
                const snapshots=[];
                for(const batch of ScopedReads.chunks(plans,4))snapshots.push(...await Promise.all(batch.map(target=>fns.getDocsFromServer(target))));
                snap={docs:[...new Map(snapshots.flatMap(s=>s.docs).map(row=>[row.id,row])).values()]};
            } catch (error) {
                return { cases: await overlay(readCache(storage)), cloudError: error, fromCache: true };
            }
            const cases = snap.docs
                .map(row => ({ id: row.id, ...row.data() }))
                .filter(row => row.customerKey && Array.isArray(row.versions));
            const visible = await overlay(cases);
            let cacheError = null;
            try { keyword ? writeJson(storage, CASE_CACHE_KEY, {...readJson(storage,CASE_CACHE_KEY,{}), ...Object.fromEntries(visible.filter(item=>!item.cloudPending).map(item=>[item.id,item]))}) : rememberCache(storage, visible.filter(item => !item.cloudPending), month); }
            catch (error) { cacheError = error; console.warn('帳單已從雲端讀取，但本機暫存失敗', error); }
            return { cases: visible, cloudError, cacheError, fromCache: false };
        },
    };
}

