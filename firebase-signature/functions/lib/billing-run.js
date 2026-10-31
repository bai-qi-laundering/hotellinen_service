// 結帳日 09:30（台北）產生對帳單。只在伺服器跑，簽收頁不參與。
import { attemptWithBackoff, sheetPricesFromRows } from './price-catalog.js';
import {
    billingGroupForDate,
    dueHotelKeywords,
    hotelKeywordsFromTemplate,
    hotelPeriodQueries,
    settlementWarnings,
} from './billing-schedule.js';
import {
    caseDocumentId,
    closingPeriod,
    commitOnce,
    createInvoiceEngine,
    customerOf,
    recordDate,
    rowsForPeriod,
} from './auto-close.js';

// customerOf 只把「鼎王」拆成「鼎王 部門」各自一張帳單。其他飯店一間一張。
const DEPARTMENT_STATEMENT_HOTELS = new Set(['鼎王']);

function alreadyExists(error) {
    return error?.code === 6 || error?.code === 'already-exists' || error?.code === 'ALREADY_EXISTS';
}

async function writeMarker(db, id, fields) {
    try {
        await db.collection('statement_auto_runs').doc(id).create({
            ...fields,
            caseId: id,
            completedAt: new Date().toISOString(),
        });
        return 'written';
    } catch (error) {
        if (alreadyExists(error)) return 'already_completed';
        throw error;
    }
}

export function signatureCoverage(documents, customer, start, end) {
    let signed = 0;
    let unsigned = 0;
    for (const { data } of documents) {
        const date = recordDate(data.date);
        if (data.manualDeletedReceipt || customerOf(data) !== customer || date < start || date > end) continue;
        const parent = String(data.hotelKeyword || '').trim();
        const dept = String(data.deptName || '').trim();
        const hotel = dept && dept !== parent ? `${parent} ${dept}` : parent;
        if (hotel.includes('回洗') || dept.includes('回洗')) continue;
        if (String(data.clientSig || '').trim() || String(data.driverSig || '').trim()) signed += 1;
        else unsigned += 1;
    }
    return { signedReceiptCount: signed, unsignedReceiptCount: unsigned };
}

async function readHotelPeriod(db, hotelKeyword, start, end) {
    const queries = hotelPeriodQueries(start, end).map(spec => {
        const base = db.collection('logistics_records').where('hotelKeyword', '==', hotelKeyword);
        if (spec.kind === 'prefix') return base.where('date', '>=', spec.prefix).where('date', '<=', `${spec.prefix}\uf8ff`);
        if (spec.kind === 'timestamp') {
            return base
                .where('date', '>=', new Date(`${spec.start}T00:00:00+08:00`))
                .where('date', '<=', new Date(`${spec.end}T23:59:59.999+08:00`));
        }
        return base.where('date', '>=', spec.start).where('date', '<=', spec.end);
    });
    const docs = new Map();
    for (const snap of await Promise.all(queries.map(query => query.get()))) {
        snap.forEach(doc => docs.set(doc.id, { id: doc.id, data: doc.data() }));
    }
    return [...docs.values()].filter(doc => {
        const date = recordDate(doc.data.date);
        return date >= start && date <= end;
    });
}

async function outcome(db, customer, period) {
    const id = await caseDocumentId(customer, period.startDate, period.endDate);
    const [marker, existing] = await Promise.all([
        db.collection('statement_auto_runs').doc(id).get(),
        db.collection('statement_cases').doc(id).get(),
    ]);
    if (marker.exists) return { id, action: 'done', status: marker.data()?.status || 'already_completed' };
    if (existing.exists) return { id, action: 'manual' };
    return { id, action: 'create' };
}

async function configDoc(db, name) {
    const snap = await db.collection('inventory_config').doc(name).get();
    return snap.exists ? snap.data() : {};
}

async function loadMaster(masterUrl, fetchFn, backoffMs) {
    const url = new URL(masterUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') {
        throw new Error('FINANCE_MASTER_URL 必須是既有 Apps Script HTTPS 網址');
    }
    url.searchParams.set('action', 'getFinanceMasterData');
    return attemptWithBackoff(async () => {
        const response = await fetchFn(url, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`財務主資料 HTTP ${response.status}`);
        const body = await response.json();
        if (!body.success || !Array.isArray(body.prices) || !Array.isArray(body.clients)) throw new Error('財務主資料不完整');
        return body;
    }, { attempts: 3, delayMs: backoffMs });
}

async function pricingContext(db, masterUrl, fetchFn, backoffMs, template) {
    if (!template.items?.length) throw new Error('缺少品項排序 master_template');
    const [master, pricing, effective, custom] = await Promise.all([
        loadMaster(masterUrl, fetchFn, backoffMs),
        configDoc(db, 'finance_annual_pricing'),
        configDoc(db, 'finance_effective_prices'),
        configDoc(db, 'custom_prices'),
    ]);
    const base = {
        sheetPrices: sheetPricesFromRows(master.prices),
        customPrices: custom.prices || {},
        sheetClients: {},
        logisticsMasterItems: template.items,
        effectivePriceRules: effective.rules || [],
        pricingRules: {
            holidays: pricing.holidays || [],
            rebates: pricing.rebates || [],
            managementFees: pricing.managementFees || [],
        },
    };
    base.sheetClients = createInvoiceEngine({ ...base, rawLogisticsData: [] }).parseFinanceClientRows(master.clients);
    return base;
}

async function rememberManual(db, id, date) {
    return commitOnce({
        db,
        id,
        snapshot: null,
        eventId: `billing-day:${date}`,
        receiptId: '',
        eventTime: date,
    });
}

