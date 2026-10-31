// Pricing functions copied verbatim from finance.html 37c5ab8d570c43ed9f8d68930d2e4051e575ec57.
// Re-sync this adapter when the finance formulas change; parity is covered by tests.
import { snapshotFromParts } from './statement-case.js';
export function createInvoiceEngine(options) {
const { logisticsMasterItems, pricingRules, effectivePriceRules, sheetPrices, customPrices, sheetClients, rawLogisticsData } = options;
const MERGE_ALL_KEY = '__MERGE_ALL_SELECTED__';
const roundHolidayPrice = n => Math.round((Number(n) + Number.EPSILON) * 10) / 10;
function getLogisticsItemSortIndex(hotelName, itemName) {
    let expectedOrder = logisticsMasterItems.filter(d => d.hotel === hotelName).map(d => d.item);
    if (expectedOrder.length === 0) expectedOrder = [...new Set(logisticsMasterItems.map(d => d.item))];
    const index = expectedOrder.indexOf(itemName);
    return index === -1 ? 99999 : index;
}

function compareLogisticsItems(hotelName, itemA, itemB) {
    const diff = getLogisticsItemSortIndex(hotelName, itemA) - getLogisticsItemSortIndex(hotelName, itemB);
    return diff || String(itemA).localeCompare(String(itemB), 'zh-TW');
}

function activeHolidayRule(company, date) {
  return pricingRules.holidays.find(r => r.hotel === company && date >= r.start && date <= r.end) || null;
}

function rebateForReport(company, records) {
  const rule = pricingRules.rebates.find(r => r.hotel === company);
  if (!rule) return {percent:0, amount:0, base:0};
  const eligible = records.reduce((sum,r) => {
    if ((rule.start && r.date < rule.start) || (rule.end && r.date > rule.end)) return sum;
    return sum + (Number(r.qty)||0) * reportRecordPrice(r);
  },0);
  const amount = Math.round(eligible * rule.percent / 100);
  return {percent:rule.percent, amount, base:eligible};
}

function managementFeeForReport(company, records) {
  const rule = pricingRules.managementFees.find(r => r.hotel === company);
  if (!rule) return {percent:0, amount:0, base:0};
  const base = records.reduce((sum,r) => {
    if ((rule.start && r.date < rule.start) || (rule.end && r.date > rule.end)) return sum;
    return sum + (Number(r.qty)||0) * reportRecordPrice(r);
  }, 0);
  return {percent:Number(rule.percent)||0, amount:Math.round(base * (Number(rule.percent)||0) / 100), base};
}

function baseRecordPrice(r) {
  if (r.savedPrice !== undefined && r.savedPrice !== null && r.savedPrice !== '') return Number(r.savedPrice) || 0;
  return Number(getPrice(r.hotel,r.item,r.date)) || 0;
}

function reportRecordPrice(r) {
  const effective = datedPriceFor(r.hotel,r.item,r.date);
  if (effective !== null) {
    const holiday=activeHolidayRule(r.parentCompany,r.date);
    return holiday ? roundHolidayPrice(effective*(1+holiday.percent/100)) : effective;
  }
  if (r.manualPriceOverride) return Number(r.currentPrice !== undefined ? r.currentPrice : r.savedPrice) || 0;
  const original = baseRecordPrice(r);
  const rule = activeHolidayRule(r.parentCompany, r.date);
  return rule ? roundHolidayPrice(original * (1 + rule.percent / 100)) : original;
}

function datedPriceFor(hotel, item, date) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const key = `${hotel}_${item}`;
    const rule = effectivePriceRules.filter(x => x.key===key && x.start<=date)
      .sort((a,b)=>b.start.localeCompare(a.start))[0];
    return rule ? Number(rule.price) : null;
}

