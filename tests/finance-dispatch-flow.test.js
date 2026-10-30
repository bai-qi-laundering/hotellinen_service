import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../finance.html', import.meta.url), 'utf8');
const generate = source.slice(source.indexOf('async function generateOfficialInvoice()'), source.indexOf('\nfunction exportToExcel()'));
const close = source.match(/window.closePreview = \(\) => \{[\s\S]*?\n\};/)[0];
function fixture(error) {
    const events = [];
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: '測試飯店', innerHTML: '', classList: { add() {}, remove() {}, replace() {} } });
        return elements.get(id);
    };
    const context = vm.createContext({
        document: {
            getElementById: element,
            querySelector: selector => selector === '.excel-bottom-bar' ? null : element(selector),
            body: { style: {} },
        },
        window: { closeInvoiceModal() { events.push('close-modal'); } },
        buildInvoiceReport: () => ({ comp: '測試飯店', depts: { '測試部門': {} } }),
        collectStatementSnapshot: () => ({ customerKey: '測試飯店', totals: { afterRebate: 1234, tax: 62 } }),
        renderStatementHtml: () => '<div>測試帳單</div>',
        statementRepo: { async publish(snapshot) {
            events.push(['publish', snapshot.totals.afterRebate, snapshot.totals.tax]);
            if (error) throw error;
            return { action: 'created' };
        } },
        setDispatchStatus: (message, isError) => events.push(['status', message, isError]),
        notifyDispatchRefresh: () => events.push('refresh'),
        alert: message => events.push(['alert', message]),
        console: { error() {} },
    });
    vm.runInContext(generate + '\n' + close, context);
    return { context, events };
}
test('manual generation reaches publish when standalone finance has no old navigation bar', async () => {
    const { context, events } = fixture();
    await vm.runInContext('generateOfficialInvoice()', context);
    assert.deepEqual(events.find(e => Array.isArray(e) && e[0] === 'publish'), ['publish', 1234, 62]);
    assert.ok(events.some(e => Array.isArray(e) && e[0] === 'status' && e[1].includes('已送進')));
    assert.equal(events.filter(e => e === 'refresh').length, 1);
});
test('return from statement preview works without old navigation bar', () => {
    const { context } = fixture();
    vm.runInContext('window.closePreview()', context);
    assert.equal(context.document.body.style.background, '#f3f4f6');
});
test('failed publish displays failure and never reports successful delivery', async () => {
    const { context, events } = fixture(new Error('permission-denied'));
    await vm.runInContext('generateOfficialInvoice()', context);
    assert.ok(events.some(e => Array.isArray(e) && e[0] === 'status' && e[2] === true));
    assert.equal(events.some(e => Array.isArray(e) && e[0] === 'status' && e[1].startsWith('已送進')), false);
});
