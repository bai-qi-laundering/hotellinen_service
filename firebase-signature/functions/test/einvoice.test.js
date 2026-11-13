import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { quoteInvoice, splitTaxInclusive } from '../lib/einvoice-amount.js';
import { payableAmount } from '../lib/statement-case.js';
import {
    buildEnvelope,
    cancelInvoicePayload,
    encodeAuth,
    hostForEnv,
    issuedFrom,
    openInvoicePayload,
    orderIdFor,
    parseResponse,
    PROD_HOST,
    queryInvoicePayload,
    signatureValue,
    taipeiDateTime,
    TEST_HOST,
} from '../lib/einvoice-client.js';
import { issueStatement, testConnection, voidStatement } from '../lib/einvoice-issue.js';

const creds = {
    companyID: '96842769',
    userID: 'baiqi-admin',
    authPlain: 'plain-password',
    apiKey: 'test-api-key',
};
const clock = () => new Date('2026-10-31T01:30:00.000Z');
const buyerB2B = { kind: 'b2b', taxId: '87654321', name: '驗證飯店股份有限公司' };

function memoryFirestore(seed = {}) {
    const docs = new Map(Object.entries(seed));
    return {
        collection(name) {
            return { doc(id) { return { path: `${name}/${id}` }; } };
        },
        async runTransaction(fn) {
            const staged = new Map();
            const tx = {
                async get(ref) {
                    const data = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
                    const exists = data != null;
                    return { exists, data: () => (exists ? structuredClone(data) : undefined) };
                },
                set(ref, data, options) {
                    const prev = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
                    const next = options?.merge && prev ? { ...structuredClone(prev), ...structuredClone(data) } : structuredClone(data);
                    staged.set(ref.path, next);
                },
            };
            const result = await fn(tx);
            for (const [path, data] of staged) docs.set(path, data);
            return result;
        },
        read(path) {
            return docs.get(path);
        },
    };
}

function statementDoc(taxId = '87654321') {
    return {
        customerKey: '驗證飯店',
        latestVersion: 1,
        state: 'sent',
        invoiceStatus: 'ready',
        invoicedVersion: null,
        versions: [{
            version: 1,
            snapshot: {
                customerKey: '驗證飯店',
                startDate: '2026-10-01',
                endDate: '2026-10-31',
                profile: { name: '驗證飯店股份有限公司', taxId },
                totals: { afterRebate: 1752, tax: 88 },
            },
        }],
    };
}

function issuedBody(number = 'AB12345678') {
    return {
        statusCode: '0',
        statusDesc: '',
        respData: { invNo: number, invDate: '20261031', invTime: '09:30:00', randomNumber: '4321' },
    };
}

function gateway(handler) {
    const calls = [];
    const send = async (path, body) => {
        calls.push({ path, body });
        return handler(path, body, calls);
    };
    return { calls, send };
}

test('含稅總額四捨五入後拆成未稅與 5% 稅，兩者加回總額', () => {
    assert.deepEqual(splitTaxInclusive(1840), { total: 1840, sales: 1752, tax: 88, rate: '0.05' });
    assert.deepEqual(splitTaxInclusive(107), { total: 107, sales: 102, tax: 5, rate: '0.05' });
    assert.equal(splitTaxInclusive(1840).sales + splitTaxInclusive(1840).tax, 1840);
    assert.throws(() => splitTaxInclusive(0), /1 元以上/);
    const snapshot = statementDoc().versions[0].snapshot;
    assert.equal(quoteInvoice(snapshot).total, payableAmount(snapshot));
    assert.equal(quoteInvoice(snapshot).buyer.kind, 'b2b');
    assert.equal(quoteInvoice(snapshot).buyer.taxId, '87654321');
    assert.throws(() => quoteInvoice({ ...snapshot, profile: { name: '散客', taxId: '' } }), /沒有 8 碼統編/);
    assert.throws(() => quoteInvoice({ ...snapshot, profile: { name: '散客', taxId: '123' } }), /沒有 8 碼統編/);
    assert.throws(() => quoteInvoice({ ...snapshot, profile: { name: '散客', taxId: '0000000000' } }), /沒有 8 碼統編/);
    assert.throws(() => quoteInvoice({ ...snapshot, profile: { name: '0000', taxId: '' } }), /不可為 0/);
});

