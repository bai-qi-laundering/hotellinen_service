import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString, defineBoolean, defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { taipeiDate } from './lib/auto-close.js';
import { BILLING_CRON, BILLING_TIME_ZONE } from './lib/billing-schedule.js';
import { handleBillingSchedule } from './lib/billing-run.js';
import { hostForEnv } from './lib/einvoice-client.js';
import { issueStatement, testConnection, voidStatement } from './lib/einvoice-issue.js';

if (BILLING_CRON !== '30 9 1,25,28,29,30,31 * *' || BILLING_TIME_ZONE !== 'Asia/Taipei') {
    throw new Error('結帳排程常數與部署字串不一致');
}

initializeApp();
const db = getFirestore();
const enabled = defineBoolean('AUTO_STATEMENTS_ENABLED', { default: false });
const masterUrl = defineString('FINANCE_MASTER_URL');
// FUNCTION_REGION 是 Firebase 保留名稱，不能寫進 .env，非互動部署會失敗。
const region = defineString('SIGNATURE_FUNCTION_REGION', { default: 'asia-east1' });
const uecUserId = defineSecret('UEC_USER_ID');
const uecAuth = defineSecret('UEC_AUTH');
const uecApiKey = defineSecret('UEC_API_KEY');
const uecCompanyId = defineSecret('UEC_COMPANY_ID');
const uecEnv = defineSecret('UEC_ENV');
const einvoiceStaffEmails = defineSecret('EINVOICE_STAFF_EMAILS');
const einvoiceSecrets = [uecUserId, uecAuth, uecApiKey, uecCompanyId, uecEnv, einvoiceStaffEmails];

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
    const creds = {
        companyID: String(uecCompanyId.value() || '').trim() || '96842769',
        userID: String(uecUserId.value() || '').trim(),
        authPlain: String(uecAuth.value() || '').trim(),
        apiKey: String(uecApiKey.value() || '').trim(),
    };
    if (!creds.userID || !creds.authPlain || !creds.apiKey) {
        throw new HttpsError('failed-precondition', '電子發票帳號未設定完整。');
    }
    if (!/^\d{8}$/.test(creds.companyID)) {
        throw new HttpsError('failed-precondition', '賣方統編需為 8 碼。');
    }
    const env = String(uecEnv.value() || '').trim().toLowerCase();
    return { creds, host: hostForEnv(env) };
}

// 開立與作廢都不自動重送。逾時改由 /queryInvoice 確認，避免同一張 orderID 送兩次。
async function postEinvoice(url, body) {
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
        });
    } catch (error) {
        error.uncertain = true;
        throw error;
    }
    const text = await response.text();
    let json = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch {
            const error = new Error(response.ok ? '電子發票服務回應不是 JSON。' : `電子發票服務回應 HTTP ${response.status}`);
            error.httpStatus = response.status;
            if (!response.ok && response.status >= 500) error.uncertain = true;
            if (response.ok) error.uncertain = true;
            throw error;
        }
    }
    if (!response.ok) {
        const error = new Error(String(json?.statusDesc || '').trim() || `電子發票服務回應 HTTP ${response.status}`);
        error.httpStatus = response.status;
        if (response.status >= 500) error.uncertain = true;
        throw error;
    }
    return json || {};
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
            send: (path, body) => postEinvoice(`${config.host}${path}`, body),
            creds: config.creds,
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
            send: (path, body) => postEinvoice(`${config.host}${path}`, body),
            creds: config.creds,
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
            send: (path, body) => postEinvoice(`${config.host}${path}`, body),
            creds: config.creds,
        });
    } catch (error) {
        throw callableError(error);
    }
});
