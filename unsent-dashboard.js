// 本期未送對帳單與未開發票。只算各組「最近一個已到結帳日」的區間。
// 寄出與否看 statement_cases 最新版的 sentAt（送件中心「我已寄出」）。
// 發票看同一份案件的 invoiceStatus／invoiceRecord／invoicedVersion（貨款登記）。
// 不聽即時更新，也不掃整份對帳單或出貨紀錄。

import { canonicalHotelKeyword, settlementGroup, statementHotelKey } from './firebase-signature/functions/lib/auto-close.js';

const DEPARTMENT_PARENTS = new Set(['鼎王']);

export function settlementGroupOf(hotel, groups = {}) {
    return settlementGroup(hotel, groups);
}

export const BILLING_GROUP_ORDER = Object.freeze(['25th', 'month', '1st']);
export const BILLING_GROUP_LABELS = Object.freeze({
    '25th': '25號',
    month: '月底',
    '1st': '1號',
});

export function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year, monthIndex, day) {
    return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function parseDate(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (m < 1 || m > 12) return null;
    const last = lastDayOfMonth(y, m);
    if (d < 1 || d > last) return null;
    return { y, m, d, last };
}

function pad(value) {
    return String(value).padStart(2, '0');
}

// 結帳日當天要涵蓋的出貨區間。1號組是「前一個曆月」，在每月 1 日出帳。
export function periodOnBillingDay(group, billingDate) {
    const parsed = parseDate(billingDate);
    if (!parsed) return null;
    const { y, m, d, last } = parsed;
    if (group === '25th' && d === 25) return { start: iso(y, m - 2, 26), end: billingDate };
    if (group === 'month' && d === last) return { start: iso(y, m - 1, 1), end: billingDate };
    if (group === '1st' && d === 1) return { start: iso(y, m - 2, 1), end: iso(y, m - 1, 0) };
    return null;
}

export function currentBillingPeriods(today) {
    const parsed = parseDate(today);
    if (!parsed) return null;
    const { y, m, d, last } = parsed;
    const ym = `${y}-${pad(m)}`;
    return {
        '25th': periodOnBillingDay('25th', d >= 25 ? `${ym}-25` : iso(y, m - 2, 25)),
        month: periodOnBillingDay('month', d === last ? today : iso(y, m - 1, 0)),
        '1st': periodOnBillingDay('1st', `${ym}-01`),
    };
}

// 下一次 1 號出帳要涵蓋的曆月。10/31 的下一期是 10/1–10/31，11/1 出帳。
export function nextFirstBill(today) {
    const parsed = parseDate(today);
    if (!parsed) return null;
    const { y, m } = parsed;
    return { start: iso(y, m - 1, 1), end: iso(y, m, 0), billOn: iso(y, m, 1) };
}

export function periodEndDates(periods) {
    return [...new Set(BILLING_GROUP_ORDER.map(id => periods?.[id]?.end).filter(Boolean))];
}

export function taipeiToday(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
}

function latestVersion(doc) {
    const versions = doc?.versions || [];
    return versions.find(version => Number(version.version) === Number(doc.latestVersion)) || versions[versions.length - 1] || null;
}

export function sendState(doc) {
    if (!doc) return { kind: 'missing', label: '尚未產生' };
    const latest = latestVersion(doc);
    if (!latest) return { kind: 'missing', label: '尚未產生' };
    const staleInvoice = latest.review === 'invoiced_diff'
        || (doc.invoiceStatus === 'invoiced' && doc.invoicedVersion && Number(latest.version) > Number(doc.invoicedVersion));
    if (latest.sentAt) return { kind: 'sent', label: '已送出' };
    if (staleInvoice) return { kind: 'unsent', label: '已產生未送（開票後有變）' };
    if ((doc.versions || []).some(version => Number(version.version) < Number(latest.version) && version.sentAt)) {
        return { kind: 'unsent', label: '已產生未送（新版待重寄）' };
    }
    return { kind: 'unsent', label: '已產生未送' };
}

export function invoiceMark(doc) {
    if (!doc || !latestVersion(doc)) return { kind: 'missing', label: '尚未產生', open: true };
    const latest = latestVersion(doc);
    const hasInvoice = !!(doc.invoiceRecord || doc.invoiceStatus === 'invoiced');
    if (hasInvoice && Number(doc.invoicedVersion) === Number(latest.version)) {
        return { kind: 'invoiced', label: '已開票', open: false };
    }
    if (hasInvoice) return { kind: 'stale', label: '開票後有變', open: true };
    return { kind: 'open', label: '未開發票', open: true };
}

function byName(left, right) {
    return String(left.name || left).localeCompare(String(right.name || right), 'zh-TW');
}

function rosterParents(baseNames, groups) {
    const names = new Set();
    for (const name of [...(baseNames || []), ...Object.keys(groups || {})]) {
        const key = statementHotelKey(name);
        if (key && !key.includes('回洗')) names.add(key);
    }
    return [...names].sort(byName);
}

function customersFor(parent, items, cases, period) {
    if (!DEPARTMENT_PARENTS.has(parent)) return [parent];
    const names = new Set();
    for (const item of items || []) {
        const base = canonicalHotelKeyword(item?.baseName);
        const hotel = String(item?.hotel || '').trim();
        if (base !== parent || !hotel || hotel === parent || hotel.includes('回洗')) continue;
        names.add(hotel);
    }
    for (const row of cases || []) {
        const key = String(row?.customerKey || '').trim();
        if (!key.startsWith(`${parent} `) || key.includes('回洗')) continue;
        if (row.startDate === period.start && row.endDate === period.end) names.add(key);
    }
    return names.size ? [...names].sort(byName) : [parent];
}

function findCase(cases, name, period) {
    return (cases || []).find(row => row?.customerKey === name && row.startDate === period.start && row.endDate === period.end) || null;
}

function parentOf(name, parents) {
    const sorted = [...parents].sort((a, b) => b.length - a.length);
    return sorted.find(parent => name === parent || name.startsWith(`${parent} `)) || '';
}

export function buildUnsentBoard({ today, baseNames = [], items = [], groups = {}, cases = [] }) {
    const periods = currentBillingPeriods(today);
    if (!periods) throw new Error('日期不正確，不能統計未送對帳單。');
    const parents = rosterParents(baseNames, groups);
    const rows = { '25th': [], month: [], '1st': [] };
    const seen = new Set();
    const unset = [];
    const unsupported = [];
    const addRow = (group, name, doc) => {
        const key = `${group}\n${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        const send = sendState(doc);
        const invoice = invoiceMark(doc);
        rows[group].push({
            name,
            note: name === 'H2O' ? '含 H2O 西餐' : '',
            sendLabel: send.label,
            unsent: send.kind !== 'sent',
            invoiceLabel: invoice.label,
            uninvoiced: invoice.open,
        });
    };
    for (const parent of parents) {
        const group = settlementGroupOf(parent, groups);
        if (group === '') {
            unset.push(parent);
            continue;
        }
        if (!rows[group]) {
            unsupported.push({ name: parent, value: String(group) });
            continue;
        }
        const period = periods[group];
        for (const name of customersFor(parent, items, cases, period)) addRow(group, name, findCase(cases, name, period));
    }
    for (const row of cases || []) {
        const rawName = String(row?.customerKey || '').trim();
        const name = statementHotelKey(rawName);
        if (!name || name.includes('回洗') || name !== rawName) continue;
        const parent = parentOf(name, parents);
        const group = parent ? settlementGroupOf(parent, groups) : settlementGroupOf(name, groups);
        const period = periods[group];
        if (!period || row.startDate !== period.start || row.endDate !== period.end) continue;
        addRow(group, name, row);
    }
    const groupsOut = BILLING_GROUP_ORDER.map(id => {
        const list = rows[id].sort(byName);
        return {
            id,
            label: BILLING_GROUP_LABELS[id],
            period: periods[id],
            upcoming: id === '1st' ? nextFirstBill(today) : null,
            unsent: list.filter(row => row.unsent),
            uninvoiced: list.filter(row => row.uninvoiced),
            unsentCount: list.filter(row => row.unsent).length,
            uninvoicedCount: list.filter(row => row.uninvoiced).length,
        };
    });
    return {
        today,
        periods,
        groups: groupsOut,
        unset: unset.sort(byName),
        unsupported: unsupported.sort(byName),
    };
}

function slash(value) {
    return String(value || '').replace(/-/g, '/');
}

export function formatBoardPeriod(period) {
    return `${slash(period?.start)}－${slash(period?.end)}`;
}

const STYLE = `
.baiqi-unsent{background:#fff;border:1px solid #e1e7df;border-radius:18px;padding:16px;margin:0 0 18px;color:#24332f;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","Microsoft JhengHei",sans-serif}
.baiqi-unsent h2{margin:0;font-size:22px;line-height:1.3}
.baiqi-unsent .baiqi-unsent-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.baiqi-unsent .baiqi-unsent-lead{margin:8px 0 0;color:#5d6d64;font-size:13px;line-height:1.6}
.baiqi-unsent button{font:inherit;cursor:pointer}
.baiqi-unsent .baiqi-unsent-refresh{border:1px solid #d5e0d8;background:#fff;color:#315e4c;border-radius:10px;padding:10px 14px;font-weight:800;min-height:44px;white-space:nowrap}
.baiqi-unsent-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}
.baiqi-unsent-card{border:1px solid #e4ebe4;border-radius:16px;background:#fbfcfb;overflow:hidden}
.baiqi-unsent-card.alert{border-color:#ead7b4;background:#fffaf2}
.baiqi-unsent-card.ok{border-color:#cfe3d4;background:#f4faf6}
.baiqi-unsent-card summary{list-style:none;cursor:pointer;padding:16px;min-height:44px}
.baiqi-unsent-card summary::-webkit-details-marker{display:none}
.baiqi-unsent-kicker{font-size:15px;font-weight:800;color:#315e4c}
.baiqi-unsent-count{font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.2;margin-top:4px}
.baiqi-unsent-count.second{font-size:22px;margin-top:2px}
.baiqi-unsent-card.alert .baiqi-unsent-count{color:#8a4e10}
.baiqi-unsent-card.ok .baiqi-unsent-count{color:#1d6a42}
.baiqi-unsent-period{color:#66756c;font-size:13px;margin-top:8px}
.baiqi-unsent-tap{color:#315e4c;font-size:12px;font-weight:700;margin-top:8px}
.baiqi-unsent-body{padding:0 16px 16px;display:grid;gap:14px}
.baiqi-unsent-body h3{margin:0 0 8px;font-size:14px}
.baiqi-unsent-body ul{list-style:none;margin:0;padding:0;max-height:280px;overflow:auto;-webkit-overflow-scrolling:touch}
.baiqi-unsent-body li{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid #e6eee7;font-size:15px}
.baiqi-unsent-name{font-weight:700;min-width:0;flex:1;overflow-wrap:anywhere}
.baiqi-unsent-status{color:#6a5840;background:#f6f0e4;border-radius:12px;padding:4px 8px;font-size:12px;font-weight:700;line-height:1.35;text-align:right;max-width:12em}
.baiqi-unsent-note{margin:12px 0 0;font-size:13px;line-height:1.6;color:#6b5b3e;background:#fbf6ea;border:1px solid #efe3c8;border-radius:12px;padding:10px 12px}
.baiqi-unsent-foot{margin:12px 0 0;color:#74827a;font-size:12px;line-height:1.6}
@media(min-width:840px){.baiqi-unsent-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.baiqi-unsent{padding:18px 18px 16px}.baiqi-unsent h2{font-size:24px}}
`;

function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById('baiqi-unsent-style')) return;
    const style = document.createElement('style');
    style.id = 'baiqi-unsent-style';
    style.textContent = STYLE;
    document.head.append(style);
}

function countLine(count, emptyText, pendingText) {
    return count ? pendingText.replace('N', String(count)) : emptyText;
}

function nameList(rows, labelKey, emptyText) {
    const ul = document.createElement('ul');
    if (!rows.length) {
        const li = document.createElement('li');
        li.textContent = emptyText;
        ul.append(li);
        return ul;
    }
    for (const row of rows) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'baiqi-unsent-name';
        name.textContent = row.note ? `${row.name}（${row.note}）` : row.name;
        const status = document.createElement('span');
        status.className = 'baiqi-unsent-status';
        status.textContent = row[labelKey];
        li.append(name, status);
        ul.append(li);
    }
    return ul;
}

export function renderUnsentBoard(board, onRefresh) {
    ensureStyle();
    const root = document.createElement('section');
    root.className = 'baiqi-unsent';
    root.setAttribute('aria-label', '未送對帳單');
    const head = document.createElement('div');
    head.className = 'baiqi-unsent-head';
    const titles = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = '未送對帳單・未開發票';
    const lead = document.createElement('p');
    lead.className = 'baiqi-unsent-lead';
    lead.textContent = `統計日 ${slash(board.today)}（台北）。各組只看最近一個已經到結帳日的區間，下一期還沒結的不算。點卡片可看飯店。`;
    titles.append(heading, lead);
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'baiqi-unsent-refresh';
    refresh.textContent = '重新整理';
    refresh.onclick = () => onRefresh?.();
    head.append(titles, refresh);
    const grid = document.createElement('div');
    grid.className = 'baiqi-unsent-grid';
    for (const group of board.groups) {
        const card = document.createElement('details');
        card.className = 'baiqi-unsent-card ' + (group.unsentCount || group.uninvoicedCount ? 'alert' : 'ok');
        const summary = document.createElement('summary');
        const kicker = document.createElement('div');
        kicker.className = 'baiqi-unsent-kicker';
        kicker.textContent = group.label;
        const unsent = document.createElement('div');
        unsent.className = 'baiqi-unsent-count';
        unsent.textContent = countLine(group.unsentCount, '本期都已送出', '還有 N 間未送');
        const invoice = document.createElement('div');
        invoice.className = 'baiqi-unsent-count second';
        invoice.textContent = countLine(group.uninvoicedCount, '本期都已開發票', '還有 N 間未開發票');
        const period = document.createElement('div');
        period.className = 'baiqi-unsent-period';
        const periodBits = [formatBoardPeriod(group.period)];
        if (group.id === '25th') periodBits.push('H2O 西餐與 H2O 同一張對帳單');
        if (group.id === '1st') periodBits[0] += '（這期結帳日已到）';
        period.textContent = periodBits.join('　');
        const tap = document.createElement('div');
        tap.className = 'baiqi-unsent-tap';
        tap.textContent = '點一下展開飯店';
        summary.append(kicker, unsent, invoice, period);
        if (group.id === '1st' && group.upcoming) {
            const upcoming = document.createElement('div');
            upcoming.className = 'baiqi-unsent-period';
            upcoming.textContent = `下一期 ${formatBoardPeriod(group.upcoming)}，${slash(group.upcoming.billOn)} 出帳`;
            summary.append(upcoming);
        }
        summary.append(tap);
        const body = document.createElement('div');
        body.className = 'baiqi-unsent-body';
        const sendTitle = document.createElement('h3');
        sendTitle.textContent = '未送';
        const sendBlock = document.createElement('div');
        sendBlock.append(sendTitle, nameList(group.unsent, 'sendLabel', '這組本期都已送出'));
        const invoiceTitle = document.createElement('h3');
        invoiceTitle.textContent = '未開發票';
        const invoiceBlock = document.createElement('div');
        invoiceBlock.append(invoiceTitle, nameList(group.uninvoiced, 'invoiceLabel', '這組本期都已開發票'));
        body.append(sendBlock, invoiceBlock);
        card.append(summary, body);
        grid.append(card);
    }
    root.append(head, grid);
    if (board.unset.length || board.unsupported.length) {
        const note = document.createElement('p');
        note.className = 'baiqi-unsent-note';
        const parts = [];
        if (board.unset.length) parts.push(`未設定結帳日：${board.unset.join('、')}。這幾間不在上面三組。`);
        if (board.unsupported.length) parts.push(`結帳日無法辨識：${board.unsupported.map(item => `${item.name}（${item.value}）`).join('、')}。`);
        note.textContent = parts.join('');
        root.append(note);
    }
    const foot = document.createElement('p');
    foot.className = 'baiqi-unsent-foot';
    foot.textContent = '未送是指最新一版還沒按「我已寄出」（含尚未產生、已產生未送、新版待重寄）。未開發票是指這一版在貨款登記裡還沒有發票紀錄。請到「貨款登記」登錄發票號碼。';
    root.append(foot);
    return root;
}

function messageBoard(text, onRefresh) {
    ensureStyle();
    const root = document.createElement('section');
    root.className = 'baiqi-unsent';
    const heading = document.createElement('h2');
    heading.textContent = '未送對帳單・未開發票';
    const lead = document.createElement('p');
    lead.className = 'baiqi-unsent-lead';
    lead.textContent = text;
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'baiqi-unsent-refresh';
    refresh.textContent = '重新整理';
    refresh.onclick = () => onRefresh?.();
    root.append(heading, lead, refresh);
    return root;
}

export async function loadUnsentBoard(db, fs, today = taipeiToday()) {
    const [groupsSnap, templateSnap] = await Promise.all([
        fs.getDocFromServer(fs.doc(db, 'inventory_config', 'finance_settlement_groups')),
        fs.getDocFromServer(fs.doc(db, 'inventory_config', 'master_template')),
    ]);
    const groups = groupsSnap.exists() ? (groupsSnap.data()?.groups || {}) : {};
    const items = templateSnap.exists() ? (templateSnap.data()?.items || []) : [];
    const baseNames = items.map(item => item?.baseName).filter(Boolean);
    const ends = periodEndDates(currentBillingPeriods(today));
    const caseSnap = await fs.getDocsFromServer(fs.query(
        fs.collection(db, 'statement_cases'),
        fs.where('endDate', 'in', ends),
    ));
    const cases = caseSnap.docs.map(row => ({ id: row.id, ...row.data() }));
    return buildUnsentBoard({ today, baseNames, items, groups, cases });
}

export function mountUnsentDashboard(container, { db, fs, today, load } = {}) {
    if (!container) return { reload() {} };
    let sequence = 0;
    let timer = 0;
    const reload = () => {
        const token = ++sequence;
        container.replaceChildren(messageBoard('讀取本期未送與未開發票…', reload));
        const job = load
            ? load()
            : loadUnsentBoard(db, fs, typeof today === 'function' ? today() : (today || taipeiToday()));
        Promise.resolve(job).then(board => {
            if (token !== sequence) return;
            container.replaceChildren(renderUnsentBoard(board, reload));
        }).catch(error => {
            if (token !== sequence) return;
            container.replaceChildren(messageBoard(error?.message || '讀取失敗。還沒讀完，不能當成全部已送或已開發票。', reload));
        });
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(reload, 400);
    };
    window.addEventListener('baiqi-sent-registered', schedule);
    window.addEventListener('message', event => {
        if (event.origin !== location.origin) return;
        if (event.data?.type === 'baiqi-ledger-updated' || event.data?.type === 'baiqi-refresh-statements') schedule();
    });
    reload();
    return { reload };
}