function hmacBase64(apiKey, createDateTime) {
    return createHmac('sha256', Buffer.from(apiKey, 'utf8'))
        .update(Buffer.from(createDateTime, 'utf8'))
        .digest('base64');
}

test('簽章是標準 Base64 的 HMAC-SHA256，金鑰為 APIKey、訊息為台北時間字串', () => {
    assert.equal(encodeAuth('A15989995'), 'QTE1OTg5OTk1');
    assert.equal(Buffer.from('QTE1OTg5OTk1', 'base64').toString('utf8'), 'A15989995');
    const createDateTime = '2026/07/01 17:22:08';
    const expected = 'cRpv1wXiuwJH82X9AA3jJ0QFM64TjFRmyt+HRh88KR0=';
    assert.equal(hmacBase64('test-api-key', createDateTime), expected);
    assert.equal(signatureValue('test-api-key', createDateTime), expected);
    assert.equal(Buffer.from(expected, 'base64').length, 32);
    assert.match(expected, /\+$|=$/);
    assert.match(expected, /\+/);
    assert.equal(expected.includes('-'), false);
    assert.equal(expected.includes('_'), false);
    assert.notEqual(
        expected,
        createHmac('sha256', Buffer.from('test-api-key', 'utf8')).update(Buffer.from(createDateTime, 'utf8')).digest('base64url'),
    );
    assert.notEqual(signatureValue('test-api-key', createDateTime), signatureValue('other-api-key', createDateTime));
    assert.throws(() => signatureValue('', createDateTime), /APIKey 未設定/);
    assert.throws(() => signatureValue('test-api-key', '20260701172208'), /yyyy\/MM\/dd HH:mm:ss/);
    assert.throws(() => signatureValue('test-api-key', '2026/7/1 17:22:08'), /yyyy\/MM\/dd HH:mm:ss/);
    assert.throws(() => signatureValue('test-api-key', '2026-07-01 17:22:08'), /yyyy\/MM\/dd HH:mm:ss/);

    const signedAt = taipeiDateTime(new Date('2026-07-01T09:22:08.000Z'));
    assert.equal(signedAt.createDateTime, createDateTime);
    const left = buildEnvelope({
        ...creds, createDateTime: signedAt.createDateTime, reqData: { orderID: 'a' },
    });
    const right = buildEnvelope({
        ...creds, createDateTime: signedAt.createDateTime, reqData: { orderID: 'b', process_type: 'B' },
    });
    assert.equal(left.createDateTime, createDateTime);
    assert.equal(right.createDateTime, createDateTime);
    assert.equal(left.signatureValue, expected);
    assert.equal(left.signatureValue, right.signatureValue);
    assert.equal(left.signatureValue, hmacBase64(creds.apiKey, left.createDateTime));
    assert.equal(left.auth, encodeAuth(creds.authPlain));
    assert.notEqual(left.auth, creds.authPlain);
    assert.equal(hostForEnv('test'), TEST_HOST);
    assert.equal(hostForEnv(''), TEST_HOST);
    assert.equal(hostForEnv('prod'), PROD_HOST);
    assert.equal(hostForEnv('PROD'), PROD_HOST);
});

test('UTC 轉成 Asia/Taipei 的 yyyy/MM/dd HH:mm:ss，個位數補零', () => {
    assert.equal(taipeiDateTime(clock()).createDateTime, '2026/10/31 09:30:00');
    assert.equal(taipeiDateTime(clock()).isoDate, '2026-10-31');
    assert.equal(taipeiDateTime(new Date('2026-07-01T09:22:08.000Z')).createDateTime, '2026/07/01 17:22:08');
    assert.equal(taipeiDateTime(new Date('2026-06-30T16:00:00.000Z')).createDateTime, '2026/07/01 00:00:00');
    assert.equal(taipeiDateTime(new Date('2026-07-01T15:59:59.000Z')).createDateTime, '2026/07/01 23:59:59');
    assert.equal(taipeiDateTime(new Date('2026-07-01T16:00:00.000Z')).createDateTime, '2026/07/02 00:00:00');
});

