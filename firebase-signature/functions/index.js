import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString, defineBoolean, defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { taipeiDate } from './lib/auto-close.js';
import { BILLING_CRON, BILLING_TIME_ZONE } from './lib/billing-schedule.js';
import { handleBillingSchedule } from './lib/billing-run.js';
import { issueStatement, testConnection, voidStatement } from './lib/einvoice-issue.js';

if (BILLING_CRON !== '30 9 1,25,28,29,30,31 * *' || BILLING_TIME_ZONE !== 'Asia/Taipei') {
    throw new Error('結帳排程常數與部署字串不一致');
}

initializeApp();
const db = getFirestore();
const enabled = defineBoolean('AUTO_STATEMENTS_ENABLED', { default: false });
const masterUrl = defineString('FINANCE_MASTER_URL');
const region = defineString('FUNCTION_REGION', { default: 'asia-east1' });
const einvoiceSellerId = defineSecret('EINVOICE_SELLER_ID');
const einvoicePosId = defineSecret('EINVOICE_POS_ID');
const einvoicePosSn = defineSecret('EINVOICE_POS_SN');
const einvoiceStaffEmails = defineSecret('EINVOICE_STAFF_EMAILS');
const einvoiceBaseUrl = defineString('EINVOICE_BASE_URL', {
    default: 'https://epostw.einvoice.com.tw/GetInvoice.ashx',
});
const einvoiceSellerName = defineString('EINVOICE_SELLER_NAME', { default: '百麒國際股份有限公司' });
const einvoiceSellerAddress = defineString('EINVOICE_SELLER_ADDRESS', { default: '' });
const einvoiceSecrets = [einvoiceSellerId, einvoicePosId, einvoicePosSn, einvoiceStaffEmails];

// 簽收當下不產單。Cloud Scheduler 只在結帳日 09:30（台北）啟動；
// 不是結帳日、或開關沒開時，函式直接結束，不讀 Firestore。
export const autoStatementOnBillingDay = onSchedule({
    schedule: '30 9 1,25,28,29,30,31 * *',
    timeZone: 'Asia/Taipei',
    region,
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 1,
    retryCount: 2,
}, async event => {
    const date = taipeiDate(event.scheduleTime || new Date());
    const result = await handleBillingSchedule({
        date,
        enabled: enabled.value(),
        db,
        masterUrl: masterUrl.value(),
        logger,
    });
    if (result.failures?.length) {
        logger.error('auto_statement_partial_failure', { date, failures: result.failures });
        throw new Error(`有 ${result.failures.length} 家結帳單未完成，將重試已完成以外的客戶`);
    }
});

function staffEmail(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', '請先用員工 Google 帳號登入後再操作電子發票。');
    }
    const email = String(request.auth.token?.email || '').trim().toLowerCase();
    const allow = String(einvoiceStaffEmails.value() || '')
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    if (!allow.length) {
        throw new HttpsError('failed-precondition', '尚未設定可開票的員工信箱。');
    }
    if (!email || !allow.includes(email)) {
        throw new HttpsError('permission-denied', '這個帳號不能開立或作廢發票。');
    }
    return email;
}

function einvoiceConfig() {
    const url = String(einvoiceBaseUrl.value() || '').trim();
    if (!url.startsWith('https://')) throw new HttpsError('failed-precondition', '電子發票網址未設定。');
    const creds = {
        SELLERID: String(einvoiceSellerId.value() || '').trim(),
        POSID: String(einvoicePosId.value() || '').trim(),
        POSSN: String(einvoicePosSn.value() || '').trim(),
    };
    if (!creds.SELLERID || !creds.POSID || !creds.POSSN) {
        throw new HttpsError('failed-precondition', '電子發票帳號未設定完整。');
    }
    return {
        creds,
        seller: {
            id: creds.SELLERID,
            name: String(einvoiceSellerName.value() || '百麒國際股份有限公司').trim(),
            address: String(einvoiceSellerAddress.value() || '').trim(),
        },
        url,
    };
}

async function postEinvoice(url, body) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(20000),
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`電子發票服務回應 HTTP ${response.status}`);
            return text ? JSON.parse(text) : {};
        } catch (error) {
            lastError = error;
            if (String(error?.message || '').startsWith('電子發票服務回應')) throw error;
            await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
        }
    }
    throw lastError || new Error('電子發票服務連線失敗。');
}

function callableError(error) {
    if (error instanceof HttpsError) return error;
    const message = error?.message || '電子發票沒有完成。';
    logger.error('einvoice_failed', { message });
    return new HttpsError('failed-precondition', message);
}

const einvoiceOptions = {
    region,
    secrets: einvoiceSecrets,
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
};

// 只有送件中心按確認後才會進來。結帳日排程不呼叫這兩個函式。
export const issueStatementInvoice = onCall(einvoiceOptions, async request => {
    try {
        const actor = staffEmail(request);
        const caseId = String(request.data?.caseId || '').trim();
        const version = Number(request.data?.version);
        if (!caseId || !Number.isInteger(version)) throw new HttpsError('invalid-argument', '缺少帳單或版本。');
        const config = einvoiceConfig();
        return await issueStatement({
            db,
            send: body => postEinvoice(config.url, body),
            creds: config.creds,
            seller: config.seller,
            caseId,
            version,
            description: request.data?.description,
            actor,
        });
    } catch (error) {
        throw callableError(error);
    }
});

export const voidStatementInvoice = onCall(einvoiceOptions, async request => {
    try {
        const actor = staffEmail(request);
        const caseId = String(request.data?.caseId || '').trim();
        const version = Number(request.data?.version);
        if (!caseId || !Number.isInteger(version)) throw new HttpsError('invalid-argument', '缺少帳單或版本。');
        const config = einvoiceConfig();
        return await voidStatement({
            db,
            send: body => postEinvoice(config.url, body),
            creds: config.creds,
            seller: config.seller,
            caseId,
            version,
            reason: request.data?.reason,
            actor,
        });
    } catch (error) {
        throw callableError(error);
    }
});

export const testEInvoiceConnection = onCall(einvoiceOptions, async request => {
    try {
        staffEmail(request);
        const config = einvoiceConfig();
        return await testConnection({
            send: body => postEinvoice(config.url, body),
            creds: config.creds,
        });
    } catch (error) {
        throw callableError(error);
    }
});
