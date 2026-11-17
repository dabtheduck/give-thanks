// Run: node lib/merge.test.js
// Tests the v5 /thanks merge (dab confirmed the merge, 2026-11-17):
// - app snapshot alone: unchanged
// - unmerged bot entries: +1 count each, note entries join the list
// - adopted entries (id in mergedBotIds): dropped, never double-counted
// - adopted-then-deleted bot note: stays deleted, never resurrected
const assert = require('assert');
const { mergeSync } = require('./merge');

const appToday = { date: '2026-11-17', count: 2, notes: [{ text: 'warm soup', time: '09:12', id: 'app-1', shareable: false }] };

// No pending bot entries: snapshot passes through unchanged.
let r = mergeSync(appToday, [], []);
assert.strictEqual(r.today.count, 2);
assert.strictEqual(r.today.notes.length, 1);
assert.deepStrictEqual(r.remainingPending, []);

// One bot note + one bare bot press, neither adopted yet.
const pending = [
  { id: 'bot-1', text: 'good food', time: '12:30' },
  { id: 'bot-2', text: null, time: '13:00' },
];
r = mergeSync(appToday, pending, []);
assert.strictEqual(r.today.count, 4, 'each bot entry is +1');
assert.strictEqual(r.today.notes.length, 2);
assert.strictEqual(r.today.notes[1].text, 'good food');
assert.strictEqual(r.today.notes[1].origin, 'bot');
assert.strictEqual(r.remainingPending.length, 2);

// The app adopted both (merged on open, sent mergedBotIds): dropped.
r = mergeSync(
  { date: '2026-11-17', count: 4, notes: [{ text: 'warm soup', time: '09:12', id: 'app-1', shareable: false }, { text: 'good food', time: '12:30', id: 'bot-1', shareable: false }] },
  pending, ['bot-1', 'bot-2']);
assert.strictEqual(r.today.count, 4, 'adopted entries must not double-count');
assert.strictEqual(r.today.notes.length, 2);
assert.deepStrictEqual(r.remainingPending, []);

// Adopted-then-deleted: the bot note was adopted, then deleted in the app.
// It is in mergedBotIds and absent from the snapshot — it must NOT come back.
r = mergeSync(
  { date: '2026-11-17', count: 3, notes: [{ text: 'warm soup', time: '09:12', id: 'app-1', shareable: false }] },
  pending, ['bot-1', 'bot-2']);
assert.strictEqual(r.today.count, 3);
assert.strictEqual(r.today.notes.length, 1);
assert.ok(!r.today.notes.some((n) => n.id === 'bot-1'), 'deleted bot note must stay deleted');

console.log('merge: all merge tests pass (no double-count, adopted dropped, deleted stays deleted)');
