import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMd, taipeiParts, taipeiToday } from './special-time.js';

test('Taipei calendar', () => {
    assert.equal(taipeiToday('2026-10-26T16:30:00.000Z'), '2026-10-27');
    assert.equal(taipeiParts('2026-10-27T06:05:00.000Z').time, '14:05:00');
    assert.equal(formatMd('2026-10-27'), '10/27');
    assert.equal(formatMd('2026-11-03'), '11/3');
});
