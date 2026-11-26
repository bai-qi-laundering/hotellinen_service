// 開立當下可指定的發票日期。已開立的發票不能改日期，只能作廢後重開。

export function invoicePeriod(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    const startMonth = month % 2 === 1 ? month : month - 1;
    const endMonth = startMonth + 1;
    const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    const pad = value => String(value).padStart(2, '0');
    return {
        start: `${year}-${pad(startMonth)}-01`,
        end: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
    };
}

export function compactInvoiceDate(isoDate) {
    const text = String(isoDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    return text.replace(/-/g, '');
}

// 不能是未來日期，必須落在「今天」所屬的雙月期別，也不能早於本期已開過的發票日期。
export function invoiceDateError(isoDate, { today, lastIssuedDate } = {}) {
    const date = String(isoDate || '').trim();
    const now = String(today || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '請選擇開立發票日期。';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(now)) return '無法確認今天的日期。';
    if (date > now) return '開立發票日期不能晚於今天。';
    const period = invoicePeriod(now);
    if (!period || date < period.start || date > period.end) {
        const range = period ? `${period.start}～${period.end}` : '本雙月';
        return `開立發票日期須在本期 ${range}。`;
    }
    const last = String(lastIssuedDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(last) && last >= period.start && last <= period.end && date < last) {
        return `開立發票日期不能早於本期最近一張發票 ${last}。同一字軌的日期不能倒退。`;
    }
    return '';
}