async function publishCustomer(db, { id, customer, period, documents, context, date, group }) {
    const rows = rowsForPeriod(documents, customer, period.startDate, period.endDate);
    const coverage = signatureCoverage(documents, customer, period.startDate, period.endDate);
    if (!rows.length) {
        await writeMarker(db, id, {
            status: 'skipped_empty',
            customerKey: customer,
            startDate: period.startDate,
            endDate: period.endDate,
            billingGroup: group,
            ...coverage,
        });
        return { customer, id, status: 'skipped_empty', ...coverage };
    }
    const snapshot = createInvoiceEngine({ ...context, rawLogisticsData: rows }).build(customer, period.startDate, period.endDate);
    const status = await commitOnce({
        db,
        id,
        snapshot,
        eventId: `billing-day:${date}`,
        receiptId: '',
        eventTime: date,
        meta: { billingGroup: group, ...coverage },
    });
    return { customer, id, status, ...coverage, startDate: period.startDate, endDate: period.endDate };
}

export async function runBillingDay({
    db,
    date,
    masterUrl,
    fetchFn = globalThis.fetch,
    logger = console,
    backoffMs = 1000,
}) {
    const group = billingGroupForDate(date);
    if (!group) return { status: 'not_billing_day', billingGroup: null, results: [], warnings: [], failures: [] };

    const [groupsDoc, template] = await Promise.all([
        configDoc(db, 'finance_settlement_groups'),
        configDoc(db, 'master_template'),
    ]);
    const groups = groupsDoc.groups || {};
    const baseNames = hotelKeywordsFromTemplate(template);
    const warnings = settlementWarnings(baseNames, groups);
    for (const warning of warnings) {
        const entry = { ...warning, date, billingGroup: group };
        if (warning.type === 'unknown_day' || warning.type === 'not_in_template') logger.warn?.('billing_day_warning', entry);
        else logger.info?.('billing_day_notice', entry);
    }
    if (!template.items?.length) throw new Error('缺少品項排序 master_template');

    const hotels = dueHotelKeywords(baseNames, groups, group);
    const results = [];
    const pending = [];
    for (const hotel of hotels) {
        const period = closingPeriod(hotel, date, groups);
        if (!period) continue;
        if (DEPARTMENT_STATEMENT_HOTELS.has(hotel)) {
            const documents = await readHotelPeriod(db, hotel, period.startDate, period.endDate);
            const customers = [...new Set(documents.map(doc => customerOf(doc.data)).filter(Boolean))];
            if (!customers.length) {
                const id = await caseDocumentId(hotel, period.startDate, period.endDate);
                await writeMarker(db, id, {
                    status: 'skipped_empty',
                    customerKey: hotel,
                    startDate: period.startDate,
                    endDate: period.endDate,
                    billingGroup: group,
                    signedReceiptCount: 0,
                    unsignedReceiptCount: 0,
                });
                results.push({ customer: hotel, id, status: 'skipped_empty' });
                continue;
            }
            for (const customer of customers) {
                const customerPeriod = closingPeriod(customer, date, groups);
                if (!customerPeriod) continue;
                const prior = await outcome(db, customer, customerPeriod);
                if (prior.action === 'done') {
                    results.push({ customer, id: prior.id, status: 'already_completed' });
                    continue;
                }
                if (prior.action === 'manual') {
                    results.push({ customer, id: prior.id, status: await rememberManual(db, prior.id, date) });
                    continue;
                }
                pending.push({ hotel, customer, id: prior.id, period: customerPeriod, documents });
            }
            continue;
        }
        const prior = await outcome(db, hotel, period);
        if (prior.action === 'done') {
            results.push({ customer: hotel, id: prior.id, status: 'already_completed' });
            continue;
        }
        if (prior.action === 'manual') {
            results.push({ customer: hotel, id: prior.id, status: await rememberManual(db, prior.id, date) });
            continue;
        }
        pending.push({ hotel, customer: hotel, id: prior.id, period, documents: null });
    }

    if (pending.length) {
        const context = await pricingContext(db, masterUrl, fetchFn, backoffMs, template);
        const documentsByHotel = new Map();
        for (const job of pending) {
            if (job.documents) documentsByHotel.set(job.hotel, job.documents);
        }
        for (const job of pending) {
            try {
                if (!documentsByHotel.has(job.hotel)) {
                    documentsByHotel.set(job.hotel, await readHotelPeriod(db, job.hotel, job.period.startDate, job.period.endDate));
                }
                results.push(await publishCustomer(db, {
                    ...job,
                    documents: documentsByHotel.get(job.hotel),
                    context,
                    date,
                    group,
                }));
            } catch (error) {
                results.push({ customer: job.customer, id: job.id, status: 'failed', error: error?.message || String(error) });
            }
        }
    }

    const failures = results.filter(result => result.status === 'failed');
    logger.info?.('billing_day_done', {
        date,
        billingGroup: group,
        hotels: hotels.length,
        created: results.filter(result => result.status === 'created').length,
        failures: failures.length,
    });
    return { status: 'done', billingGroup: group, results, warnings, failures };
}

export async function handleBillingSchedule({
    date,
    enabled,
    db,
    masterUrl,
    fetchFn,
    logger = console,
    backoffMs = 1000,
}) {
    const billingGroup = billingGroupForDate(date);
    if (!enabled || !billingGroup) {
        logger.info?.('auto_statement_schedule_noop', { date, enabled: !!enabled, billingGroup, firestoreReads: 0 });
        return { status: 'noop', billingGroup, results: [], warnings: [], failures: [] };
    }
    return runBillingDay({ db, date, masterUrl, fetchFn, logger, backoffMs });
}
