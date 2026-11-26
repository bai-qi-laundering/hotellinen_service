// 開立失敗時寫進帳單的內容。只留正式機或測試機的公開網址，不留帳號、密碼、API Key。

const PROD_HOST = 'https://web.einvoice.com.tw/einv';
const TEST_HOST = 'https://webtest.einvoice.com.tw/einv';

export function publicInvoiceTarget(host) {
    return String(host || '').trim() === PROD_HOST
        ? { environment: 'prod', host: PROD_HOST, label: '正式機' }
        : { environment: 'test', host: TEST_HOST, label: '測試機' };
}

export function invoiceFailureMessage(failure) {
    const reason = String(failure?.statusDesc || '').trim() || '汎宇沒有接受這張發票。';
    const target = failure?.environment === 'prod' || failure?.host === PROD_HOST
        ? publicInvoiceTarget(PROD_HOST)
        : publicInvoiceTarget(failure?.host);
    const tax = String(failure?.buyerId || '').replace(/\D/g, '');
    return `${reason}（${target.label} ${target.host}，買方統編 ${tax}）`;
}

export function storedInvoice(doc) {
    const number = String(doc?.invoiceNumber || doc?.invoiceRecord?.number || '').trim();
    const date = String(doc?.invoiceDate || doc?.invoiceRecord?.date || '').trim();
    const raw = doc?.invoiceRecord?.amount;
    const amount = raw == null || raw === '' ? null : Number(raw);
    const notifyEmail = String(doc?.invoiceRecord?.notifyEmail || '').trim();
    return {
        number,
        date,
        amount: Number.isFinite(amount) ? amount : null,
        ...(notifyEmail ? { notifyEmail } : {}),
    };
}

export function ledgerInvoiceLines(doc, extra = {}) {
    const stored = storedInvoice(doc);
    const number = stored.number || String(extra.number || '').trim();
    if (number) {
        const date = stored.date || String(extra.date || '').trim();
        const raw = stored.amount != null ? stored.amount : extra.amount;
        const amount = raw == null || raw === '' ? null : Number(raw);
        const notifyEmail = stored.notifyEmail || String(extra.notifyEmail || '').trim();
        return {
            kind: 'issued',
            number,
            date,
            amount: Number.isFinite(amount) ? amount : null,
            ...(notifyEmail ? { notifyEmail } : {}),
        };
    }
    const failure = doc?.invoiceFailure;
    const version = extra.version;
    const sameVersion = !failure || failure.version == null || failure.version === '' || Number(failure.version) === Number(version);
    return {
        kind: 'open',
        failure: failure && sameVersion ? invoiceFailureMessage(failure) : '',
    };
}
