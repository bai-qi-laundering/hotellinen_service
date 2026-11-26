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

// 財政部 MIG 4.1 品名 Description（汎宇 openInvoice 的 ProductName／Details.description）最多 500 字。
// 中英文、數字、標點各算 1 字。換行與控制字元不送。
export const ITEM_DESCRIPTION_LIMIT = 500;

export function itemDescriptionError(value) {
    const text = String(value ?? '').replace(/\u3000/g, ' ').trim();
    if (!text) return '請填品項說明。';
    if (/[\u0000-\u001F\u007F]/.test(text)) return '品項說明不可含換行或控制字元。';
    if ([...text].length > ITEM_DESCRIPTION_LIMIT) return '品項說明請在 500 字以內。中英文、數字與標點各算 1 字。';
    return '';
}

export function cleanDescription(input, snapshot) {
    const fallback = defaultItemDescription(snapshot?.startDate, snapshot?.endDate);
    const text = String(input ?? '').replace(/\u3000/g, ' ').trim() || fallback;
    const error = itemDescriptionError(text);
    if (error) throw new Error(error);
    return text;
}

function sheetCell(value) {
    return String(value ?? '').normalize('NFKC').replace(/\u3000/g, ' ').trim();
}

function sheetColumn(header, title) {
    if (!Array.isArray(header)) return -1;
    return header.findIndex(cell => sheetCell(cell) === title);
}

// 客戶資料表第一列的「發票品項」。用標題找欄，不看欄序。沒有這欄或這格空白就回空字串。
export function invoiceItemFromClients(rows, customerKey, aliases = []) {
    if (!Array.isArray(rows) || !rows.length) return '';
    const itemCol = sheetColumn(rows[0], '發票品項');
    if (itemCol < 0) return '';
    const nameCol = sheetColumn(rows[0], '飯店名稱');
    const keyCol = nameCol >= 0 ? nameCol : 0;
    const names = [];
    for (const name of [customerKey, ...aliases]) {
        const text = sheetCell(name);
        if (text && !names.includes(text)) names.push(text);
    }
    for (const name of names) {
        const row = rows.find((item, index) => index > 0 && Array.isArray(item) && sheetCell(item[keyCol]) === name);
        const value = row ? sheetCell(row[itemCol]) : '';
        if (value) return value;
    }
    return '';
}

// 百麒只開 B2B。買方必須是 8 碼統編；空白、10 個 0 或其他長度都不開立。
export const MISSING_TAX_ID_MESSAGE = '這位客戶沒有 8 碼統編，不能開立發票。請先到結帳系統補上統編。';

export function missingTaxIdMessage(profile) {
    const digits = String(profile?.taxId || '').replace(/\D/g, '');
    return /^\d{8}$/.test(digits) ? '' : MISSING_TAX_ID_MESSAGE;
}

export function buyerFromProfile(profile) {
    const name = String(profile?.name || '').trim();
    const digits = String(profile?.taxId || '').replace(/\D/g, '');
    if (!name) throw new Error('沒有發票抬頭，請先到結帳系統填好再開發票。');
    if (/^0+$/.test(name)) throw new Error('買方名稱不可為 0。請先到結帳系統改抬頭。');
    if (name.length > 60) throw new Error('發票抬頭請在 60 字以內。請先到結帳系統改。');
    if (!/^\d{8}$/.test(digits)) throw new Error(MISSING_TAX_ID_MESSAGE);
    const email = String(profile?.email || '').trim();
    return { kind: 'b2b', taxId: digits, name, ...(email ? { email } : {}) };
}

export function clientNotifyEmail(rows, customerKey) {
    const want = String(customerKey || '').trim();
    if (!want || !Array.isArray(rows)) return '';
    const row = rows.find(item => Array.isArray(item) && String(item[0] ?? '').trim() === want);
    return row ? String(row[5] ?? '').trim() : '';
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
