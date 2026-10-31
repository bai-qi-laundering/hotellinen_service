import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteInvoice, splitTaxInclusive } from '../lib/einvoice-amount.js';
import { payableAmount } from '../lib/statement-case.js';
import {
    b2bCreatePayload,
    b2bVoidPayload,
    b2cCreatePayload,
    b2cVoidPayload,
    buildRequestBody,
    fourDigitRandom,
    numbersFromZ21,
    rangeFromA01,
} from '../lib/einvoice-client.js';
import { issueStatement, voidStatement, testConnection } from '../lib/einvoice-issue.js';

const creds = { SELLERID: '12345678', POSID: 'T001', POSSN: 'test_possn_key_123' };
const seller = { id: '12345678', name: '百麒國際股份有限公司', address: '高雄市' };
const clock = () => new Date('2026-10-31T01:30:00.000Z');

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

test('含稅總額四捨五入後拆成未稅與 5% 稅，兩者加回總額', () => {
    assert.deepEqual(splitTaxInclusive(1840), { total: 1840, sales: 1752, tax: 88, rate: '0.05' });
    assert.deepEqual(splitTaxInclusive(107), { total: 107, sales: 102, tax: 5, rate: '0.05' });
    assert.deepEqual(splitTaxInclusive(10.5), { total: 11, sales: 10, tax: 1, rate: '0.05' });
    assert.deepEqual(splitTaxInclusive(10.4), { total: 10, sales: 10, tax: 0, rate: '0.05' });
    assert.equal(splitTaxInclusive(1840).sales + splitTaxInclusive(1840).tax, 1840);
    assert.throws(() => splitTaxInclusive(0), /1 元以上/);
    const snapshot = statementDoc().versions[0].snapshot;
    assert.equal(quoteInvoice(snapshot).total, payableAmount(snapshot));
    assert.equal(quoteInvoice(snapshot).buyer.kind, 'b2b');
    assert.equal(quoteInvoice({ ...snapshot, profile: { name: '散客', taxId: '' } }).buyer.kind, 'b2c');
    assert.equal(quoteInvoice({ ...snapshot, profile: { name: '散客', taxId: '' } }).buyer.taxId, '0000000000');
    assert.throws(() => quoteInvoice({ ...snapshot, profile: { name: '散客', taxId: '123' } }), /8 碼/);
});

test('開立與作廢封包沿用汎宇的 Invoice / INDEX 外包', () => {
    const systime = '2026-10-31 09:30:00';
    const y01 = buildRequestBody({ functionCode: 'Y01', payload: {}, wrapper: 'INDEX', creds, systime });
    assert.equal(y01.INDEX.FUNCTIONCODE, 'Y01');
    assert.equal(y01.INDEX.SELLERID, '12345678');
    assert.equal(y01.INDEX.POSID, 'T001');
    assert.equal(y01.INDEX.POSSN, creds.POSSN);
    assert.equal(y01.INDEX.ACCOUNT, '0000000000000000');
    assert.equal(y01.INDEX.APPID, '0000000000000000');
    assert.equal(y01.INDEX.ServerType, 'invioce_ml');
    assert.equal(y01.INDEX.SYSTIME, systime);

    const z21 = buildRequestBody({ functionCode: 'Z21', payload: {}, wrapper: 'INDEX', creds, systime });
    assert.equal(z21.INDEX.FUNCTIONCODE, 'Z21');
    assert.equal(z21.INDEX.ServerType, 'invioce_ml');

    const b2b = b2bCreatePayload({
        number: 'AB12345678', ymd: '20261031', hms: '093000', seller, buyer: { taxId: '87654321', name: '驗證飯店股份有限公司' },
        description: '布品洗滌費 2026/10/01–2026/10/31', sales: 1752, tax: 88, total: 1840, address: '高雄市',
    });
    const wrapped = buildRequestBody({ functionCode: 'A0401', payload: b2b, wrapper: 'Invoice', creds, systime });
    assert.equal(wrapped.Invoice.INVOICE_CODE, 'A0401');
    assert.equal(wrapped.Invoice.POSSN, creds.POSSN);
    assert.equal(wrapped.Invoice.ServerType, 'invioce_ml');
    assert.equal(wrapped.Invoice.Main.InvoiceType, '07');
    assert.equal(wrapped.Invoice.Main.Buyer.Identifier, '87654321');
    assert.equal(wrapped.Invoice.Amount.SalesAmount, '1752');
    assert.equal(wrapped.Invoice.Amount.TaxAmount, '88');
    assert.equal(wrapped.Invoice.Amount.TotalAmount, '1840');
    assert.equal(wrapped.Invoice.Details.ProductItem[0].Description, '布品洗滌費 2026/10/01–2026/10/31');
    assert.equal(wrapped.INDEX, undefined);

    const b2c = b2cCreatePayload({
        number: 'AB12345679', ymd: '20261031', hms: '093000', seller, buyer: { taxId: '0000000000', name: '散客' },
        description: '布品洗滌費 2026/10/01–2026/10/31', sales: 100, tax: 5, total: 105, random: '4321',
    });
    assert.equal(b2c.INVOICE_CODE, 'C0401N');
    assert.equal(b2c.Main.RandomNumber, '4321');
    assert.equal(b2c.Main.Buyer.Identifier, '0000000000');
    assert.equal(b2c.Amount.FreeTaxSalesAmount, '0');

    const a0501 = b2bVoidPayload({
        number: 'AB12345678', invoiceYmd: '20261031', buyerId: '87654321', sellerId: '12345678',
        cancelYmd: '20261031', cancelHms: '100000', reason: '開錯',
    });
    assert.equal(a0501.INVOICE_CODE, 'A0501');
    assert.equal(a0501.CancelInvoiceNumber, 'AB12345678');
    const c0501 = b2cVoidPayload({
        number: 'AB12345679', invoiceYmd: '20261031', buyerId: '0000000000', sellerId: '12345678',
        cancelYmd: '20261031', cancelHms: '100000', reason: '開錯',
    });
    assert.equal(c0501.INVOICE_CODE, 'C0501');
    assert.equal(c0501.INVOICE_NUMBER, 'AB12345679');
    assert.equal(fourDigitRandom('AB12345678'), fourDigitRandom('AB12345678'));
    assert.match(fourDigitRandom('AB12345678'), /^\d{4}$/);
});

