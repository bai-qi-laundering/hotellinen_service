import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manualInvoiceRefusal, resolveInvoiceIssuer } from '../firebase-signature/functions/lib/invoice-issuer.js';
import { invoicePeriodLabel, manualReferenceHtml } from '../manual-invoice-reference.js';

const payments = readFileSync(new URL('../receivables-ui.js', import.meta.url), 'utf8');
const configJson = payments.slice(payments.indexOf('const PAYMENT_CONFIG=') + 'const PAYMENT_CONFIG='.length, payments.indexOf(';\nPAYMENT_CONFIG.push'));
const paymentRows = JSON.parse(configJson);

test('對照表裡的開票公司維持原設定', () => {
    for (const row of paymentRows) {
        const got = resolveInvoiceIssuer(row.name);
        assert.equal(got.issuer, row.issuer, row.name);
        assert.equal(got.method, row.issuer === '百麒國際' ? 'electronic' : 'manual', row.name);
    }
    assert.equal(resolveInvoiceIssuer('鉑麗').issuer, '百麒國際');
    assert.equal(resolveInvoiceIssuer('洲際').method, 'electronic');
    assert.equal(resolveInvoiceIssuer('承億藝術').method, 'electronic');
    assert.equal(resolveInvoiceIssuer('日航休閒中心').issuer, '百麒國際');
});

test('手開客戶與別名走手開，其他客戶是百麒國際電子', () => {
    const manual = {
        承億: '百麒',
        '承億酒店(股)公司': '百麒',
        承億健身房: '百麒',
        花季: '百麒',
        '花季Ａ館': '百麒',
        花季A館: '百麒',
        巨蛋: '百富',
        裕力開發有限公司: '百富',
        老新: '日聖',
        永心: '日聖',
        '永心鳳茶有限公司同盟營業所': '日聖',
        福客來: '日聖',
        林森: '日聖',
        南北樓: '日聖',
        建工: '日聖',
        逢友園餐廳: '日聖',
        雅樂十刻: '日聖',
        十刻好時光: '日聖',
        雅樂廚苑: '日聖',
        萬樂國際餐飲: '日聖',
    };
    for (const [name, issuer] of Object.entries(manual)) {
        const got = resolveInvoiceIssuer(name);
        assert.equal(got.issuer, issuer, name);
        assert.equal(got.method, 'manual', name);
        assert.match(manualInvoiceRefusal(name), /不能向汎宇開立/);
    }
    assert.equal(manualInvoiceRefusal('洲際'), '');
    assert.equal(resolveInvoiceIssuer('沒有列在表上的新客戶').method, 'electronic');
});

test('客戶資料表的開票公司只補對照表沒有的客戶，空白仍是電子發票', () => {
    const rows = [
        ['飯店名稱', '開票公司', '發票品項'],
        ['新餐廳', '日聖手開', '洗衣費'],
        ['空白客戶', '', '洗衣費'],
        ['承億', '百麒國際', '洗滌費'],
    ];
    assert.equal(resolveInvoiceIssuer('新餐廳', { rows }).issuer, '日聖');
    assert.equal(resolveInvoiceIssuer('新餐廳', { rows }).source, 'sheet');
    assert.equal(resolveInvoiceIssuer('空白客戶', { rows }).issuer, '百麒國際');
    assert.equal(resolveInvoiceIssuer('空白客戶', { rows }).source, 'default');
    const kept = resolveInvoiceIssuer('承億', { rows });
    assert.equal(kept.issuer, '百麒');
    assert.equal(kept.method, 'manual');
    assert.equal(kept.source, 'config');
    assert.equal(resolveInvoiceIssuer('另一家', { rows: [['飯店名稱', '開票公司'], ['另一家', '百麒（手開）']] }).issuer, '百麒');
    assert.equal(resolveInvoiceIssuer('統編客戶', { taxId: '53902289' }).canonicalName, '巨蛋');
});

test('三聯式照抄單帶期別、統編八格、應稅與蓋章提醒', () => {
    assert.equal(invoicePeriodLabel('2026-11-28'), '一一五年 十一、十二 月份');
    assert.equal(invoicePeriodLabel('2026-10-31'), '一一五年 九、十 月份');
    const html = manualReferenceHtml({
        buyer: '承億酒店(股)公司',
        taxId: '90373873',
        address: '高雄市',
        date: '2026-11-28',
        item: '洗滌費',
        net: 1000,
        tax: 50,
        total: 1050,
        version: 3,
        issuer: '百麒（手開）',
    }, 'AB12345678');
    assert.match(html, /統一發票（三聯式）/);
    assert.match(html, /一一五年 十一、十二 月份/);
    assert.match(html, /買受人（必填）/);
    assert.match(html, /承億酒店\(股\)公司/);
    assert.match(html, /地址（可空白）/);
    assert.match(html, /高雄市/);
    assert.match(html, /洗滌費/);
    assert.match(html, /記得要蓋發票章唷/);
    assert.match(html, /零稅率/);
    assert.match(html, /免稅/);
    assert.match(html, /億仟佰拾萬仟佰拾元/);
    assert.match(html, /壹仟零伍拾元整/);
    assert.equal((html.match(/checked/g) || []).length, 1);
    const boxes = html.match(/class="copy-taxid">([\s\S]*?)<\/span>/);
    assert.equal((boxes[1].match(/<b>/g) || []).length, 8);
    assert.match(html, /不會向汎宇開立/);
    assert.doesNotMatch(html, /apiKey|openInvoice/);
});

test('手開登記只畫三聯式，向汎宇開立的呼叫留在電子發票分支', () => {
    assert.match(payments, /manualReferenceHtml/);
    assert.match(payments, /不會向汎宇開立/);
    assert.match(payments, /手開發票/);
    const manualAt = payments.indexOf("details.method==='manual'");
    const formAt = payments.indexOf('manualReferenceHtml(', manualAt);
    const electronicCall = payments.indexOf('issueStatementInvoice');
    assert.ok(manualAt > 0 && formAt > manualAt);
    assert.ok(electronicCall > 0);
    assert.equal(payments.slice(manualAt, formAt).includes('issueStatementInvoice'), false);
    const submit = payments.slice(payments.indexOf("$('form').onsubmit"));
    const guard = submit.indexOf("method==='electronic'");
    const callable = submit.indexOf('issueStatementInvoice');
    assert.ok(guard >= 0 && callable > guard);
    assert.equal(submit.slice(callable + 'issueStatementInvoice'.length).includes('issueStatementInvoice'), false);
});
