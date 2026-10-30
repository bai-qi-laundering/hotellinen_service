// Headless Chrome check: a generated statement shows up in the dispatch center,
// the preview is the real bill, and "downloaded" is not treated as sent.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseDocumentId, publishSnapshot, snapshotFromParts } from '../statement-case.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debugPort = 9333;

function snapshot() {
    return snapshotFromParts({
        customerKey: '驗證飯店',
        startDate: '2026-10-01',
        endDate: '2026-10-25',
        lineRecipient: '採購窗口',
        profile: {
            name: '驗證飯店股份有限公司', taxId: '12345678', contact: '採購窗口',
            phone: '07-0000000', address: '高雄市', terms: '月結 30 天', method: '銀行匯款',
        },
        departments: [{
            name: '驗證飯店 房務',
            total: 2000,
            summary: [{ item: '驗證浴巾', qty: 10, price: 20, amt: 200 }],
            records: [{ date: '2026-10-02', item: '驗證浴巾', qty: 10, price: 20, amt: 200, docId: 'a' }],
        }],
        totals: {
            grandTotal: 2000, rounded: 2000,
            managementFee: { percent: '', amount: 0 },
            rebate: { percent: '', amount: 0 },
            afterRebate: 2000, tax: 100,
        },
    });
}

function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
        if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain';
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
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.__errors=[];window.__alerts=[];window.alert=m=>window.__alerts.push(String(m));window.print=()=>{window.__printed=true};addEventListener("error",e=>window.__errors.push(String(e.message)));addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason&&e.reason.message||e.reason)));',
    });
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

const server = await startServer();
const port = server.address().port;
const profile = fs.mkdtempSync('/tmp/chrome-statement-');
const chrome = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

try {
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    const browser = await connect(version.webSocketDebuggerUrl);
    const base = `http://127.0.0.1:${port}`;
    const created = await publishSnapshot(null, snapshot(), '2026-10-30T01:00:00.000Z');
    const id = await caseDocumentId('驗證飯店', '2026-10-01', '2026-10-25');
    const stored = { ...created.doc, id, cloudPending: false };

    const dispatch = await openPage(browser, `${base}/statement-dispatch.html?store=local`);
    await evaluate(dispatch, `localStorage.setItem('baiqi_statement_cases_v1', ${JSON.stringify(JSON.stringify({ [id]: stored }))})`);
    try { await evaluate(dispatch, 'location.reload()'); } catch { /* 重新載入會中斷這次指令 */ }
    await new Promise(resolve => setTimeout(resolve, 400));
    await waitFor(dispatch, `document.body.innerText.includes('驗證飯店股份有限公司') && document.body.innerText.includes('待寄送')`);
    const before = await evaluate(dispatch, 'document.body.innerText');
    if (before.includes('示範飯店') || before.includes('介面模擬')) throw new Error('送件中心仍是示範頁');
    await evaluate(dispatch, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('核對帳單')).click()`);
    await waitFor(dispatch, `document.getElementById('preview').classList.contains('show') && document.getElementById('previewPaper').innerText.includes('驗證浴巾') && document.getElementById('previewPaper').innerText.includes('2,100')`);
    const preview = await evaluate(dispatch, `document.getElementById('previewPaper').innerText`);
    if (preview.includes('示範')) throw new Error('核對畫面仍是示範表格');
    await evaluate(dispatch, `document.getElementById('closePreview').click()`);
    await waitFor(dispatch, '!!window.XLSX');
    await evaluate(dispatch, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('確認送出')).click()`);
    await waitFor(dispatch, `document.getElementById('overlay').classList.contains('show') && document.body.innerText.includes('不會自動傳 LINE')`);
    await evaluate(dispatch, `document.getElementById('next').click()`);
    await waitFor(dispatch, `document.body.innerText.includes('我已用 LINE 寄出')`);
    const mid = JSON.parse(await evaluate(dispatch, `localStorage.getItem('baiqi_statement_cases_v1')`));
    if (mid[id].state === 'sent' || mid[id].versions[0].sentAt) throw new Error('檔案準備好就被當成已寄出');
    await evaluate(dispatch, `document.getElementById('next').click()`);
    await waitFor(dispatch, `document.body.innerText.includes('已登記寄送')`);
    const after = JSON.parse(await evaluate(dispatch, `localStorage.getItem('baiqi_statement_cases_v1')`));
    if (!after[id].versions[0].sentAt) throw new Error('登記寄出沒有寫進清單');
    const errors = await evaluate(dispatch, `JSON.stringify(window.__errors || [])`);
    if (errors && errors !== '[]') throw new Error('送件頁錯誤：' + errors);

    const finance = await openPage(browser, `${base}/finance.html`);
    await waitFor(finance, `typeof window.generateOfficialInvoice === 'function' && !!document.getElementById('keywordFilter') && !!document.getElementById('settlementHotelSearch') && !!document.getElementById('ciLineRecipient')`);
    const financeErrors = await evaluate(finance, `JSON.stringify((window.__errors || []).filter(item => /statement-case|statement-store|Unexpected|is not defined/.test(item)))`);
    if (financeErrors && financeErrors !== '[]') throw new Error('財務頁載入錯誤：' + financeErrors);

    const dashboard = await openPage(browser, `${base}/finance-dashboard.html#dispatch`);
    await waitFor(dashboard, `document.body.innerText.includes('對帳單送件中心') && !document.body.innerText.includes('尚不能實際寄送')`);
    await waitFor(dashboard, `(() => { const frame = document.querySelector('#panel-dispatch iframe'); const text = frame && frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.innerText; return !!(text && text.includes('對帳單送件中心') && !text.includes('示範飯店')); })()`);

    await dispatch.close();
    await finance.close();
    await dashboard.close();
    browser.close();
    console.log('瀏覽器驗證通過：對帳單會進送件中心，核對的是正式內容，下載不會被當成已寄出。');
} finally {
    chrome.kill();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
}
