// 汎宇電子發票 API（REST JSON）。
// 測試機 https://webtest.einvoice.com.tw/einv/<path>
// 正式機 https://web.einvoice.com.tw/einv/<path>
//
// 簽章結論（對過範例 PDF，沒有打正式或測試主機）：
// 規格寫「用 APIKey 將 createDateTime 做 Shar256 簽章，再 BASE64」。
// 範例裡 /openInvoice 與 /getInvoiceAssignNo 的 createDateTime 都是
// 20190820042311，signatureValue 也完全相同，reqData 卻不同，所以簽的是
// createDateTime，不是整包 JSON。
// 範例 signatureValue 解 base64 是 32 bytes，符合 SHA-256。
// 實作採用 HMAC-SHA256，金鑰是 APIKey（UTF-8）、訊息是 createDateTime（UTF-8），
// 輸出 base64。這和規格文字以及公開的汎宇 Web API 用戶端一致。
// 範例 PDF 沒有附 APIKey。用範例密碼 A15989995（auth 的 base64 原文）做 HMAC，
// 或對 createDateTime 做純 SHA-256，都對不上範例的 signatureValue。
// 因此演算法可以確定是「只簽時間、再 base64」，但位元組要等汎宇提供 APIKey
// 或一組已知向量才能核對。

import { createHmac } from 'node:crypto';

export const DEFAULT_COMPANY_ID = '96842769';
export const TEST_HOST = 'https://webtest.einvoice.com.tw/einv';
export const PROD_HOST = 'https://web.einvoice.com.tw/einv';

const EXAMPLE_SIGNATURES = {
    '20190820042311': '4lgHKW+oJafFLpPTDmmXXS9sOjkYZQFmJo20OZdzuDg=',
    '20190820042837': 'Dvq0tNzoQGjB7h/D0Sj+u886jyt7D3bdm/bFxEjDyE0=',
};

export function exampleSignature(createDateTime) {
    return EXAMPLE_SIGNATURES[createDateTime] || '';
}

export function hostForEnv(env) {
    return String(env || '').trim().toLowerCase() === 'prod' ? PROD_HOST : TEST_HOST;
}

export function taipeiDateTime(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    let hour = get('hour');
    if (hour === '24') hour = '00';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const minute = get('minute');
    const second = get('second');
    return {
        createDateTime: `${year}${month}${day}${hour}${minute}${second}`,
        isoDate: `${year}-${month}-${day}`,
        ymd: `${year}${month}${day}`,
    };
}

export function encodeAuth(plain) {
    return Buffer.from(String(plain ?? ''), 'utf8').toString('base64');
}

export function signatureValue(apiKey, createDateTime) {
    const key = String(apiKey ?? '');
    const message = String(createDateTime ?? '');
    if (!key) throw new Error('電子發票 APIKey 未設定。');
    if (!/^\d{14}$/.test(message)) throw new Error('createDateTime 必須是台北時間 14 碼。');
    return createHmac('sha256', key).update(message, 'utf8').digest('base64');
}

export function normalizeCreds(creds) {
    const companyID = String(creds?.companyID || '').trim() || DEFAULT_COMPANY_ID;
    const userID = String(creds?.userID || '').trim();
    const authPlain = String(creds?.authPlain ?? '').trim();
    const apiKey = String(creds?.apiKey || '').trim();
    if (!/^\d{8}$/.test(companyID)) throw new Error('賣方統編需為 8 碼。');
    if (!userID || !authPlain || !apiKey) throw new Error('電子發票帳號未設定完整。');
    return { companyID, userID, authPlain, apiKey };
}

export function buildEnvelope({ companyID, userID, authPlain, apiKey, createDateTime, reqData }) {
    const creds = normalizeCreds({ companyID, userID, authPlain, apiKey });
    return {
        companyID: creds.companyID,
        userID: creds.userID,
        auth: encodeAuth(creds.authPlain),
        createDateTime,
        signatureValue: signatureValue(creds.apiKey, createDateTime),
        reqData,
    };
}

// 同一張帳單、同一個開立次數用同一個 orderID。賣方統編 + orderID 在汎宇必須唯一，
// 重試才不會開成第二張。作廢後的下一張才換 -rN。
export function orderIdFor(caseId, version, reissue = 0) {
    const versionNo = Number(version);
    const retry = Number(reissue) || 0;
    const safe = String(caseId || '').replace(/[^0-9A-Za-z_-]/g, '');
    const suffix = `-v${versionNo}${retry > 0 ? `-r${retry}` : ''}`;
    const room = 50 - suffix.length;
    if (safe && safe.length <= room) return `${safe}${suffix}`;
    let hash = 0;
    for (const ch of String(caseId || '')) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
    const compact = (safe || 'stmt').slice(0, Math.max(1, room)) || `s${hash.toString(16)}`;
    const id = `${compact.slice(0, room)}${suffix}`;
    return id.slice(0, 50);
}

