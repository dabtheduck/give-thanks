// Run: node lib/recap.test.js
// Tests the v5 recap/share formats (dab, 2026-11-17):
// - empty day says "No thanks logged today yet."
// - day with thanks keeps the v1 structure MINUS the last line
//   "A fresh day starts now. No backlog, no guilt."
// - share text shows ticked notes, hides unticked as "••• hidden •••"
// - stale notice tells the user to open the app first, then ask again.
// - v5.1: recapStatus tells "not synced yet" apart from "genuinely empty".
const assert = require('assert');
const { formatRecap, buildShareText, staleNotice, notSyncedNotice, recapStatus } = require('./recap');

const empty = formatRecap({ today: { count: 0, notes: [] }, features: {} }, '2026-11-17');
assert.strictEqual(empty, '🌱 Give Thanks — 2026-11-17\n\nNo thanks logged today yet.');

const full = formatRecap({ today: { count: 2, notes: [{ text: 'warm soup', time: '09:12' }, { text: 'good food', time: '12:30' }] }, features: {} }, '2026-11-17');
assert.ok(full.includes('You said thanks 2 times today.'));
assert.ok(full.includes('1. 09:12 — warm soup'));
assert.ok(full.includes('2. 12:30 — good food'));
assert.ok(!full.includes('A fresh day starts now'), 'fresh-day line must be gone when there are thanks');
assert.ok(!full.includes('No backlog'), 'fresh-day line must be gone when there are thanks');

const one = formatRecap({ today: { count: 1, notes: [{ text: 'sun', time: '08:00' }] }, features: {} }, '2026-11-17');
assert.ok(one.includes('You said thanks 1 time today.'));

const share = buildShareText({ count: 2, notes: [{ text: 'warm soup', shareable: true }, { text: 'private thing', shareable: false }] }, '2026-11-17');
assert.ok(share.includes('1. warm soup'));
assert.ok(share.includes('2. ••• hidden •••'));
assert.ok(share.includes('I said thanks 2 times today.'));

const note = staleNotice('recap');
assert.ok(note.includes('Open Give Thanks first'), 'must tell them to open the app first');
assert.ok(note.includes('/recap'), 'must name the command to retry');
assert.ok(staleNotice('share').includes('/share'));

// v5.1: "not synced yet" is not the same as "empty day".
assert.strictEqual(recapStatus({ today: { count: 2, notes: [{ text: 'x', time: '09:00' }] }, lastSyncDate: '2026-11-17' }, '2026-11-17'), 'has-thanks');
assert.strictEqual(recapStatus({ today: { count: 0, notes: [] }, lastSyncDate: '2026-11-17' }, '2026-11-17'), 'empty', 'synced today and empty means genuinely empty');
assert.strictEqual(recapStatus({ today: { count: 0, notes: [] }, lastSyncDate: '2026-11-16' }, '2026-11-17'), 'not-synced', 'empty but synced yesterday means the server just doesn’t know yet');
assert.strictEqual(recapStatus({ today: { count: 0, notes: [] }, lastSyncDate: null }, '2026-11-17'), 'not-synced', 'never synced means not-synced');
assert.strictEqual(recapStatus({ today: { count: 0, notes: [] } }, '2026-11-17'), 'not-synced', 'no lastSyncDate at all means not-synced');
const prompt = notSyncedNotice('recap');
assert.ok(prompt.includes('open Give Thanks'), 'must tell them to open the app');
assert.ok(prompt.includes('/recap'), 'must name the command to retry');
assert.ok(!prompt.includes('No thanks logged'), 'must NOT claim the day is empty when it just hasn’t synced');
assert.ok(notSyncedNotice('share').includes('/share'));

console.log('recap: all format tests pass (empty "yet", no fresh-day line, share blurs, stale notice, not-synced)');
