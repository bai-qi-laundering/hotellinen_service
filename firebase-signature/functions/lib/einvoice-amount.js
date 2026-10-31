// 客戶實付是對帳單含稅總額（未稅 + 管理費 − 回饋之後再加 5% 稅）。
// 電子發票改以這個含稅整數拆回未稅與稅額，讓銷售額 + 稅額 = 總額。

function num(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export function statementPayable(snapshot) {
    const totals = snapshot?.totals || {};
    return num(totals.afterRebate) + num(totals.tax);
}

// 正數四捨五入到整數（.5 進位）。
export function roundHalfUp(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
}

// 含稅總額拆 5%：稅額 = round(總額 × 5 / 105)，未稅 = 總額 − 稅額。
export function splitTaxInclusive(total) {
    const rounded = roundHalfUp(total);
    if (!Number.isInteger(rounded) || rounded < 1) {
        throw new Error('含稅金額需為 1 元以上的整數，這張沒有開立。');
    }
    const tax = Math.round((rounded * 5) / 105);
    const sales = rounded - tax;
    if (sales < 0 || sales + tax !== rounded) throw new Error('稅額拆分失敗，這張沒有開立。');
    return { total: rounded, sales, tax, rate: '0.05' };
}

export function defaultItemDescription(startDate, endDate) {
    const slash = value => String(value || '').replace(/-/g, '/');
    return `布品洗滌費 ${slash(startDate)}–${slash(endDate)}`;
}

export function cleanDescription(input, snapshot) {
    const fallback = defaultItemDescription(snapshot?.startDate, snapshot?.endDate);
    const text = String(input ?? '').trim() || fallback;
    if (text.length > 100) throw new Error('品項說明請在 100 字以內。');
    return text;
}

// 8 碼統編走 B2B。空白走 B2C，買方代號用 10 個 0（財政部對無統編的慣例）。其他長度當成填錯，不開立。
export function buyerFromProfile(profile) {
    const name = String(profile?.name || '').trim();
    const digits = String(profile?.taxId || '').replace(/\D/g, '');
    if (!name) throw new Error('沒有發票抬頭，請先到結帳系統填好再開發票。');
    if (!digits) return { kind: 'b2c', taxId: '0000000000', name };
    if (!/^\d{8}$/.test(digits)) {
        throw new Error('統編需為 8 碼。這一筆不是 8 碼，沒有開立，請先到結帳系統改抬頭。');
    }
    return { kind: 'b2b', taxId: digits, name };
}

export function quoteInvoice(snapshot) {
    const amounts = splitTaxInclusive(statementPayable(snapshot));
    const buyer = buyerFromProfile(snapshot?.profile || {});
    return {
        ...amounts,
        buyer,
        startDate: snapshot?.startDate || '',
        endDate: snapshot?.endDate || '',
        period: `${snapshot?.startDate || ''} ~ ${snapshot?.endDate || ''}`,
        description: defaultItemDescription(snapshot?.startDate, snapshot?.endDate),
    };
}