function getPrice(hotelName, item, date=null) {
    const dated=datedPriceFor(hotelName,item,date);
    if (dated !== null) return dated;
    let exactKey = `${hotelName}_${item}`;
    if (customPrices[exactKey] !== undefined && customPrices[exactKey] !== "") return Number(customPrices[exactKey]);
    if (sheetPrices[exactKey] !== undefined) return sheetPrices[exactKey];

    let unifiedKey = `${hotelName}_統一折扣`;
    if (customPrices[unifiedKey] !== undefined && customPrices[unifiedKey] !== "") return Number(customPrices[unifiedKey]);
    if (sheetPrices[unifiedKey] !== undefined) return sheetPrices[unifiedKey];

    return null;
}

function distinctShipmentRows(records) {
    const seen = new Set();
    return records.filter(record => {
        if (!record.docId || !Number.isInteger(record.receiptOrder) || record.receiptOrder < 0) return true;
        const sourceKey = JSON.stringify([record.docId, record.receiptOrder]);
        if (seen.has(sourceKey)) return false;
        seen.add(sourceKey);
        return true;
    });
}

function invoiceCustomerKeyForRecord(r) {
    const parent = String(r?.parentCompany || '').trim();
    const hotel = String(r?.hotel || parent).trim();
    if (parent === '鼎王' || hotel.startsWith('鼎王 ')) return hotel;
    return parent || hotel;
}

