// Same bill as one customer statement: round the linen sum, then fee and rebate, then 5% tax.
// Half-up to the dollar via Math.round, which is what the statement already uses.

export function statementCustomerKey(record) {
    const parent = String(record?.parentCompany || '').trim();
    const hotel = String(record?.hotel || parent).trim();
    if (parent === '鼎王' || hotel.startsWith('鼎王 ')) return hotel;
    return parent || hotel;
}

function lineAmount(record, priceOf) {
    return (Number(record?.qty) || 0) * priceOf(record);
}

export function statementAdjustment(rule, records, priceOf) {
    if (!rule) return { percent: 0, amount: 0, base: 0 };
    const base = (records || []).reduce((sum, record) => {
        if ((rule.start && record.date < rule.start) || (rule.end && record.date > rule.end)) return sum;
        return sum + lineAmount(record, priceOf);
    }, 0);
    const percent = Number(rule.percent) || 0;
    return { percent: rule.percent ?? 0, amount: Math.round(base * percent / 100), base };
}

export function statementReceivable(records, priceOf, rebateRule, feeRule) {
    const raw = (records || []).reduce((sum, record) => sum + lineAmount(record, priceOf), 0);
    const rounded = Math.round(raw);
    const rebate = statementAdjustment(rebateRule, records, priceOf);
    const managementFee = statementAdjustment(feeRule, records, priceOf);
    const afterRebate = rounded + managementFee.amount - rebate.amount;
    const tax = Math.round(afterRebate * 0.05);
    return {
        raw,
        grandTotal: raw,
        rounded,
        managementFee,
        rebate,
        afterRebate,
        tax,
        payable: afterRebate + tax,
    };
}

export function sumCustomerReceivables(records, priceOf, ruleFor) {
    const groups = new Map();
    for (const record of records || []) {
        const key = statementCustomerKey(record);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    }
    const customers = [...groups.entries()].map(([key, rows]) => {
        const rules = ruleFor(rows, key) || {};
        return { key, rows, ...statementReceivable(rows, priceOf, rules.rebate, rules.managementFee) };
    });
    const totals = customers.reduce((acc, item) => {
        acc.rounded += item.rounded;
        acc.managementFee += item.managementFee.amount;
        acc.rebate += item.rebate.amount;
        acc.afterRebate += item.afterRebate;
        acc.tax += item.tax;
        acc.payable += item.payable;
        return acc;
    }, { rounded: 0, managementFee: 0, rebate: 0, afterRebate: 0, tax: 0, payable: 0 });
    return { customers, ...totals, untaxed: totals.rounded, tax: totals.tax, final: totals.payable };
}

export function sumGroupFigures(groups) {
    return (groups || []).reduce((acc, group) => {
        acc.untaxed += Number(group?.untaxed) || 0;
        acc.tax += Number(group?.tax) || 0;
        acc.final += Number(group?.final) || 0;
        acc.managementFee += Number(group?.managementFee) || 0;
        acc.rebate += Number(group?.rebate) || 0;
        return acc;
    }, { untaxed: 0, tax: 0, final: 0, managementFee: 0, rebate: 0 });
}
