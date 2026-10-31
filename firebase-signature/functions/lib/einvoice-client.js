// 汎宇電商電子發票 POS Web Service（JSON、MIG 4.1）。
// 封包形狀對照 mcp-universalec-e-invoice 的 einvoice_client.py 與 B2B/B2C 工具。
//
// 規格裡沒寫死、這裡採用的假設：
// - InvoiceType 用「07」（一般稅額），和該參考專案的測試與範例相同。
// - TaxType 用「1」（應稅），TaxRate 用「0.05」。
// - DonateMark「0」、PrintMark「Y」、不帶載具、不捐贈。沒有統編的 B2C 必須列印。
// - 無統編時買方代號用 0000000000，名稱用發票抬頭。
// - 成功與否看 REPLY === "1"（字串）。
// - 發票號碼優先用 Z21 的 INVOICEDATA（含隨機碼）。沒有隨機碼時，用發票號碼做出固定的 4 碼，重試不會換碼。
// - A01 只給字軌區間、不給每張隨機碼。Z21 沒有明細時才用 A01 區間依序取號。

const INDEX_EXTRAS = new Set(['A01', 'C01', 'Y01', 'Z21', 'Z22']);

export function taipeiParts(date = new Date()) {
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
    return {
        systime: `${year}-${month}-${day} ${hour}:${get('minute')}:${get('second')}`,
        ymd: `${year}${month}${day}`,
        hms: `${hour}${get('minute')}${get('second')}`,
        isoDate: `${year}-${month}-${day}`,
    };
}

export function buildRequestBody({ functionCode, payload = {}, wrapper = 'INDEX', creds, systime }) {
    if (!creds?.SELLERID || !creds?.POSID || !creds?.POSSN) {
        throw new Error('電子發票帳號未設定完整。');
    }
    if (wrapper === 'INDEX') {
        const index = {
            FUNCTIONCODE: functionCode,
            SELLERID: creds.SELLERID,
            POSID: creds.POSID,
            POSSN: creds.POSSN,
            SYSTIME: systime,
        };
        if (INDEX_EXTRAS.has(functionCode)) {
            Object.assign(index, {
                ACCOUNT: '0000000000000000',
                APPID: '0000000000000000',
                ServerType: 'invioce_ml',
                REPLY: '',
                MESSAGE: '',
                VERIONUPDATE: '',
                EcrId: '',
                APPVSERION: '',
            });
        }
        Object.assign(index, payload);
        return { INDEX: index };
    }
    if (wrapper === 'Invoice') {
        return {
            Invoice: {
                POSSN: creds.POSSN,
                POSID: creds.POSID,
                SELLERID: creds.SELLERID,
                SYSTIME: systime,
                ACCOUNT: '0000000000000000',
                APPID: '0000000000000000',
                ServerType: 'invioce_ml',
                ...payload,
            },
        };
    }
    throw new Error('不支援的電子發票封包。');
}

export function productItem(description, sales) {
    return {
        Description: description,
        Quantity: '1',
        UnitPrice: String(sales),
        TaxType: '1',
        Amount: String(sales),
        SequenceNumber: '1',
    };
}

export function b2bCreatePayload({ number, ymd, hms, seller, buyer, description, sales, tax, total, address }) {
    const sellerBody = { Identifier: seller.id, Name: seller.name };
    if (address) sellerBody.Address = address;
    return {
        INVOICE_CODE: 'A0401',
        Main: {
            InvoiceNumber: number,
            InvoiceDate: ymd,
            InvoiceTime: hms,
            Seller: sellerBody,
            Buyer: { Identifier: buyer.taxId, Name: buyer.name },
            InvoiceType: '07',
            DonateMark: '0',
            PrintMark: 'Y',
        },
        Details: { ProductItem: [productItem(description, sales)] },
        Amount: {
            SalesAmount: String(sales),
            TaxType: '1',
            TaxRate: '0.05',
            TaxAmount: String(tax),
            TotalAmount: String(total),
        },
    };
}