test('B2B 開立封包帶齊 MIG 4.1 必填欄位，金額是整數', () => {
    const b2b = openInvoicePayload({
        orderID: 'case_1-v1', sellerId: '96842769', buyer: buyerB2B,
        description: '布品洗滌費 2026/10/01–2026/10/31', sales: 1752, tax: 88, total: 1840,
    });
    assert.equal(b2b.process_type, 'B');
    assert.equal(b2b.buyerID, '87654321');
    assert.equal(b2b.buyerName, '驗證飯店股份有限公司');
    assert.equal(b2b.invoiceType, '07');
    assert.equal(b2b.donateMark, '0');
    assert.equal(b2b.printMark, 'Y');
    assert.equal(b2b.salesAmount, 1752);
    assert.equal(b2b.taxAmount, 88);
    assert.equal(b2b.totalAmount, 1840);
    assert.equal(b2b.freetaxSalesamount, 0);
    assert.equal(b2b.zerotaxSalesamount, 0);
    assert.equal(b2b.taxType, '1');
    assert.equal(b2b.taxrate, 0.05);
    assert.equal(b2b.Details[0].description, '布品洗滌費 2026/10/01–2026/10/31');
    assert.equal(b2b.Details[0].quantity, 1);
    assert.equal(b2b.Details[0].unitprice, 1752);
    assert.equal(b2b.Details[0].amount, 1752);
    assert.equal(b2b.Details[0].sequenceNumber, '0001');
    assert.equal(b2b.Details[0].taxType, '1');
    assert.equal(b2b.notifyEmail, undefined);
    assert.throws(() => openInvoicePayload({
        orderID: 'x', sellerId: '96842769', buyer: { taxId: '87654321', name: '0' },
        description: '品項', sales: 100, tax: 5, total: 105,
    }), /不可為 0/);
    assert.throws(() => openInvoicePayload({
        orderID: 'case_2-v1', sellerId: '96842769', buyer: { kind: 'b2c', taxId: '0000000000', name: '驗證飯店股份有限公司' },
        description: '布品洗滌費', sales: 1752, tax: 88, total: 1840,
    }), /沒有 8 碼統編/);
    assert.throws(() => openInvoicePayload({
        orderID: 'case_2-v1', sellerId: '96842769', buyer: { taxId: '', name: '驗證飯店股份有限公司' },
        description: '布品洗滌費', sales: 1752, tax: 88, total: 1840,
    }), /沒有 8 碼統編/);

    const cancel = cancelInvoicePayload({
        orderID: 'case_1-v1', sellerId: '96842769', buyerId: '87654321',
        invNo: 'AB12345678', invDate: '20261031', reason: '開錯抬頭',
    });
    assert.equal(cancel.process_type, 'B');
    assert.equal(cancel.buyerID, '87654321');
    assert.equal(cancel.invNo, 'AB12345678');
    assert.equal(cancel.cancelReason, '開錯抬頭');
    assert.throws(() => cancelInvoicePayload({
        orderID: 'x', sellerId: '96842769', buyerId: '87654321',
        invNo: 'AB12345678', invDate: '20261031', reason: '一二三四五六七八九十一二三四五六七八九十一',
    }), /20 字/);
    assert.throws(() => cancelInvoicePayload({
        orderID: 'x', kind: 'b2c', sellerId: '96842769', buyerId: '0000000000',
        invNo: 'AB12345678', invDate: '20261031', reason: '開錯抬頭',
    }), /沒有 8 碼統編/);
    const queried = queryInvoicePayload({ orderID: 'case_1-v1', kind: 'b2c', sellerId: '96842769' });
    assert.equal(queried.process_type, 'B');
    assert.equal(queried.sellerID, '96842769');
    assert.equal(orderIdFor('case_1', 1, 0), 'case_1-v1');
    assert.equal(orderIdFor('case_1', 1, 0), orderIdFor('case_1', 1, 0));
    assert.equal(orderIdFor('case_1', 1, 1), 'case_1-v1-r1');
    assert.ok(orderIdFor('x'.repeat(80), 12, 3).length <= 50);
});

