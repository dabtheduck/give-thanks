// Run: node lib/announce.test.js
// Tests the v5.2 announcement helpers: the message format, and the
// recipient list (every known user's 1:1 chat, deduped, no group posts).
const assert = require('assert');
const { formatAnnouncement, collectRecipients } = require('./announce');

const text = formatAnnouncement('  New: the garden resets every day now!  ');
assert.ok(text.startsWith('🌱 Give Thanks — update\n\n'), 'announcement carries a recognisable header');
assert.ok(text.includes('New: the garden resets every day now!'), 'the announcement text is included');
assert.ok(!text.includes('  New:'), 'the text is trimmed');
assert.strictEqual(formatAnnouncement(''), '🌱 Give Thanks — update\n\n');

const users = new Map([
  [111, { chatId: 111 }],
  [222, { chatId: 222 }],
  [333, { chatId: 333 }],
  [444, { chatId: 222 }], // same chat id as another record — deduped
  [555, { chatId: null }], // no chat id — skipped
  [666, {}], // no chat id at all — skipped
]);
assert.deepStrictEqual(collectRecipients(users).sort(), ['111', '222', '333']);
assert.deepStrictEqual(collectRecipients(new Map()), []);
assert.deepStrictEqual(collectRecipients(null), []);

console.log('announce: all announcement tests pass (header, 1:1 recipients, dedup)');