test('Z21 明細與 A01 區間都能變成發票號碼', () => {
    assert.deepEqual(numbersFromZ21({ INDEX: { INVOICEDATA: [{ INVOICE_NUMBER: 'bx00000001', RANDOMNUMBER: '1234' }] } }), [
        { number: 'BX00000001', random: '1234' },
    ]);
    const range = rangeFromA01({ INDEX: { INVOICEHEADER: 'DC', INVOICESTART: '51705750', INVOICEEND: '51705751' } });
    assert.deepEqual(range, [
        { number: 'DC51705750', random: '' },
        { number: 'DC51705751', random: '' },
    ]);
});

function gateway(numbers = [{ INVOICE_NUMBER: 'AB12345678', RANDOMNUMBER: '4321' }, { INVOICE_NUMBER: 'AB12345679', RANDOMNUMBER: '1111' }]) {
    const calls = [];
    const send = async body => {
        calls.push(body);
        const code = body.INDEX?.FUNCTIONCODE || body.Invoice?.INVOICE_CODE;
        if (code === 'Z21') return { INDEX: { REPLY: '1', INVOICEDATA: numbers } };
        if (code === 'A0401' || code === 'C0401N' || code === 'A0501' || code === 'C0501') return { Invoice: { REPLY: '1', MESSAGE: '成功' } };
        if (code === 'Y01') return { INDEX: { REPLY: '1', MESSAGE: '連線成功', SYSTIME: '2026-10-31 09:30:00' } };
        throw new Error('未預期的功能代碼 ' + code);
    };
    return { calls, send };
}