test('回應看 statusCode，失敗時留下 statusDesc', () => {
    const ok = parseResponse({ statusCode: '0', statusDesc: '', respData: { invNo: 'SX19061101', invDate: '20190820', randomNumber: '9716' } });
    assert.equal(ok.ok, true);
    assert.equal(issuedFrom(ok.respData, '2019-08-20').number, 'SX19061101');
    assert.equal(issuedFrom(ok.respData).date, '2019-08-20');
    assert.equal(issuedFrom(ok.respData).randomNumber, '9716');
    const numeric = parseResponse({ statusCode: 0, statusDesc: '', respData: { invNo: 'AB12345678' } });
    assert.equal(numeric.ok, true);
    const failed = parseResponse({ statusCode: '2', statusDesc: '買方統編錯誤', respData: null });
    assert.equal(failed.ok, false);
    assert.equal(failed.statusDesc, '買方統編錯誤');
    assert.equal(parseResponse({ statusCode: '3', statusDesc: '無資料' }).statusCode, '3');
    assert.equal(issuedFrom({ invNo: 'AB12345678', status: '1' }), null);
});

test('同一版對帳單只會向汎宇開一次，第二次直接回原號碼', async () => {
    const db = memoryFirestore({ 'statement_cases/case_1': statementDoc() });
    const { calls, send } = gateway(path => {
        if (path === '/openInvoice') return issuedBody();
        throw new Error('不該查詢 ' + path);
    });
    const first = await issueStatement({
        db, send, creds, caseId: 'case_1', version: 1, description: '布品洗滌費 2026/10/01–2026/10/31', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(first.already, false);
    assert.equal(first.invoiceNumber, 'AB12345678');
    assert.equal(first.kind, 'b2b');
    const saved = db.read('statement_cases/case_1');
    assert.equal(saved.invoiceStatus, 'invoiced');
    assert.equal(saved.invoicedVersion, 1);
    assert.equal(saved.provider, 'universalec');
    assert.equal(saved.invoiceRecord.number, 'AB12345678');
    assert.equal(saved.invoiceRecord.amount, 1840);
    assert.equal(saved.invoiceRecord.randomNumber, '4321');
    assert.equal(saved.invoiceOrderId, 'case_1-v1');
    assert.equal(saved.versions[0].invoiceNumber, 'AB12345678');
    assert.equal(saved.invoiceRaw.statusCode, '0');
    assert.equal(saved.invoiceRaw.auth, undefined);
    assert.equal(saved.invoiceRaw.respData.invNo, 'AB12345678');
    const opened = calls.filter(call => call.path === '/openInvoice');
    assert.equal(opened.length, 1);
    assert.equal(opened[0].body.reqData.orderID, 'case_1-v1');
    assert.equal(opened[0].body.reqData.process_type, 'B');
    assert.equal(opened[0].body.reqData.buyerID, '87654321');
    assert.equal(opened[0].body.reqData.salesAmount, 1752);
    assert.equal(opened[0].body.reqData.taxAmount, 88);
    assert.equal(opened[0].body.reqData.totalAmount, 1840);
    assert.equal(opened[0].body.createDateTime, '2026/10/31 09:30:00');
    assert.equal(opened[0].body.companyID, '96842769');
    assert.equal(opened[0].body.auth, encodeAuth('plain-password'));
    assert.equal(opened[0].body.signatureValue, signatureValue('test-api-key', opened[0].body.createDateTime));
    assert.equal(opened[0].body.signatureValue, hmacBase64('test-api-key', opened[0].body.createDateTime));
    assert.equal(calls.filter(call => call.path === '/queryInvoice').length, 0);

    const second = await issueStatement({
        db, send, creds, caseId: 'case_1', version: 1, description: '再按一次', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(second.already, true);
    assert.equal(second.invoiceNumber, 'AB12345678');
    assert.equal(calls.filter(call => call.path === '/openInvoice').length, 1);
});

test('已有發票號碼就拒絕，逾時後用 orderID 查到已開立的那張，不再開第二張', async () => {
    const previous = statementDoc();
    previous.latestVersion = 2;
    previous.invoiceStatus = 'invoiced';
    previous.invoicedVersion = 1;
    previous.invoiceNumber = 'AA00000001';
    previous.versions.push({
        version: 2,
        snapshot: previous.versions[0].snapshot,
    });
    const blocked = memoryFirestore({ 'statement_cases/case_old': previous });
    const blockedSend = gateway(() => { throw new Error('不該送出'); });
    await assert.rejects(
        () => issueStatement({
            db: blocked, send: blockedSend.send, creds, caseId: 'case_old', version: 2,
            description: '不該送出', actor: 'staff@baiqi.test', clock,
        }),
        /AA00000001/,
    );
    assert.equal(blockedSend.calls.length, 0);

    const db = memoryFirestore({ 'statement_cases/case_1': statementDoc() });
    let queries = 0;
    const { calls, send } = gateway(path => {
        if (path === '/openInvoice') {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            throw error;
        }
        if (path === '/queryInvoice') {
            queries += 1;
            if (queries === 1) return { statusCode: '3', statusDesc: '無資料', respData: null };
            return { statusCode: '0', statusDesc: '', respData: { invNo: 'AB12345678', invDate: '20261031', randomNumber: '4321', status: '0' } };
        }
        throw new Error(path);
    });
    await assert.rejects(
        () => issueStatement({
            db, send, creds, caseId: 'case_1', version: 1, description: '布品洗滌費', actor: 'staff@baiqi.test', clock,
        }),
        /aborted/i,
    );
    assert.equal(db.read('statement_cases/case_1').invoiceNumber ?? null, null);
    assert.equal(db.read('statement_cases/case_1').invoiceDraft.orderID, 'case_1-v1');
    assert.equal(calls.filter(call => call.path === '/openInvoice').length, 1);

    const recovered = await issueStatement({
        db, send, creds, caseId: 'case_1', version: 1, description: '布品洗滌費', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(recovered.invoiceNumber, 'AB12345678');
    assert.equal(recovered.already, false);
    assert.equal(calls.filter(call => call.path === '/openInvoice').length, 1);
    assert.equal(calls.filter(call => call.path === '/queryInvoice').at(-1).body.reqData.orderID, 'case_1-v1');
    assert.equal(calls.filter(call => call.path === '/queryInvoice').at(-1).body.reqData.process_type, 'B');
    assert.equal(db.read('statement_cases/case_1').invoiceStatus, 'invoiced');
});

test('汎宇拒絕時把 statusDesc 原樣丟回，沒有寫入發票號碼', async () => {
    const db = memoryFirestore({ 'statement_cases/case_1': statementDoc() });
    const { calls, send } = gateway(() => ({ statusCode: '2', statusDesc: '買方統編錯誤', respData: null }));
    await assert.rejects(
        () => issueStatement({
            db, send, creds, caseId: 'case_1', version: 1, description: '布品洗滌費', actor: 'staff@baiqi.test', clock,
        }),
        error => error.message === '買方統編錯誤',
    );
    assert.equal(db.read('statement_cases/case_1').invoiceStatus, 'ready');
    assert.equal(db.read('statement_cases/case_1').invoiceNumber ?? null, null);
    assert.equal(calls.filter(call => call.path === '/openInvoice').length, 1);
});

test('沒有 8 碼統編就拒絕開立，不會向汎宇送出', async () => {
    for (const taxId of ['', '123', '0000000000']) {
        const id = `case_${taxId || 'blank'}`;
        const db = memoryFirestore({ [`statement_cases/${id}`]: statementDoc(taxId) });
        const { calls, send } = gateway(() => { throw new Error('不該送出'); });
        await assert.rejects(
            () => issueStatement({
                db, send, creds, caseId: id, version: 1, description: '布品洗滌費', actor: 'staff@baiqi.test', clock,
            }),
            /這位客戶沒有 8 碼統編，不能開立發票/,
        );
        assert.equal(calls.length, 0);
        const saved = db.read(`statement_cases/${id}`);
        assert.equal(saved.invoiceStatus, 'ready');
        assert.equal(saved.invoiceNumber ?? null, null);
        assert.equal(saved.invoiceLock ?? null, null);
        assert.equal(saved.invoiceDraft ?? null, null);
    }
});

test('沒有 8 碼統編的發票不能作廢，不會送出', async () => {
    const doc = statementDoc('');
    doc.invoiceStatus = 'invoiced';
    doc.invoicedVersion = 1;
    doc.invoiceNumber = 'AB12345678';
    doc.invoiceDate = '2026-10-31';
    doc.provider = 'universalec';
    doc.invoiceKind = 'b2c';
    doc.invoiceBuyerId = '0000000000';
    doc.invoiceOrderId = 'case_blank-v1';
    doc.invoiceRecord = { number: 'AB12345678', method: 'electronic', date: '2026-10-31', amount: 1840, version: 1, provider: 'universalec' };
    const db = memoryFirestore({ 'statement_cases/case_blank': doc });
    const { calls, send } = gateway(() => { throw new Error('不該送出'); });
    await assert.rejects(
        () => voidStatement({ db, send, creds, caseId: 'case_blank', version: 1, reason: '開錯', actor: 'staff@baiqi.test', clock }),
        /沒有 8 碼統編，不能作廢/,
    );
    assert.equal(calls.length, 0);
    assert.equal(db.read('statement_cases/case_blank').invoiceNumber, 'AB12345678');
    assert.equal(db.read('statement_cases/case_blank').invoiceLock ?? null, null);
});

test('作廢後狀態清掉，同一版用新的 orderID 再開，而且只走 B2B', async () => {
    const db = memoryFirestore({ 'statement_cases/case_2': statementDoc() });
    let issued = 0;
    const { calls, send } = gateway(path => {
        if (path === '/openInvoice') {
            issued += 1;
            return issuedBody(issued === 1 ? 'AB12345678' : 'AB12345679');
        }
        if (path === '/cancelInvoice') {
            return { statusCode: '0', statusDesc: '', respData: { invNo: 'AB12345678', cancelDate: '20261031', cancelTime: '09:31:00' } };
        }
        throw new Error(path);
    });
    const opened = await issueStatement({
        db, send, creds, caseId: 'case_2', version: 1, description: '', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(opened.kind, 'b2b');
    const created = calls.find(call => call.path === '/openInvoice');
    assert.equal(created.body.reqData.process_type, 'B');
    assert.equal(created.body.reqData.buyerID, '87654321');
    assert.equal(created.body.reqData.buyerName, '驗證飯店股份有限公司');
    assert.equal(created.body.reqData.Details[0].description, '布品洗滌費 2026/10/01–2026/10/31');
    assert.equal(created.body.reqData.Details[0].unitprice, 1752);
    assert.equal(created.body.reqData.printMark, 'Y');
    assert.equal(created.body.reqData.donateMark, '0');

    const voided = await voidStatement({
        db, send, creds, caseId: 'case_2', version: 1, reason: '開錯抬頭', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(voided.voided, true);
    const after = db.read('statement_cases/case_2');
    assert.equal(after.invoiceStatus, 'ready');
    assert.equal(after.invoiceNumber, null);
    assert.equal(after.invoiceRecord, null);
    assert.equal(after.invoicedVersion, null);
    assert.equal(after.invoiceHistory[0].number, 'AB12345678');
    const cancel = calls.find(call => call.path === '/cancelInvoice');
    assert.equal(cancel.body.reqData.process_type, 'B');
    assert.equal(cancel.body.reqData.buyerID, '87654321');
    assert.equal(cancel.body.reqData.cancelReason, '開錯抬頭');
    assert.equal(cancel.body.reqData.invDate, '20261031');

    const again = await issueStatement({
        db, send, creds, caseId: 'case_2', version: 1, description: '布品洗滌費 2026/10/01–2026/10/31', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(again.invoiceNumber, 'AB12345679');
    assert.equal(again.kind, 'b2b');
    assert.equal(calls.filter(call => call.path === '/openInvoice').at(-1).body.reqData.orderID, 'case_2-v1-r1');
    assert.equal(calls.filter(call => call.path === '/openInvoice').at(-1).body.reqData.process_type, 'B');
    assert.equal(db.read('statement_cases/case_2').invoiceStatus, 'invoiced');
});

test('手開發票不能從這裡作廢，連線測試只查不開票', async () => {
    const manual = statementDoc();
    manual.invoiceStatus = 'invoiced';
    manual.invoicedVersion = 1;
    manual.invoiceNumber = 'ZZ00000001';
    manual.invoiceRecord = { number: 'ZZ00000001', method: 'manual', date: '2026-10-31', amount: 1840, version: 1 };
    const db = memoryFirestore({ 'statement_cases/case_3': manual });
    const { calls, send } = gateway(path => {
        if (path === '/queryInvoice') return { statusCode: '3', statusDesc: '', respData: null };
        throw new Error('不該呼叫 ' + path);
    });
    const again = await issueStatement({
        db, send, creds, caseId: 'case_3', version: 1, description: '不該送出', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(again.already, true);
    assert.equal(calls.length, 0);
    await assert.rejects(
        () => voidStatement({ db, send, creds, caseId: 'case_3', version: 1, reason: '想作廢', actor: 'staff@baiqi.test', clock }),
        /手開/,
    );
    const ping = await testConnection({ send, creds, clock });
    assert.equal(ping.ok, true);
    assert.equal(ping.message, '連線成功');
    assert.equal(calls.at(-1).path, '/queryInvoice');
    assert.equal(calls.at(-1).body.reqData.orderID, 'connection-check');
    assert.equal(calls.at(-1).body.reqData.process_type, 'B');
    assert.equal(calls.some(call => call.path === '/openInvoice'), false);
});

test('作廢失敗時把 statusDesc 丟回，帳單維持已開票', async () => {
    const doc = statementDoc();
    doc.invoiceStatus = 'invoiced';
    doc.invoicedVersion = 1;
    doc.invoiceNumber = 'AB12345678';
    doc.invoiceDate = '2026-10-31';
    doc.provider = 'universalec';
    doc.invoiceKind = 'b2b';
    doc.invoiceBuyerId = '87654321';
    doc.invoiceOrderId = 'case_1-v1';
    doc.invoiceRecord = { number: 'AB12345678', method: 'electronic', date: '2026-10-31', amount: 1840, version: 1, provider: 'universalec' };
    const db = memoryFirestore({ 'statement_cases/case_1': doc });
    const { send } = gateway(() => ({ statusCode: '2', statusDesc: '發票已上傳不可作廢', respData: null }));
    await assert.rejects(
        () => voidStatement({ db, send, creds, caseId: 'case_1', version: 1, reason: '開錯', actor: 'staff@baiqi.test', clock }),
        error => error.message === '發票已上傳不可作廢',
    );
    assert.equal(db.read('statement_cases/case_1').invoiceNumber, 'AB12345678');
});

test('網頁不放發票帳號，排程也不會開立發票', () => {
    const dispatch = readFileSync(new URL('../../../statement-dispatch.html', import.meta.url), 'utf8');
    const billing = readFileSync(new URL('../lib/billing-run.js', import.meta.url), 'utf8');
    const auto = readFileSync(new URL('../lib/auto-close.js', import.meta.url), 'utf8');
    const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(dispatch, /開立發票|issueStatementInvoice|測試電子發票連線|quoteInvoice/);
    const payments = readFileSync(new URL('../../../receivables-ui.js', import.meta.url), 'utf8');
    assert.match(payments, /確認開立/);
    assert.match(payments, /issueStatementInvoice/);
    assert.match(payments, /missingTaxIdMessage/);
    assert.match(payments, /手開發票/);
    assert.match(payments, /不會向汎宇送出作廢/);
    assert.match(payments, /結帳與寄出都不會自動開立/);
    assert.doesNotMatch(payments, /尚未串接|B2C|b2c/);
    assert.doesNotMatch(dispatch, /B2C|b2c|0000000000/);
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    assert.match(readme, /只開立 B2B/);
    assert.doesNotMatch(readme, /B2C|b2c/);
    assert.match(readme, /yyyy\/MM\/dd HH:mm:ss/);
    const deployDoc = readFileSync(new URL('../../../docs/uec-einvoice-deploy.md', import.meta.url), 'utf8');
    for (const name of ['UEC_USER_ID', 'UEC_AUTH', 'UEC_API_KEY', 'UEC_COMPANY_ID', 'UEC_ENV']) {
        assert.match(deployDoc, new RegExp(name));
    }
    assert.match(deployDoc, /https:\/\/webtest\.einvoice\.com\.tw\/einv/);
    assert.match(deployDoc, /https:\/\/web\.einvoice\.com\.tw\/einv/);
    assert.match(deployDoc, /不會自動開立發票/);
    const client = readFileSync(new URL('../lib/einvoice-client.js', import.meta.url), 'utf8');
    const issue = readFileSync(new URL('../lib/einvoice-issue.js', import.meta.url), 'utf8');
    assert.doesNotMatch(client, /process_type: kind === 'b2b' \? 'B' : 'C'|0000000000|process_type: b2b \? 'B' : 'C'/);
    assert.match(issue, /沒有 8 碼統編，不能開立發票/);
    assert.equal(dispatch.includes('EINVOICE_POS'), false);
    assert.equal(dispatch.includes('GetInvoice.ashx'), false);
    assert.equal(dispatch.includes('UEC_API_KEY'), false);
    assert.equal(dispatch.includes('UEC_AUTH'), false);
    assert.equal(billing.includes('einvoice'), false);
    assert.equal(auto.includes('openInvoice'), false);
    assert.equal(auto.includes('issueStatement'), false);
    assert.equal(index.includes('EINVOICE_SELLER_ID'), false);
    assert.equal(index.includes('EINVOICE_POS_ID'), false);
    assert.equal(index.includes('POSSN'), false);
    assert.match(index, /UEC_USER_ID/);
    assert.match(index, /UEC_AUTH/);
    assert.match(index, /UEC_API_KEY/);
    assert.match(index, /UEC_COMPANY_ID/);
    assert.match(index, /UEC_ENV/);
    assert.match(index, /defineString\('SIGNATURE_FUNCTION_REGION', \{ default: 'asia-east1' \}\)/);
    assert.equal(index.includes("defineString('FUNCTION_REGION'"), false);
    assert.match(readme, /SIGNATURE_FUNCTION_REGION=asia-east1/);
    assert.match(readme, /`FUNCTION_REGION` 是 Firebase 保留的環境變數名/);
    assert.match(readme, /artifacts cleanup policy/);
    assert.match(deployDoc, /AUTO_STATEMENTS_ENABLED=false/);
    assert.match(deployDoc, /SIGNATURE_FUNCTION_REGION=asia-east1/);
    assert.match(deployDoc, /`FUNCTION_REGION` 是 Firebase 保留的環境變數名/);
    assert.match(deployDoc, /artifacts cleanup policy/);
    const finance = readFileSync(new URL('../../../finance.html', import.meta.url), 'utf8');
    const gasUrl = finance.match(/const GAS_API_URL = "([^"]+)"/)[1];
    const envFile = readFileSync(new URL('../.env.hotel-inventory-3a1ad', import.meta.url), 'utf8');
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    for (const contents of [envFile, example]) {
        const lines = contents.split('\n');
        assert.equal(lines.includes('AUTO_STATEMENTS_ENABLED=false'), true);
        assert.equal(lines.includes('SIGNATURE_FUNCTION_REGION=asia-east1'), true);
        assert.equal(lines.includes(`FINANCE_MASTER_URL=${gasUrl}`), true);
        assert.equal(lines.some(line => line.startsWith('FUNCTION_REGION=')), false);
    }
    const schedule = index.slice(index.indexOf('export const autoStatementOnBillingDay'), index.indexOf('function staffEmail'));
    assert.equal(schedule.includes('issueStatement'), false);
    assert.equal(schedule.includes('openInvoice'), false);
    assert.equal(schedule.includes('einvoiceSecrets'), false);
});