function intAmount(value, label) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${label}需為 0 以上的整數。`);
    return n;
}

export function openInvoicePayload({ orderID, sellerId, buyer, description, sales, tax, total }) {
    const buyerName = String(buyer?.name || '').trim();
    if (!buyerName || /^0+$/.test(buyerName)) throw new Error('買方名稱不可為 0。');
    if (buyerName.length > 60) throw new Error('發票抬頭請在 60 字以內。');
    const buyerID = String(buyer?.taxId || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(buyerID)) throw new Error('這位客戶沒有 8 碼統編，不能開立發票。');
    const text = String(description || '').trim();
    if (!text) throw new Error('請填品項說明。');
    if (text.length > 500) throw new Error('品項說明請在 500 字以內。');
    const salesAmount = intAmount(sales, '未稅銷售額');
    const taxAmount = intAmount(tax, '稅額');
    const totalAmount = intAmount(total, '含稅金額');
    if (totalAmount < 1) throw new Error('含稅金額需為 1 元以上的整數，這張沒有開立。');
    if (salesAmount + taxAmount !== totalAmount) throw new Error('未稅加稅額必須等於含稅金額，這張沒有開立。');
    return {
        orderID,
        process_type: 'B',
        sellerID: sellerId,
        buyerID,
        buyerName,
        invoiceType: '07',
        donateMark: '0',
        printMark: 'Y',
        salesAmount,
        freetaxSalesamount: 0,
        zerotaxSalesamount: 0,
        taxType: '1',
        taxrate: 0.05,
        taxAmount,
        totalAmount,
        Details: [{
            description: text,
            quantity: 1,
            unitprice: salesAmount,
            amount: salesAmount,
            sequenceNumber: '0001',
            taxType: '1',
        }],
    };
}

export function cancelInvoicePayload({ orderID, sellerId, buyerId, invNo, invDate, reason }) {
    const why = String(reason || '').trim();
    if (!why) throw new Error('請填寫作廢原因。');
    if (why.length > 20) throw new Error('作廢原因請在 20 字以內。');
    const buyerID = String(buyerId || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(buyerID)) throw new Error('這張發票沒有 8 碼統編，不能作廢。');
    return {
        orderID,
        process_type: 'B',
        sellerID: sellerId,
        buyerID,
        invNo: String(invNo || '').trim(),
        invDate: String(invDate || ''),
        cancelReason: why,
    };
}

export function queryInvoicePayload({ orderID, sellerId }) {
    return {
        orderID,
        process_type: 'B',
        sellerID: sellerId,
    };
}

export function parseResponse(json) {
    const statusCode = json?.statusCode == null ? '' : String(json.statusCode).trim();
    const statusDesc = String(json?.statusDesc || '').trim();
    return {
        statusCode,
        statusDesc,
        respData: json?.respData ?? null,
        ok: statusCode === '0',
    };
}

export function isDuplicate(parsed) {
    return /重複|已存在|已開立|already|duplicate/i.test(String(parsed?.statusDesc || ''));
}

export function isUncertain(error) {
    if (!error) return false;
    if (error.uncertain) return true;
    const name = String(error.name || '');
    if (name === 'AbortError' || name === 'TimeoutError') return true;
    return /timeout|timed out|aborted|逾時|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(String(error.message || ''));
}

export function issuedFrom(respData, fallbackDate = '') {
    const data = respData && typeof respData === 'object' && !Array.isArray(respData) ? respData : {};
    const number = String(data.invNo || '').trim().toUpperCase();
    if (!/^[A-Z]{2}\d{8}$/.test(number)) return null;
    const status = data.status == null || data.status === '' ? '0' : String(data.status);
    if (status === '1' || status === '3') return null;
    return {
        number,
        date: isoFromCompact(data.invDate) || fallbackDate,
        randomNumber: String(data.randomNumber || data.randomnumber || ''),
    };
}

export function publicResponse(json) {
    const copy = json && typeof json === 'object' ? JSON.parse(JSON.stringify(json)) : {};
    for (const box of [copy, copy.reqData]) {
        if (box && typeof box === 'object') {
            delete box.auth;
            delete box.signatureValue;
            delete box.userID;
            delete box.apiKey;
            delete box.POSSN;
        }
    }
    return copy;
}

export function isoFromCompact(ymd) {
    const text = String(ymd || '');
    if (!/^\d{8}$/.test(text)) return '';
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export function ymdCompact(isoDate) {
    const text = String(isoDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('發票日期不完整，不能作廢。');
    return text.replace(/-/g, '');
}