function buildInvoiceReport(targetVal) {
    if (!logisticsMasterItems.length) { throw new Error('品項排序設定缺失'); return { comp: '', depts: {}, grandTotal: 0, rounded: 0, tax: 0 }; }
    if (!targetVal) return { comp: '', depts: {}, grandTotal: 0, rounded: 0, tax: 0 };

    const isMergeAll = targetVal === MERGE_ALL_KEY;
    const matches = distinctShipmentRows(
        isMergeAll
            ? rawLogisticsData
            : rawLogisticsData.filter(r => invoiceCustomerKeyForRecord(r) === targetVal)
    );

    const mergedCompanyNames = [...new Set(matches.map(invoiceCustomerKeyForRecord).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-TW'));
    const compLabel = isMergeAll ? mergedCompanyNames.join('＋') : targetVal;

    const depts = {};
    let grandTotal = 0;
    matches.forEach(r => {
        const name = r.hotel;
        if (!depts[name]) depts[name] = { records: [], summary: {}, total: 0 };
        const price = reportRecordPrice(r);
        const qty = Number(r.qty) || 0;
        const amount = qty * price;
        depts[name].records.push({ docId: r.docId, rowId: r.rowId, date: r.date, item: r.item, qty, price, amt: amount, receiptOrder: r.receiptOrder });
        const key = JSON.stringify([r.item, price]);
        if (!depts[name].summary[key]) depts[name].summary[key] = { item: r.item, qty: 0, price, amt: 0, firstSeen: depts[name].records.length - 1 };
        depts[name].summary[key].qty += qty;
        depts[name].summary[key].amt += amount;
        depts[name].total += amount;
        grandTotal += amount;
    });
    Object.entries(depts).forEach(([hotelName, dept]) => dept.records.sort((a,b) => a.date.localeCompare(b.date) || compareLogisticsItems(hotelName, a.item, b.item) || String(a.docId || '').localeCompare(String(b.docId || '')) || a.receiptOrder - b.receiptOrder));

    const groupedByParent = new Map();
    matches.forEach(r => {
        const p = r.parentCompany || compLabel;
        if (!groupedByParent.has(p)) groupedByParent.set(p, []);
        groupedByParent.get(p).push(r);
    });

    let totalRebateAmt = 0, totalFeeAmt = 0;
    const rebateLabels = [], feeLabels = [];
    groupedByParent.forEach((recs, parentName) => {
        const reb = rebateForReport(parentName, recs);
        if (reb.amount > 0) {
            totalRebateAmt += reb.amount;
            rebateLabels.push(groupedByParent.size > 1 ? `${parentName} ${reb.percent}%` : `${reb.percent}%`);
        }
        const fee = managementFeeForReport(parentName, recs);
        if (fee.amount > 0) {
            totalFeeAmt += fee.amount;
            feeLabels.push(groupedByParent.size > 1 ? `${parentName} ${fee.percent}%` : `${fee.percent}%`);
        }
    });

    const rebate = { percent: rebateLabels.join('、') || 0, amount: totalRebateAmt };
    const managementFee = { percent: feeLabels.join('、') || 0, amount: totalFeeAmt };
    const rounded = Math.round(grandTotal);
    const afterRebate = rounded + managementFee.amount - rebate.amount;
    const tax = Math.round(afterRebate * 0.05);
    return { comp: compLabel, depts, grandTotal, rounded, managementFee, rebate, afterRebate, tax };
}

function parseFinanceClientRows(rows) {
    const out = {};
    const val = v => String(v ?? '').trim();
    const tax = v => val(v).replace(/\.0$/, '');
    rows.forEach((row, index) => {
        if (Array.isArray(row)) {
            const shortName = val(row[0]);
            if (!shortName || (index === 0 && /^(簡稱|飯店簡稱|客戶簡稱|客戶名稱|名稱)$/.test(shortName))) return;
            const profile = {
                name: val(row[1]),
                taxId: tax(row[2]),
                contact: val(row[3]),
                phone: val(row[4]),
                address: val(row[8]),
                terms: val(row[6]) || '月結 30 天',
                method: val(row[7]) || '銀行匯款 / 支票'
            };
            if (profile.name || profile.taxId) out[shortName] = profile;
        } else if (row && typeof row === 'object') {
            const shortName = val(row.shortName ?? row.companyName ?? row.hotel ?? row['簡稱'] ?? row['客戶簡稱']);
            if (!shortName) return;
            const profile = {
                name: val(row.name ?? row.invoiceTitle ?? row['發票抬頭'] ?? row['正式抬頭']),
                taxId: tax(row.taxId ?? row.taxID ?? row['統編'] ?? row['統一編號']),
                contact: val(row.contact ?? row['聯絡人']),
                phone: val(row.phone ?? row['電話']),
                address: val(row.address ?? row['地址']),
                terms: val(row.terms ?? row['付款條件']) || '月結 30 天',
                method: val(row.method ?? row['付款方式']) || '銀行匯款 / 支票'
            };
            if (profile.name || profile.taxId) out[shortName] = profile;
        }
    });
    return out;
}

function normalizeClientLookupKey(v) {
    return String(v ?? '').normalize('NFKC').replace(/[\s ]+/g,'').replace(/[－–—_]/g,'-').trim().toLowerCase();
}

function resolveClientProfile(comp) {
    if (!comp) return null;
    if (sheetClients[comp]) return sheetClients[comp];
    const key = normalizeClientLookupKey(comp);
    const exact = Object.entries(sheetClients || {}).find(([name]) => normalizeClientLookupKey(name) === key);
    if (exact) return exact[1];
    const candidates = Object.entries(sheetClients || {}).filter(([name]) => {
        const nk = normalizeClientLookupKey(name);
        return nk.startsWith(key) || key.startsWith(nk);
    });
    if (candidates.length === 1) return candidates[0][1];
    return null;
}
return { parseFinanceClientRows, reportRecordPrice, build(customerKey, startDate, endDate) {
const report = buildInvoiceReport(customerKey);
const profile = resolveClientProfile(customerKey);
if (!profile?.name) throw new Error('客戶抬頭未設定：'+customerKey);
if (!Object.keys(report.depts).length) throw new Error('沒有可出帳的明細');
return snapshotFromParts({customerKey,startDate,endDate,profile,lineRecipient:'',
departments:Object.entries(report.depts).sort(([a],[b])=>a.localeCompare(b,'zh-TW')).map(([name,dept])=>({name,total:dept.total,summary:Object.values(dept.summary).sort((a,b)=>compareLogisticsItems(name,a.item,b.item)||a.firstSeen-b.firstSeen).map(({item,qty,price,amt})=>({item,qty,price,amt})),records:dept.records.map(r=>({date:r.date,item:r.item,qty:r.qty,price:r.price,amt:r.amt,docId:r.docId||''}))})),totals:report});
}};
}
