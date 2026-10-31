import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handoffStatementFile, isPhoneShareDevice } from '../statement-file-delivery.js';

const windowsChrome = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 0,
    userAgentData: { mobile: false },
};
const macChrome = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    userAgentData: { mobile: false },
};
const macEdge = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    userAgentData: { mobile: false },
};
const iphoneSafari = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
};
const androidChrome = {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    userAgentData: { mobile: true },
};
const ipadSafari = {
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    platform: 'iPad',
    maxTouchPoints: 5,
};
const ipadOsDesktopSite = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
};

function permissionDenied() {
    return Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
}
function userCancelled() {
    return Object.assign(new Error('Share canceled'), { name: 'AbortError' });
}

test('電腦瀏覽器不是分享裝置', () => {
    assert.equal(isPhoneShareDevice(windowsChrome), false);
    assert.equal(isPhoneShareDevice(macChrome), false);
    assert.equal(isPhoneShareDevice(macEdge), false);
    assert.equal(isPhoneShareDevice({ ...windowsChrome, maxTouchPoints: 10 }), false);
});

test('手機、平板與主畫面網頁 App 用系統分享', () => {
    assert.equal(isPhoneShareDevice(iphoneSafari), true);
    assert.equal(isPhoneShareDevice({ ...iphoneSafari, standalone: true }), true);
    assert.equal(isPhoneShareDevice(androidChrome), true);
    assert.equal(isPhoneShareDevice(ipadSafari), true);
    assert.equal(isPhoneShareDevice(ipadOsDesktopSite), true);
    assert.equal(isPhoneShareDevice({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        platform: 'Linux x86_64',
        maxTouchPoints: 5,
        userAgentData: { mobile: true },
    }), true);
});

test('電腦即使 canShare 為 true 也只下載，不開啟分享', async () => {
    const events = [];
    let downloaded = false;
    const pending = handoffStatementFile({
        format: 'xlsx',
        mobile: false,
        file: { name: 'a.xlsx' },
        filename: '百麒國際股份有限公司對帳單_驗證飯店_20261025.xlsx',
        canShare: () => true,
        share() {
            events.push('share');
            return Promise.reject(permissionDenied());
        },
        download() {
            downloaded = true;
            events.push('download');
        },
    });
    assert.equal(downloaded, true);
    await pending;
    assert.deepEqual(events, ['download']);
});

test('手機成功分享時不下載', async () => {
    const file = { name: '帳.xlsx' };
    const events = [];
    let shared = false;
    const pending = handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file,
        filename: '帳.xlsx',
        canShare: () => true,
        share(payload) {
            shared = true;
            events.push(['share', payload.title, payload.files[0] === file]);
            return Promise.resolve();
        },
        download() { events.push('download'); },
    });
    assert.equal(shared, true);
    await pending;
    assert.deepEqual(events, [['share', '帳.xlsx', true]]);
});

test('手機分享 NotAllowedError（Permission denied）改下載，不丟錯', async () => {
    const events = [];
    await handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare: () => true,
        share() {
            events.push('share');
            return Promise.reject(permissionDenied());
        },
        download() { events.push('download'); },
    });
    assert.deepEqual(events, ['share', 'download']);
});

test('手機使用者取消分享（AbortError）時安靜結束', async () => {
    const events = [];
    await handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare: () => true,
        share() {
            events.push('share');
            return Promise.reject(userCancelled());
        },
        download() { events.push('download'); },
    });
    assert.deepEqual(events, ['share']);
});

test('手機分享其他失敗也改下載', async () => {
    const events = [];
    await handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare: () => true,
        share() {
            events.push('share');
            return Promise.reject(Object.assign(new Error('Share failed'), { name: 'TypeError' }));
        },
        download() { events.push('download'); },
    });
    assert.deepEqual(events, ['share', 'download']);
});

test('手機 share() 同步丟出 NotAllowedError 時改下載', async () => {
    const events = [];
    await handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare: () => true,
        share() {
            events.push('share');
            throw permissionDenied();
        },
        download() { events.push('download'); },
    });
    assert.deepEqual(events, ['share', 'download']);
});

test('手機 share() 同步丟出 AbortError 時不下載', async () => {
    const events = [];
    await handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare: () => true,
        share() { throw userCancelled(); },
        download() { events.push('download'); },
    });
    assert.deepEqual(events, []);
});

test('手機 canShare 不允許檔案時直接下載', async () => {
    const events = [];
    await handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare: () => false,
        share() { events.push('share'); return Promise.resolve(); },
        download() { events.push('download'); },
    });
    assert.deepEqual(events, ['download']);
});

test('手機 canShare 丟錯時改下載', async () => {
    const events = [];
    await handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare() { throw new Error('cannot share'); },
        share() { events.push('share'); return Promise.resolve(); },
        download() { events.push('download'); },
    });
    assert.deepEqual(events, ['download']);
});

test('手機 navigator.share 在函式回傳前就呼叫', () => {
    let shared = false;
    const pending = handoffStatementFile({
        format: 'xlsx',
        mobile: true,
        file: { name: '帳.xlsx' },
        filename: '帳.xlsx',
        canShare: () => true,
        share() {
            shared = true;
            return new Promise(() => {});
        },
        download() { throw new Error('不該下載'); },
    });
    assert.equal(shared, true);
    pending.catch(() => {});
});

test('PDF 在電腦與手機都直接列印，不走分享表', async () => {
    for (const mobile of [false, true]) {
        const events = [];
        const pending = handoffStatementFile({
            format: 'pdf',
            mobile,
            print() { events.push('print'); },
            download() { events.push('download'); },
            canShare: () => true,
            share() { events.push('share'); return Promise.resolve(); },
        });
        assert.deepEqual(events, ['print']);
        await pending;
        assert.deepEqual(events, ['print']);
    }
});

test('下載失敗仍回報給呼叫端', async () => {
    assert.throws(
        () => handoffStatementFile({
            format: 'xlsx',
            mobile: false,
            download() { throw new Error('磁碟失敗'); },
        }),
        /磁碟失敗/,
    );
    await assert.rejects(
        () => handoffStatementFile({
            format: 'xlsx',
            mobile: true,
            file: { name: '帳.xlsx' },
            filename: '帳.xlsx',
            canShare: () => true,
            share() { return Promise.reject(permissionDenied()); },
            download() { throw new Error('下載失敗'); },
        }),
        /下載失敗/,
    );
});

test('送件頁在 await 之前就交出檔案，且不再把分享失敗往外丟', () => {
    const html = readFileSync(new URL('../statement-dispatch.html', import.meta.url), 'utf8');
    const prepare = html.slice(html.indexOf('async function prepareAndContinue'), html.indexOf('function showSentConfirm'));
    const begin = html.slice(html.indexOf('function beginPrepareFile'), html.indexOf('async function markSent'));
    assert.ok(prepare.indexOf('beginPrepareFile') !== -1);
    assert.ok(prepare.indexOf('beginPrepareFile') < prepare.indexOf('await savePromise'));
    assert.equal(prepare.includes('navigator.share'), false);
    assert.equal(prepare.includes('window.print('), false);
    assert.match(begin, /^function beginPrepareFile/);
    assert.equal(begin.includes('await '), false);
    assert.match(begin, /isPhoneShareDevice\(navigator\)/);
    assert.match(begin, /handoffStatementFile\(/);
    assert.match(begin, /window\.print\(\)/);
    assert.equal(html.includes("if (error?.name !== 'AbortError') throw error"), false);
    assert.match(html, /statement-file-delivery\.js/);
});
