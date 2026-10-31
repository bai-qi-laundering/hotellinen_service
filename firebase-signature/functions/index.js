import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString, defineBoolean } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { taipeiDate } from './lib/auto-close.js';
import { BILLING_CRON, BILLING_TIME_ZONE } from './lib/billing-schedule.js';
import { handleBillingSchedule } from './lib/billing-run.js';

if (BILLING_CRON !== '30 9 25,28,29,30,31 * *' || BILLING_TIME_ZONE !== 'Asia/Taipei') {
    throw new Error('結帳排程常數與部署字串不一致');
}

initializeApp();
const db = getFirestore();
const enabled = defineBoolean('AUTO_STATEMENTS_ENABLED', { default: false });
const masterUrl = defineString('FINANCE_MASTER_URL');
const region = defineString('FUNCTION_REGION', { default: 'asia-east1' });

// 簽收當下不產單。Cloud Scheduler 只在結帳日 09:30（台北）啟動；
// 不是結帳日、或開關沒開時，函式直接結束，不讀 Firestore。
export const autoStatementOnBillingDay = onSchedule({
    schedule: '30 9 25,28,29,30,31 * *',
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
