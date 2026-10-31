// Browser check: a statement generated from logistics rows that include 回洗
// shows neither the department nor its amounts in the dispatch preview.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseDocumentId, publishSnapshot } from '../statement-case.js';
import { rowsForPeriod, createInvoiceEngine } from '../firebase-signature/functions/lib/auto-close.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debugPort = 9334;
const outDir = process.env.REWASH_SCREENSHOT_DIR || '/tmp/rewash-statement-screenshots';
fs.mkdirSync(outDir, { recursive: true });

const docs = [
    { id: 'house', data: { date: '2026-10-02', hotelKeyword: '驛館', deptName: '房務', items: [
        { itemName: '床單', actualQty: 4, price: 10 },
        { itemName: '回洗床單', actualQty: 9, price: 10 },
    ] } },
    { id: 'rewash', data: { date: '2026-10-03', hotelKeyword: '驛館', deptName: '回洗', items: [
        { itemName: '羽毛被', actualQty: 3, price: 50 },
    ] } },
    { id: 'special', data: { date: '2026-10-06', hotelKeyword: '驛館', deptName: '特處', items: [
        { itemName: '特處床單', actualQty: 2, price: 15 },
    ] } },
];
const rows = rowsForPeriod(docs, '驛館', '2026-10-01', '2026-10-25');
const engine = createInvoiceEngine({
    logisticsMasterItems: [
        { hotel: '驛館 房務', item: '床單' },
        { hotel: '驛館 特處', item: '特處床單' },
        { hotel: '驛館 回洗', item: '羽毛被' },
    ],
    pricingRules: { holidays: [], rebates: [], managementFees: [] },
    effectivePriceRules: [],
    sheetPrices: {},
    customPrices: {},
    sheetClients: { 驛館: { name: '驛館股份有限公司', taxId: '87654321' } },
    rawLogisticsData: rows,
});
const generated = engine.build('驛館', '2026-10-01', '2026-10-25');