export function b2cCreatePayload({ number, ymd, hms, seller, buyer, description, sales, tax, total, random }) {
    return {
        INVOICE_CODE: 'C0401N',
        Main: {
            InvoiceNumber: number,
            InvoiceDate: ymd,
            InvoiceTime: hms,
            Seller: { Identifier: seller.id },
            Buyer: { Identifier: buyer.taxId, Name: buyer.name },
            InvoiceType: '07',
            DonateMark: '0',
            PrintMark: 'Y',
            RandomNumber: random,
        },
        Details: { ProductItem: [productItem(description, sales)] },
        Amount: {
            SalesAmount: String(sales),
            FreeTaxSalesAmount: '0',
            ZeroTaxSalesAmount: '0',
            TaxType: '1',
            TaxRate: '0.05',
            TaxAmount: String(tax),
            TotalAmount: String(total),
        },
    };
}

export function b2bVoidPayload({ number, invoiceYmd, buyerId, sellerId, cancelYmd, cancelHms, reason }) {
    return {
        INVOICE_CODE: 'A0501',
        CancelInvoiceNumber: number,
        InvoiceDate: invoiceYmd,
        BuyerId: buyerId,
        SellerId: sellerId,
        CancelDate: cancelYmd,
        CancelTime: cancelHms,
        CancelReason: reason,
    };
}

export function b2cVoidPayload({ number, invoiceYmd, buyerId, sellerId, cancelYmd, cancelHms, reason }) {
    return {
        INVOICE_CODE: 'C0501',
        INVOICE_NUMBER: number,
        INVOICE_DATE: invoiceYmd,
        BUYERID: buyerId,
        SELLERID: sellerId,
        CANCEL_DATE: cancelYmd,
        CANCEL_TIME: cancelHms,
        CANCEL_REASON: reason,
    };
}

export function replyOf(response) {
    const boxes = [response?.Invoice, response?.INDEX, response?.Index, response].filter(box => box && typeof box === 'object');
    for (const box of boxes) {
        if (box.REPLY != null && box.REPLY !== '') return { reply: String(box.REPLY), message: String(box.MESSAGE || box.message || '') };
    }
    return { reply: '', message: '' };
}

export function isSuccess(response) {
    return replyOf(response).reply === '1';
}

export function isDuplicate(response) {
    return /重複|已存在|已開立|already/i.test(replyOf(response).message);
}

export function numbersFromZ21(response) {
    const rows = response?.INDEX?.INVOICEDATA || response?.Invoice?.INVOICEDATA || [];
    return rows.map(row => ({
        number: String(row.INVOICE_NUMBER || row.INVOICENUMBER || row.InvoiceNumber || '').toUpperCase(),
        random: String(row.RANDOMNUMBER || row.RandomNumber || row.randomNumber || ''),
    })).filter(row => /^[A-Z]{2}\d{8}$/.test(row.number));
}

export function rangeFromA01(response) {
    const index = response?.INDEX || {};
    const track = String(index.INVOICEHEADER || '').toUpperCase();
    const start = Number(index.INVOICESTART);
    const end = Number(index.INVOICEEND);
    if (!/^[A-Z]{2}$/.test(track) || !Number.isInteger(start) || !Number.isInteger(end) || end < start) return [];
    const out = [];
    const last = Math.min(end, start + 499);
    for (let n = start; n <= last; n += 1) {
        out.push({ number: track + String(n).padStart(8, '0'), random: '' });
    }
    return out;
}

export function fourDigitRandom(seed) {
    let hash = 0;
    for (const ch of String(seed || '')) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
    return String(hash % 10000).padStart(4, '0');
}

export function publicResponse(json) {
    const copy = json && typeof json === 'object' ? JSON.parse(JSON.stringify(json)) : {};
    for (const box of [copy, copy.Invoice, copy.INDEX]) {
        if (box && typeof box === 'object') {
            delete box.POSSN;
            delete box.APPID;
            delete box.ACCOUNT;
        }
    }
    return copy;
}

export function ymdCompact(isoDate) {
    const text = String(isoDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('發票日期不完整，不能作廢。');
    return text.replace(/-/g, '');
}
