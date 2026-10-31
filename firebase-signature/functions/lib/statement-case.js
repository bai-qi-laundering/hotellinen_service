// 對帳單快照、版本與同一份內容的 HTML / Excel。不含畫面與資料庫。
import { orderStatementSnapshot } from './logistics-items.js';

export const STATUS_LABELS = {
    pending: '待寄送',
    resend: '新版待重寄',
    sent: '已登記寄送',
    needs_review: '已開票後有新內容',
};

export function num(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export function formatMoney(value) {
    return Number(num(value)).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

export function formatCardAmount(value) {
    return `NT$ ${Number(num(value)).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
}

export function payableAmount(snapshot) {
    return num(snapshot?.totals?.afterRebate) + num(snapshot?.totals?.tax);
}

export function formatPeriod(startDate, endDate) {
    const slash = value => String(value || '').replace(/-/g, '/');
    return `${slash(startDate)}－${slash(endDate)}`;
}

export function statementFileBase(snapshot) {
    const safe = String(snapshot?.customerKey || snapshot?.profile?.name || '客戶').replace(/[\\/:*?"<>|]/g, '_');
    const end = String(snapshot?.endDate || '').replace(/-/g, '');
    return `百麒國際股份有限公司對帳單_${safe}_${end}`;
}

function text(value) {
    return String(value ?? '').trim();
}

export function canonicalStatement(input) {
    const source = input || {};
    const profile = source.profile || {};
    const totals = source.totals || {};
    const fee = totals.managementFee || {};
    const rebate = totals.rebate || {};
    return {
        customerKey: text(source.customerKey),
        startDate: text(source.startDate),
        endDate: text(source.endDate),
        profile: {
            name: text(profile.name),
            taxId: text(profile.taxId),
            contact: text(profile.contact),
            phone: text(profile.phone),
            address: text(profile.address),
            terms: text(profile.terms),
            method: text(profile.method),
        },
        departments: (source.departments || []).map(dept => ({
            name: text(dept.name),
            total: num(dept.total),
            summary: (dept.summary || []).map(row => ({
                item: text(row.item),
                qty: num(row.qty),
                price: num(row.price),
                amt: num(row.amt),
            })),
            records: (dept.records || []).map(row => ({
                date: text(row.date),
                item: text(row.item),
                qty: num(row.qty),
                price: num(row.price),
                amt: num(row.amt),
                docId: text(row.docId),
            })),
        })),
        totals: {
            grandTotal: num(totals.grandTotal),
            rounded: num(totals.rounded),
            managementFee: { percent: text(fee.percent), amount: num(fee.amount) },
            rebate: { percent: text(rebate.percent), amount: num(rebate.amount) },
            afterRebate: num(totals.afterRebate),
            tax: num(totals.tax),
        },
    };
}

export function snapshotFromParts(input) {
    const snapshot = canonicalStatement(input);
    snapshot.lineRecipient = text(input?.lineRecipient);
    if (!snapshot.customerKey || !snapshot.startDate || !snapshot.endDate || !snapshot.departments.length) {
        throw new Error('對帳單內容不完整，沒有送出。');
    }
    return snapshot;
}

export async function sha256Hex(value) {
    const data = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintOf(snapshot) {
    const { lineRecipient, ...content } = snapshot || {};
    void lineRecipient;
    return sha256Hex(JSON.stringify(canonicalStatement(content)));
}

export async function caseDocumentId(customerKey, startDate, endDate) {
    const digest = await sha256Hex(`${text(customerKey)}\n${text(startDate)}\n${text(endDate)}`);
    return `case_${digest.slice(0, 32)}`;
}

export function latestVersion(doc) {
    const versions = doc?.versions || [];
    return versions.find(version => version.version === doc.latestVersion) || versions[versions.length - 1] || null;
}

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function blankVersion(version, fingerprint, snapshot, createdAt, review = null) {
    return {
        version,
        fingerprint,
        createdAt,
        snapshot: canonicalStatement(snapshot),
        sentAt: null,
        sentFormat: null,
        review,
    };
}

export async function publishSnapshot(existing, snapshot, now = new Date().toISOString()) {
    const content = snapshotFromParts(snapshot);
    const fingerprint = await fingerprintOf(content);
    if (!existing) {
        return {
            action: 'created',
            doc: {
                customerKey: content.customerKey,
                customerName: content.profile.name || content.customerKey,
                startDate: content.startDate,
                endDate: content.endDate,
                lineRecipient: content.lineRecipient || '',
                latestVersion: 1,
                state: 'pending',
                invoiceStatus: 'none',
                invoicedVersion: null,
                versions: [blankVersion(1, fingerprint, content, now)],
                updatedAt: now,
            },
        };
    }
    const current = clone(existing);
    current.versions = (current.versions || []).map(version => clone(version));
    const latest = latestVersion(current);
    if (latest && latest.fingerprint === fingerprint) {
        const lineRecipient = content.lineRecipient || current.lineRecipient || '';
        if (lineRecipient !== (current.lineRecipient || '')) {
            return {
                action: 'unchanged',
                doc: { ...current, lineRecipient, updatedAt: now },
            };
        }
        return { action: 'unchanged', doc: current };
    }
    const nextVersion = Number(current.latestVersion || current.versions.length || 0) + 1;
    if (current.invoiceStatus === 'invoiced') {
        current.versions.push(blankVersion(nextVersion, fingerprint, content, now, 'invoiced_diff'));
        return {
            action: 'needs_review',
            doc: {
                ...current,
                customerName: content.profile.name || current.customerName,
                lineRecipient: content.lineRecipient || current.lineRecipient || '',
                latestVersion: nextVersion,
                state: 'needs_review',
                invoiceStatus: 'invoiced',
                updatedAt: now,
            },
        };
    }
    const anySent = current.versions.some(version => version.sentAt);
    current.versions.push(blankVersion(nextVersion, fingerprint, content, now));
    return {
        action: 'published',
        doc: {
            ...current,
            customerName: content.profile.name || current.customerName,
            lineRecipient: content.lineRecipient || current.lineRecipient || '',
            latestVersion: nextVersion,
            state: anySent ? 'resend' : 'pending',
            invoiceStatus: 'none',
            updatedAt: now,
        },
    };
}

export function applySentRegistration(doc, expectedVersion, format, sentAt) {
    const copy = clone(doc);
    if (!copy) throw new Error('找不到這份帳單，請重新整理。');
    if (copy.state === 'needs_review') throw new Error('這份在開票後內容有變，先不要登記寄出。');
    if (Number(copy.latestVersion) !== Number(expectedVersion)) {
        throw new Error('已經有更新的版本，請重新整理後再登記。');
    }
    const version = (copy.versions || []).find(item => Number(item.version) === Number(expectedVersion));
    if (!version) throw new Error('找不到這個版本。');
    if (!version.sentAt) {
        version.sentAt = sentAt;
        version.sentFormat = format === 'pdf' ? 'pdf' : 'xlsx';
    }
    copy.state = 'sent';
    if (copy.invoiceStatus !== 'invoiced') copy.invoiceStatus = 'ready';
    copy.updatedAt = sentAt;
    return copy;
}

export function applyLineRecipient(doc, lineRecipient, now) {
    const copy = clone(doc);
    if (!copy) throw new Error('找不到這份帳單，請重新整理。');
    copy.lineRecipient = text(lineRecipient);
    copy.updatedAt = now;
    return copy;
}

export function deriveState(doc) {
    const latest = latestVersion(doc);
    if (!latest) return 'pending';
    if (latest.review === 'invoiced_diff' || (doc.invoiceStatus === 'invoiced' && doc.invoicedVersion && latest.version > doc.invoicedVersion)) {
        return 'needs_review';
    }
    if (latest.sentAt) return 'sent';
    if ((doc.versions || []).some(version => version.version < latest.version && version.sentAt)) return 'resend';
    return 'pending';
}

function preferVersion(left, right) {
    const primary = String(left?.createdAt || '') >= String(right?.createdAt || '') ? left : right;
    const secondary = primary === left ? right : left;
    const merged = clone(primary);
    if (!merged.sentAt && secondary?.sentAt) {
        merged.sentAt = secondary.sentAt;
        merged.sentFormat = secondary.sentFormat || merged.sentFormat || null;
    }
    return merged;
}

export function mergeCaseDocs(left, right) {
    if (!left) return clone(right);
    if (!right) return clone(left);
    const versions = new Map();
    for (const version of [...(left.versions || []), ...(right.versions || [])]) {
        const prev = versions.get(version.version);
        versions.set(version.version, prev ? preferVersion(prev, version) : clone(version));
    }
    const ordered = [...versions.values()].sort((a, b) => a.version - b.version);
    const newer = String(left.updatedAt || '') >= String(right.updatedAt || '') ? left : right;
    const merged = {
        ...clone(newer),
        versions: ordered,
        latestVersion: ordered.length ? ordered[ordered.length - 1].version : 0,
        lineRecipient: newer.lineRecipient || left.lineRecipient || right.lineRecipient || '',
        customerName: newer.customerName || left.customerName || right.customerName || '',
    };
    if (left.invoiceStatus === 'invoiced' || right.invoiceStatus === 'invoiced') merged.invoiceStatus = 'invoiced';
    merged.invoicedVersion = left.invoicedVersion || right.invoicedVersion || null;
    merged.state = deriveState(merged);
    if (merged.invoiceStatus !== 'invoiced') merged.invoiceStatus = merged.state === 'sent' ? 'ready' : 'none';
    const remoteVersions = new Set((left.versions || []).map(version => `${version.version}:${version.fingerprint}`));
    const top = latestVersion(merged);
    merged.cloudPending = !(top && remoteVersions.has(`${top.version}:${top.fingerprint}`));
    return merged;
}

export function sortCases(cases) {
    const rank = { needs_review: 0, resend: 1, pending: 2, sent: 3 };
    return [...cases].sort((a, b) => {
        const diff = (rank[a.state] ?? 9) - (rank[b.state] ?? 9);
        if (diff) return diff;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function shipmentCountsByDate(records) {
    const receipts = new Map();
    (records || []).forEach(record => {
        if (!receipts.has(record.date)) receipts.set(record.date, new Set());
        if (record.docId) receipts.get(record.date).add(record.docId);
    });
    return new Map([...receipts].map(([date, ids]) => [date, ids.size]));
}

export function renderStatementHtml(snapshot, template) {
    const content = canonicalStatement(orderStatementSnapshot(snapshot, template));
    const e = escapeHtml;
    const period = `${content.startDate} ~ ${content.endDate}`;
    const profile = content.profile;
    let html = `<section class="report-page report-overview">
        <header class="invoice-header"><div class="invoice-title">百麒國際股份有限公司</div><div class="report-heading">客戶對帳單</div></header>
        <div class="info-boxes">
          <div class="info-box"><div class="info-box-title">客戶資訊</div><table class="info-table"><tbody>
          <tr><td>客戶名稱</td><td>${e(profile.name || content.customerKey)}</td></tr><tr><td>統一編號</td><td>${e(profile.taxId)}</td></tr>
          <tr><td>聯絡人</td><td>${e(profile.contact)}</td></tr><tr><td>聯絡電話</td><td>${e(profile.phone)}</td></tr>
          <tr><td>出貨地址</td><td>${e(profile.address)}</td></tr></tbody></table></div>
          <div class="info-box"><div class="info-box-title">對帳資訊</div><table class="info-table"><tbody>
          <tr><td>對帳期間</td><td>${e(period)}</td></tr><tr><td>幣別</td><td>新台幣 (NTD)</td></tr>
          <tr><td>付款條件</td><td>${e(profile.terms)}</td></tr><tr><td>付款方式</td><td>${e(profile.method)}</td></tr>
          </tbody></table></div></div>
        <h2 class="report-section-title">各部門結算總表</h2>
        <table class="data-table"><thead><tr><th>項次</th><th>部門名稱</th><th>未稅金額</th></tr></thead><tbody>`;
    content.departments.forEach((dept, index) => {
        html += `<tr><td>${index + 1}</td><td style="text-align:left">${e(dept.name)}</td><td style="text-align:right">${formatMoney(dept.total)}</td></tr>`;
    });
    const fee = content.totals.managementFee;
    const rebate = content.totals.rebate;
    html += `</tbody></table>
        <div class="report-totals">
          <div><span>未稅金額</span><b>$${formatMoney(content.totals.rounded)}</b></div>
          ${fee.amount > 0 ? `<div><span>布巾洗滌管理費（${e(fee.percent)}）</span><b>＋$${formatMoney(fee.amount)}</b></div>` : ''}
          ${rebate.amount > 0 ? `<div><span>客戶回饋（${e(rebate.percent)}）</span><b>−$${formatMoney(rebate.amount)}</b></div>` : ''}
          ${(fee.amount > 0 || rebate.amount > 0) ? `<div><span>調整後未稅金額</span><b>$${formatMoney(content.totals.afterRebate)}</b></div>` : ''}
          <div><span>營業稅（5%）</span><b>$${formatMoney(content.totals.tax)}</b></div>
          <div class="report-grand"><span>含稅總金額</span><b>$${formatMoney(payableAmount(content))}</b></div>
        </div></section>`;
    content.departments.forEach(dept => {
        const totalQty = dept.summary.reduce((sum, item) => sum + num(item.qty), 0);
        const density = dept.summary.length > 35 ? ' very-dense' : dept.summary.length > 23 ? ' dense' : '';
        html += `<section class="report-page report-department">
            <header class="invoice-header"><div class="invoice-title">百麒國際股份有限公司</div><div class="report-heading">部門對帳明細</div></header>
            <div class="report-dept-meta"><b>部門：${e(dept.name)}</b><span>對帳期間：${e(period)}</span></div>
            <div class="report-monthly-block${density}">
              <h2 class="report-section-title">01 月總量總結</h2>
              <table class="data-table monthly-table"><thead><tr><th>品項名稱</th><th>總數量</th><th>單價</th><th>未稅金額</th></tr></thead><tbody>`;
        dept.summary.forEach(item => {
            html += `<tr><td style="text-align:left">${e(item.item)}</td><td>${formatMoney(item.qty)}</td><td>${formatMoney(item.price)}</td><td style="text-align:right">${formatMoney(item.amt)}</td></tr>`;
        });
        html += `<tr class="total-row"><td>部門合計</td><td>${formatMoney(totalQty)}</td><td></td><td style="text-align:right">${formatMoney(dept.total)}</td></tr>
              </tbody></table></div>
            <div class="report-detail-block">
              <h2 class="report-section-title">02 交易明細</h2>
              <table class="detail-table"><thead><tr><th>日期</th><th>品項名稱</th><th>數量</th><th>單價</th><th>金額</th></tr></thead><tbody>`;
        const counts = shipmentCountsByDate(dept.records);
        let previousDate = '';
        dept.records.forEach(record => {
            const dateLabel = (counts.get(record.date) || 0) > 1 || record.date !== previousDate ? record.date : '';
            previousDate = record.date;
            html += `<tr><td>${e(dateLabel)}</td><td style="text-align:left">${e(record.item)}</td><td>${formatMoney(record.qty)}</td><td>${formatMoney(record.price)}</td><td style="text-align:right">${formatMoney(record.amt)}</td></tr>`;
        });
        html += `<tr class="total-row"><td colspan="4" style="text-align:right">部門小計</td><td style="text-align:right">${formatMoney(dept.total)}</td></tr></tbody></table></div></section>`;
    });
    return html;
}

export function buildStatementTables(snapshot, template) {
    const content = canonicalStatement(orderStatementSnapshot(snapshot, template));
    const period = `${content.startDate} ~ ${content.endDate}`;
    const entries = content.departments;
    const fee = content.totals.managementFee;
    const rebate = content.totals.rebate;
    const hasManagementFee = fee.amount > 0;
    const hasRebate = rebate.amount > 0;
    const totalRows = [
        ['百麒國際股份有限公司｜客戶對帳總表', '', ''],
        ['客戶名稱', content.profile.name || content.customerKey, ''],
        ['對帳期間', period, ''],
        [],
        ['項次', '部門名稱', '未稅金額'],
    ];
    entries.forEach((dept, index) => totalRows.push([index + 1, dept.name, dept.total]));
    totalRows.push([]);
    totalRows.push(['', '未稅金額', content.totals.rounded]);
    if (hasManagementFee) totalRows.push(['', `布巾洗滌管理費（${fee.percent}）`, fee.amount]);
    if (hasRebate) totalRows.push(['', `客戶回饋（${rebate.percent}）`, -rebate.amount]);
    if (hasManagementFee || hasRebate) totalRows.push(['', '調整後未稅金額', content.totals.afterRebate]);
    totalRows.push(['', '營業稅（5%）', content.totals.tax]);
    totalRows.push(['', '含稅總金額', payableAmount(content)]);
    const totalHeaderRows = [5];
    const totalTotalRows = [];
    const totalSectionRows = [];
    const summaryStart = 5 + entries.length + 2;
    for (let row = summaryStart; row <= totalRows.length; row++) totalTotalRows.push(row);
    totalRows.push([]);
    totalSectionRows.push(totalRows.length + 1);
    totalRows.push(['01 月總量總結', '', '', '']);
    entries.forEach(dept => {
        totalSectionRows.push(totalRows.length + 1);
        totalRows.push([`${dept.name}｜月總量總結`, '', '', '']);
        totalHeaderRows.push(totalRows.length + 1);
        totalRows.push(['品項名稱', '總數量', '單價', '未稅金額']);
        dept.summary.forEach(item => totalRows.push([item.item, item.qty, item.price, item.amt]));
        totalTotalRows.push(totalRows.length + 1);
        const qty = dept.summary.reduce((sum, item) => sum + num(item.qty), 0);
        totalRows.push(['部門合計', qty, '', dept.total]);
        totalRows.push([]);
    });
    const sheets = entries.map(dept => {
        const rows = [
            ['百麒國際股份有限公司｜部門對帳明細'],
            ['部門名稱', dept.name],
            ['對帳期間', period],
            [],
            ['01 月總量總結'],
            ['品項名稱', '總數量', '單價', '未稅金額', ''],
        ];
        dept.summary.forEach(item => rows.push([item.item, item.qty, item.price, item.amt]));
        const qty = dept.summary.reduce((sum, item) => sum + num(item.qty), 0);
        rows.push(['部門合計', qty, '', dept.total]);
        const monthlyEnd = rows.length;
        rows.push([], ['02 交易明細'], ['日期', '品項名稱', '數量', '單價', '金額']);
        const detailHeader = rows.length;
        const counts = shipmentCountsByDate(dept.records);
        let lastDate = '';
        dept.records.forEach(record => {
            const showDate = (counts.get(record.date) || 0) > 1 || record.date !== lastDate;
            rows.push([showDate ? record.date : '', record.item, record.qty, record.price, record.amt]);
            lastDate = record.date;
        });
        const detailQty = dept.records.reduce((sum, record) => sum + num(record.qty), 0);
        rows.push(['', '部門總量', detailQty, '部門小計', dept.total]);
        return { name: dept.name, rows, monthlyEnd, detailHeader };
    });
    return { period, totalRows, totalHeaderRows, totalTotalRows, totalSectionRows, sheets };
}

export function buildStatementWorkbook(XLSX, snapshot, template) {
    const tables = buildStatementTables(snapshot, template);
    const wb = XLSX.utils.book_new();
    const navy = '173C36', pale = 'F5F0E5', white = 'FFFFFF', ink = '293D38';
    const style = (fill, bold = false, color = ink, size = 11, align = 'left') => ({
        font: { name: 'Noto Serif TC', sz: size, bold: true, color: { rgb: color } },
        fill: { fgColor: { rgb: fill } },
        alignment: { horizontal: align, vertical: 'center', wrapText: true },
        border: {
            top: { style: 'thin', color: { rgb: 'D9DFD8' } },
            bottom: { style: 'thin', color: { rgb: 'D9DFD8' } },
            left: { style: 'thin', color: { rgb: 'E8E1D4' } },
            right: { style: 'thin', color: { rgb: 'E8E1D4' } },
        },
    });
    const titleStyle = style(navy, true, white, 22);
    const sectionStyle = style(pale, true, navy, 17);
    const headStyle = style(navy, true, white, 15, 'center');
    const totalStyle = style(pale, true, navy, 16);
    const numberFormat = '#,##0.##';
    const formatData = (ws, rows, numericCols, headers, totals, sections) => {
        rows.forEach((row, ri) => row.forEach((value, ci) => {
            const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
            if (!ws[addr]) return;
            const isTotal = totals.includes(ri + 1), isHeader = headers.includes(ri + 1), isSection = sections.includes(ri + 1);
            const fill = isTotal ? pale : ri % 2 ? 'F8F8F2' : white;
            ws[addr].s = isHeader ? headStyle : isSection ? sectionStyle : isTotal ? totalStyle : ri === 0 ? titleStyle : style(fill, false, ink, 14, numericCols.includes(ci) ? 'right' : 'left');
            if (typeof value === 'number' || (typeof value === 'string' && /^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s*[~～-]\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2})?\s*$/.test(value))) {
                if (typeof value === 'number') ws[addr].z = numberFormat;
                ws[addr].s = { ...ws[addr].s, font: { ...ws[addr].s.font, name: 'Georgia' } };
            }
        }));
        ws['!rows'] = rows.map((_, ri) => ({ hpt: ri === 0 ? 45 : headers.includes(ri + 1) || sections.includes(ri + 1) ? 37 : totals.includes(ri + 1) ? 36 : 33 }));
        ws['!margins'] = { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0, footer: 0 };
        ws['!pageSetup'] = { orientation: 'portrait', paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
        ws['!header'] = '';
        ws['!footer'] = '';
    };
    const totalSheet = XLSX.utils.aoa_to_sheet(tables.totalRows);
    totalSheet['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 22 }, { wch: 24 }];
    totalSheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
        { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } },
        { s: { r: 2, c: 1 }, e: { r: 2, c: 3 } },
    ];
    tables.totalSectionRows.forEach(row => totalSheet['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 3 } }));
    formatData(totalSheet, tables.totalRows, [0, 1, 2, 3], tables.totalHeaderRows, tables.totalTotalRows, tables.totalSectionRows);
    tables.totalTotalRows.forEach(row => {
        for (let column = 0; column < 4; column++) {
            const addr = XLSX.utils.encode_cell({ r: row - 1, c: column });
            if (totalSheet[addr]) {
                totalSheet[addr].s = {
                    ...totalSheet[addr].s,
                    alignment: { ...totalSheet[addr].s.alignment, wrapText: false, vertical: 'center' },
                };
            }
        }
        totalSheet['!rows'][row - 1] = { hpt: 30 };
    });
    const deptCount = (snapshot.departments || []).length;
    for (let row = 6; row < 6 + deptCount; row++) {
        const a = XLSX.utils.encode_cell({ r: row - 1, c: 0 });
        const b = XLSX.utils.encode_cell({ r: row - 1, c: 1 });
        const c = XLSX.utils.encode_cell({ r: row - 1, c: 2 });
        if (totalSheet[a]) totalSheet[a].s = { ...totalSheet[a].s, alignment: { horizontal: 'center', vertical: 'center', wrapText: false } };
        if (totalSheet[b]) totalSheet[b].s = { ...totalSheet[b].s, alignment: { horizontal: 'left', vertical: 'center', wrapText: false } };
        if (totalSheet[c]) totalSheet[c].s = { ...totalSheet[c].s, alignment: { horizontal: 'right', vertical: 'center', wrapText: false } };
    }
    totalSheet['!print_area'] = `A1:D${tables.totalRows.length}`;
    XLSX.utils.book_append_sheet(wb, totalSheet, '結算總表');
    const usedNames = new Set(['結算總表']);
    const allocateName = raw => {
        let sheetName = String(raw || '').replace(/[\\/?*[\]]/g, '_').slice(0, 31) || '未命名部門';
        const base = sheetName;
        for (let n = 2; usedNames.has(sheetName); n++) sheetName = `${base.slice(0, 31 - String(n).length - 1)}_${n}`;
        usedNames.add(sheetName);
        return sheetName;
    };
    tables.sheets.forEach(sheet => {
        const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
        ws['!cols'] = [{ wch: 26 }, { wch: 44 }, { wch: 19 }, { wch: 21 }, { wch: 25 }];
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
            { s: { r: 4, c: 0 }, e: { r: 4, c: 4 } },
            { s: { r: sheet.monthlyEnd + 1, c: 0 }, e: { r: sheet.monthlyEnd + 1, c: 4 } },
        ];
        formatData(ws, sheet.rows, [1, 2, 3, 4], [6, sheet.detailHeader], [sheet.monthlyEnd, sheet.rows.length], [5, sheet.monthlyEnd + 2]);
        ws['!print_area'] = `A1:E${sheet.rows.length}`;
        XLSX.utils.book_append_sheet(wb, ws, allocateName(sheet.name));
    });
    return wb;
}
