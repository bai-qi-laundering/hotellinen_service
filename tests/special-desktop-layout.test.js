import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('special cards shrink only on wide screens', () => {
    const css = fs.readFileSync(new URL('../special-theme-factory.css', import.meta.url), 'utf8');
    const desktopAt = css.indexOf('@media (min-width: 768px)');
    assert.ok(desktopAt > 0);
    const mobile = css.slice(0, desktopAt);
    assert.match(mobile, /font-size: 40px !important/);
    assert.match(mobile, /min-height: 78px/);
    assert.match(mobile, /flex-basis: 90% !important/);
    const desktop = css.slice(desktopAt);
    assert.match(desktop, /repeat\(auto-fill, minmax\(260px, 1fr\)\)/);
    assert.match(desktop, /font-size: 22px !important/);
    assert.equal(desktop.includes('min-height: 78px'), false);
    const page = fs.readFileSync(new URL('../special.html', import.meta.url), 'utf8');
    assert.match(page, /special-theme-factory\.css\?v=20261111-desktop/);
});
