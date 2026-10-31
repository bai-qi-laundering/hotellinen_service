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
    await waitFor(dispatch, `document.querySelector('.hotel')?.textContent === '驗證飯店' && document.body.innerText.includes('待寄送') && !document.querySelector('.hotel')?.textContent.includes('股份有限公司')`);
    const before = await evaluate(dispatch, 'document.body.innerText');
    if (before.includes('示範飯店') || before.includes('介面模擬')) throw new Error('送件中心仍是示範頁');
    await evaluate(dispatch, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('核對帳單')).click()`);
    await waitFor(dispatch, `document.getElementById('preview').classList.contains('show') && document.getElementById('previewPaper').innerText.includes('驗證浴巾') && document.getElementById('previewPaper').innerText.includes('2,100')`);
    const previewTitle = await evaluate(dispatch, `document.getElementById('previewTitle').textContent`);
    if (!previewTitle.startsWith('驗證飯店') || previewTitle.includes('股份有限公司')) throw new Error('預覽標題仍是發票抬頭：' + previewTitle);
    const preview = await evaluate(dispatch, `document.getElementById('previewPaper').innerText`);
    if (!preview.includes('驗證飯店股份有限公司')) throw new Error('對帳單正文應保留發票抬頭');
    if (preview.includes('示範')) throw new Error('核對畫面仍是示範表格');
    await evaluate(dispatch, `document.getElementById('closePreview').click()`);
    await waitFor(dispatch, '!!window.XLSX');
    await evaluate(dispatch, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('確認送出')).click()`);
    await waitFor(dispatch, `document.getElementById('overlay').classList.contains('show') && document.body.innerText.includes('不會自動傳 LINE')`);
    // 桌面 Chrome 的 canShare 對 xlsx 會回 true，但 share() 會丟 Permission denied。這裡故意讓分享失敗，電腦仍應只下載。
    await evaluate(dispatch, `(() => {
        window.__downloads = [];
        window.__shares = [];
        window.__alerts = [];
        window.XLSX.writeFile = (wb, name) => { window.__downloads.push(String(name)); };
        const deny = () => {
            window.__shares.push('share');
            return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        };
        Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, writable: true, value: () => true });
        Object.defineProperty(Navigator.prototype, 'share', { configurable: true, writable: true, value: deny });
        return 'ok';
    })()`);
    await evaluate(dispatch, `document.getElementById('next').click()`);
    await waitFor(dispatch, `document.body.innerText.includes('我已用 LINE 寄出')`);
    const desktopDelivery = JSON.parse(await evaluate(dispatch, `JSON.stringify({ downloads: window.__downloads || [], shares: window.__shares || [], alerts: window.__alerts || [] })`));
    if (desktopDelivery.shares.length) throw new Error('電腦不該開啟分享：' + JSON.stringify(desktopDelivery));
    if (!desktopDelivery.downloads.some(name => name.includes('驗證飯店') && name.endsWith('.xlsx'))) {
        throw new Error('電腦沒有下載 Excel：' + JSON.stringify(desktopDelivery));
    }
    if (desktopDelivery.alerts.length) throw new Error('準備檔案不該跳錯誤：' + JSON.stringify(desktopDelivery.alerts));
    const mid = JSON.parse(await evaluate(dispatch, `localStorage.getItem('baiqi_statement_cases_v1')`));
    if (mid[id].state === 'sent' || mid[id].versions[0].sentAt) throw new Error('檔案準備好就被當成已寄出');
    await evaluate(dispatch, `document.getElementById('next').click()`);
    await waitFor(dispatch, `document.body.innerText.includes('已登記寄送')`);
    const after = JSON.parse(await evaluate(dispatch, `localStorage.getItem('baiqi_statement_cases_v1')`));
    if (!after[id].versions[0].sentAt) throw new Error('登記寄出沒有寫進清單');
    const errors = await evaluate(dispatch, `JSON.stringify(window.__errors || [])`);
    if (errors && errors !== '[]') throw new Error('送件頁錯誤：' + errors);

    await evaluate(dispatch, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('再次取得檔案')).click()`);
    await waitFor(dispatch, `document.getElementById('overlay').classList.contains('show') && !!document.getElementById('format')`);
    await evaluate(dispatch, `(() => {
        sessionStorage.removeItem('baiqi_test_printed');
        window.__alerts = [];
        window.__shares = [];
        window.print = () => { window.__printed = true; sessionStorage.setItem('baiqi_test_printed', '1'); };
        document.getElementById('format').value = 'pdf';
        document.getElementById('next').click();
        return 'ok';
    })()`);
    await waitFor(dispatch, `sessionStorage.getItem('baiqi_test_printed') === '1' || (window.__alerts || []).length > 0`);
    const pdfDelivery = JSON.parse(await evaluate(dispatch, `JSON.stringify({ printed: sessionStorage.getItem('baiqi_test_printed'), alerts: window.__alerts || [], shares: window.__shares || [] })`));
    if (pdfDelivery.printed !== '1') throw new Error('PDF 沒有開啟列印：' + JSON.stringify(pdfDelivery));
    if (pdfDelivery.alerts.length) throw new Error('PDF 不該跳錯誤：' + JSON.stringify(pdfDelivery.alerts));
    if (pdfDelivery.shares.length) throw new Error('PDF 不該開啟分享：' + JSON.stringify(pdfDelivery.shares));

    const mobileReport = await evaluate(dispatch, `(async () => {
        const mod = await import('./statement-file-delivery.js?v=20261031-share-fix');
        const file = new File(['pk'], '帳.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        async function scenario(name, shareImpl) {
            const events = [];
            let thrown = '';
            try {
                await mod.handoffStatementFile({
                    format: 'xlsx',
                    mobile: true,
                    file,
                    filename: '帳.xlsx',
                    canShare: () => true,
                    share(payload) {
                        events.push('share:' + payload.files[0].name);
                        return shareImpl();
                    },
                    download() { events.push('download'); },
                });
            } catch (error) {
                thrown = String(error && (error.name + ' ' + error.message) || error);
            }
            return { name, events, thrown };
        }
        return [
            await scenario('success', () => Promise.resolve()),
            await scenario('denied', () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))),
            await scenario('abort', () => Promise.reject(new DOMException('Share canceled', 'AbortError'))),
        ];
    })()`);
    const byName = Object.fromEntries(mobileReport.map(item => [item.name, item]));
    if (byName.success.thrown || byName.success.events.join(',') !== 'share:帳.xlsx') {
        throw new Error('手機分享成功路徑不對：' + JSON.stringify(byName.success));
    }
    if (byName.denied.thrown || byName.denied.events.join(',') !== 'share:帳.xlsx,download') {
        throw new Error('手機 NotAllowedError 應改下載：' + JSON.stringify(byName.denied));
    }
    if (byName.abort.thrown || byName.abort.events.join(',') !== 'share:帳.xlsx') {
        throw new Error('手機取消分享不該下載或報錯：' + JSON.stringify(byName.abort));
    }
    if (await evaluate(dispatch, `import('./statement-file-delivery.js?v=20261031-share-fix').then(m => m.isPhoneShareDevice(navigator))`)) {
        throw new Error('這台桌面 Chrome 不該被當成手機');
    }

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