test('同一版對帳單只會向汎宇開一次，第二次直接回原號碼', async () => {
    const db = memoryFirestore({ 'statement_cases/case_1': statementDoc() });
    const { calls, send } = gateway();
    const first = await issueStatement({
        db, send, creds, seller, caseId: 'case_1', version: 1, description: '布品洗滌費 2026/10/01–2026/10/31', actor: 'staff@baiqi.test', clock,
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
    assert.equal(saved.versions[0].invoiceNumber, 'AB12345678');
    assert.equal(saved.invoiceRaw.Invoice.REPLY, '1');
    assert.equal(saved.invoiceRaw.Invoice.POSSN, undefined);
    const createCalls = calls.filter(body => body.Invoice?.INVOICE_CODE === 'A0401');
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].Invoice.Main.InvoiceNumber, 'AB12345678');

    const second = await issueStatement({
        db, send, creds, seller, caseId: 'case_1', version: 1, description: '再按一次', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(second.already, true);
    assert.equal(second.invoiceNumber, 'AB12345678');
    assert.equal(calls.filter(body => body.Invoice?.INVOICE_CODE === 'A0401').length, 1);
});

test('沒有統編走 C0401N，作廢後狀態清掉，同一版可以再開一張新的', async () => {
    const db = memoryFirestore({ 'statement_cases/case_2': statementDoc('') });
    const { calls, send } = gateway();
    const issued = await issueStatement({
        db, send, creds, seller, caseId: 'case_2', version: 1, description: '', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(issued.kind, 'b2c');
    const created = calls.find(body => body.Invoice?.INVOICE_CODE === 'C0401N');
    assert.ok(created);
    assert.equal(created.Invoice.Main.Buyer.Identifier, '0000000000');
    assert.equal(created.Invoice.Main.Buyer.Name, '驗證飯店股份有限公司');
    assert.equal(created.Invoice.Details.ProductItem[0].Description, '布品洗滌費 2026/10/01–2026/10/31');
    assert.equal(created.Invoice.Main.RandomNumber, '4321');

    const voided = await voidStatement({
        db, send, creds, seller, caseId: 'case_2', version: 1, reason: '開錯抬頭', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(voided.voided, true);
    const after = db.read('statement_cases/case_2');
    assert.equal(after.invoiceStatus, 'ready');
    assert.equal(after.invoiceNumber, null);
    assert.equal(after.invoiceRecord, null);
    assert.equal(after.invoicedVersion, null);
    assert.equal(after.invoiceHistory[0].number, 'AB12345678');
    assert.equal(calls.filter(body => body.Invoice?.INVOICE_CODE === 'C0501').length, 1);
    assert.equal(calls.find(body => body.Invoice?.INVOICE_CODE === 'C0501').Invoice.CANCEL_REASON, '開錯抬頭');

    const again = await issueStatement({
        db, send, creds, seller, caseId: 'case_2', version: 1, description: '布品洗滌費 2026/10/01–2026/10/31', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(again.invoiceNumber, 'AB12345679');
    assert.equal(db.read('statement_cases/case_2').invoiceStatus, 'invoiced');
});

test('手開發票不能從這裡作廢，連線測試只打 Y01', async () => {
    const manual = statementDoc();
    manual.invoiceStatus = 'invoiced';
    manual.invoicedVersion = 1;
    manual.invoiceNumber = 'ZZ00000001';
    manual.invoiceRecord = { number: 'ZZ00000001', method: 'manual', date: '2026-10-31', amount: 1840, version: 1 };
    const db = memoryFirestore({ 'statement_cases/case_3': manual });
    const { calls, send } = gateway();
    const again = await issueStatement({
        db, send, creds, seller, caseId: 'case_3', version: 1, description: '不該送出', actor: 'staff@baiqi.test', clock,
    });
    assert.equal(again.already, true);
    assert.equal(calls.length, 0);
    await assert.rejects(
        () => voidStatement({ db, send, creds, seller, caseId: 'case_3', version: 1, reason: '想作廢', actor: 'staff@baiqi.test', clock }),
        /手開/,
    );
    const ping = await testConnection({ send, creds, clock });
    assert.equal(ping.ok, true);
    assert.equal(ping.message, '連線成功');
    assert.equal(calls.at(-1).INDEX.FUNCTIONCODE, 'Y01');
});

test('網頁不放發票帳號，排程也不會開立發票', () => {
    const dispatch = readFileSync(new URL('../../../statement-dispatch.html', import.meta.url), 'utf8');
    const billing = readFileSync(new URL('../lib/billing-run.js', import.meta.url), 'utf8');
    const auto = readFileSync(new URL('../lib/auto-close.js', import.meta.url), 'utf8');
    assert.match(dispatch, /開立發票/);
    assert.match(dispatch, /issueStatementInvoice/);
    assert.match(dispatch, /不會在結帳日或登記寄出時自動開立/);
    assert.equal(dispatch.includes('EINVOICE_POS'), false);
    assert.equal(dispatch.includes('GetInvoice.ashx'), false);
    assert.equal(billing.includes('einvoice'), false);
    assert.equal(auto.includes('A0401'), false);
    assert.equal(auto.includes('issueStatement'), false);
});