function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
        if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
        if (url.pathname === '/receivable-check.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><meta charset="utf-8"><title>應收對照</title>
<body style="font-family:sans-serif;padding:32px;background:#f4f6f2">
<h1>同一家飯店、同一帳期</h1>
<p id="status">計算中…</p>
<pre id="out" style="font-size:20px;line-height:1.6"></pre>
<script type="module">
import { createInvoiceEngine } from './firebase-signature/functions/lib/auto-close.js';
import { statementReceivable, sumCustomerReceivables, sumGroupFigures } from './firebase-signature/functions/lib/receivable.js';
const row = { docId:'a', receiptOrder:0, date:'2026-10-25', parentCompany:'富野', hotel:'富野 房務', item:'床單', qty:10, savedPrice:5 };
const rules = { holidays:[{hotel:'富野',start:'2026-10-25',end:'2026-10-25',percent:10}], rebates:[{hotel:'富野',percent:10}], managementFees:[{hotel:'富野',percent:5}] };
const engine = createInvoiceEngine({ logisticsMasterItems:[{hotel:'富野 房務',item:'床單'}], pricingRules:rules, effectivePriceRules:[{key:'富野 房務_床單',start:'2026-10-01',price:12.34}], sheetPrices:{}, customPrices:{}, sheetClients:{富野:{name:'富野股份有限公司',taxId:'12345678'}}, rawLogisticsData:[row] });
const statement = engine.build('富野','2026-09-26','2026-10-25');
const bill = statementReceivable([row], engine.reportRecordPrice, rules.rebates[0], rules.managementFees[0]);
const dashboard = sumCustomerReceivables([row], engine.reportRecordPrice, () => ({ rebate: rules.rebates[0], managementFee: rules.managementFees[0] }));
const header = sumGroupFigures([dashboard, { untaxed:0, tax:0, final:0, managementFee:0, rebate:0 }]);
const statementPayable = statement.totals.afterRebate + statement.totals.tax;
const same = statementPayable === bill.payable && bill.payable === dashboard.final && dashboard.final === header.final;
document.getElementById('status').textContent = same ? '對帳單、戰情室、Excel 應收金額一致' : '金額不一致';
document.getElementById('out').textContent = [
  '富野 2026-09-26～2026-10-25',
  '對帳單含稅 ' + statementPayable,
  '戰情室含稅 ' + dashboard.final,
  'Excel 含稅 ' + header.final,
  '未稅 ' + statement.totals.rounded + '　管理費 ' + statement.totals.managementFee.amount + '　回饋 ' + statement.totals.rebate.amount + '　稅 ' + statement.totals.tax,
].join('\\n');
document.body.dataset.ready = same ? 'yes' : 'no';
</script></body>`);
            return;
        }
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8'
                : file.endsWith('.html') ? 'text/html; charset=utf-8'
                : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/plain';
            res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
            res.end(data);
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitJson(url) {
    for (let i = 0; i < 50; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return res.json();
        } catch { /* chrome still starting */ }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Chrome 偵錯埠沒有起來');
}

function connect(url) {
    const ws = new WebSocket(url);
    let seq = 0;
    const pending = new Map();
    const listeners = [];
    return new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve({
            send(method, params = {}, sessionId) {
                const id = ++seq;
                return new Promise((res, rej) => {
                    pending.set(id, { res, rej });
                    ws.send(JSON.stringify({ id, method, params, sessionId }));
                });
            },
            on(fn) { listeners.push(fn); },
            close() { ws.close(); },
        }));
        ws.addEventListener('error', () => reject(new Error('連不到 Chrome')));
        ws.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id && pending.has(message.id)) {
                const { res, rej } = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) rej(new Error(JSON.stringify(message.error)));
                else res(message.result);
            } else listeners.forEach(fn => fn(message));
        });
    });
}

async function openPage(browser, url) {
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    const attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    const sessionId = attached.sessionId;
    const send = (method, params) => browser.send(method, params, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');
    const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('頁面載入逾時 ' + url)), 20000);
        browser.on(message => {
            if (message.method === 'Page.loadEventFired' && message.sessionId === sessionId) {
                clearTimeout(timer);
                resolve();
            }
        });
    });
    await send('Page.navigate', { url });
    await loaded;
    return { send, close: () => browser.send('Target.closeTarget', { targetId: created.targetId }) };
}

async function evaluate(page, expression) {
    const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    return result.result.value;
}

async function waitFor(page, expression) {
    const start = Date.now();
    let last = '';
    while (Date.now() - start < 25000) {
        try { last = await evaluate(page, expression); }
        catch { last = ''; }
        if (last) return last;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    const body = await evaluate(page, 'document.body.innerText');
    throw new Error('等不到預期畫面。目前畫面：\n' + body);
}

async function shot(page, name) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
}

const server = await startServer();
const port = server.address().port;
const profile = fs.mkdtempSync('/tmp/chrome-rewash-');
const chrome = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage',
    '--window-size=1280,900',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

try {
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    const browser = await connect(version.webSocketDebuggerUrl);
    const base = `http://127.0.0.1:${port}`;
    const created = await publishSnapshot(null, generated, '2026-10-25T04:00:00.000Z');
    const id = await caseDocumentId('驛館', '2026-10-01', '2026-10-25');
    const stored = { ...created.doc, id, cloudPending: false };
    if (JSON.stringify(stored).includes('回洗') || JSON.stringify(stored).includes('羽毛被')) {
        throw new Error('產生出來的對帳單仍含回洗');
    }
    if (stored.versions[0].snapshot.totals.grandTotal !== 70) throw new Error('合計仍把回洗算進去');

    const dispatch = await openPage(browser, `${base}/statement-dispatch.html?store=local`);
    await evaluate(dispatch, `localStorage.setItem('baiqi_statement_cases_v1', ${JSON.stringify(JSON.stringify({ [id]: stored }))})`);
    try { await evaluate(dispatch, 'location.reload()'); } catch { /* reload ends this call */ }
    await new Promise(resolve => setTimeout(resolve, 500));
    await waitFor(dispatch, `document.querySelector('.hotel')?.textContent === '驛館' && document.body.innerText.includes('待寄送')`);
    const listText = await evaluate(dispatch, 'document.body.innerText');
    if (listText.includes('回洗') || listText.includes('羽毛被')) throw new Error('送件清單仍顯示回洗');
    const listShot = await shot(dispatch, 'dispatch-list.png');
    await evaluate(dispatch, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('核對帳單')).click()`);
    await waitFor(dispatch, `document.getElementById('preview').classList.contains('show') && document.getElementById('previewPaper').innerText.includes('特處床單') && document.getElementById('previewPaper').innerText.includes('含稅總金額')`);
    const preview = await evaluate(dispatch, `document.getElementById('previewPaper').innerText`);
    for (const banned of ['回洗', '羽毛被', '重洗']) {
        if (preview.includes(banned)) throw new Error('預覽仍出現 ' + banned + '\n' + preview);
    }
    if (!preview.includes('驛館 房務') || !preview.includes('床單') || !preview.includes('驛館 特處')) {
        throw new Error('正常部門不見了\n' + preview);
    }
    if (!preview.includes('70') || preview.includes('150') || preview.includes('240')) {
        throw new Error('金額不對\n' + preview);
    }
    const previewShot = await shot(dispatch, 'statement-preview.png');
    await evaluate(dispatch, `document.querySelector('#preview .scroll').scrollTop = 900`);
    await new Promise(resolve => setTimeout(resolve, 200));
    const linesShot = await shot(dispatch, 'statement-lines.png');
    await dispatch.close();
    console.log('瀏覽器驗證通過');
    console.log(listShot);
    console.log(previewShot);
    console.log(linesShot);
    const check = await openPage(browser, `${base}/receivable-check.html`);
    await waitFor(check, `document.body.dataset.ready === 'yes'`);
    const checkShot = await shot(check, 'receivable-match.png');
    const finance = await openPage(browser, `${base}/finance.html`);
    await waitFor(finance, `typeof window.switchSysTab === 'function'`);
    await evaluate(finance, `window.switchSysTab('boss'); document.getElementById('bossDashboardContent').classList.remove('hidden'); document.getElementById('bossEmptyState').classList.add('hidden');`);
    await waitFor(finance, `document.body.innerText.includes('布巾洗滌管理費') && document.body.innerText.includes('兩組合計・含稅應收')`);
    const dashShot = await shot(finance, 'dashboard-header.png');
    console.log(checkShot);
    console.log(dashShot);
    await check.close();
    await finance.close();
    browser.close();
    console.log(preview);
} finally {
    chrome.kill();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
}
