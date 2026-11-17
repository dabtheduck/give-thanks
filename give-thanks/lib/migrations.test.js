// Run: node lib/migrations.test.js
// Tests the v1 -> v5 upgrade path: no data loss, unknown fields preserved.
// v4: hour settings are removed (hardcoded 03:00 recap, 19:30 notify, per-user timezone).
// v5: notes gain stable ids, users gain pendingBot + plantChoices.
const assert = require('assert');
const { migrateUser, migrateSettings, migrateToday, stableNoteId } = require('./migrations');

// v1 settings: no version, no features, with old hour settings
const v1Settings = { timezone: 'Asia/Singapore', resetHour: 4, notifyHour: 21, notificationsOn: true, notifyOnlyIfEmpty: true, gardenOptIn: true, groupGardens: ['-100123'] };
const v2s = migrateSettings(v1Settings);
assert.strictEqual(v2s.version, 5);
assert.strictEqual(v2s.resetHour, undefined);
assert.strictEqual(v2s.notifyHour, undefined);
assert.strictEqual(v2s.timezone, 'Asia/Singapore');
assert.strictEqual(v2s.groupGardens[0], '-100123');
assert.strictEqual(v2s.features.gardenWeeklyShare, false);

// v1 today: no version
const v2t = migrateToday({ date: '2026-11-17', count: 3, notes: [{ text: 'warm soup', time: '09:12' }] });
assert.strictEqual(v2t.version, 5);
assert.strictEqual(v2t.count, 3);
assert.strictEqual(v2t.notes[0].text, 'warm soup');
assert.strictEqual(v2t.notes[0].shareable, false);

// v1 user record from data.json, with an unknown future field — it must survive
const v2u = migrateUser({ chatId: 123, timezone: 'UTC', resetHour: 5, someFutureField: 'keep-me', today: { date: '2026-11-17', count: 1, notes: [] } });
assert.strictEqual(v2u.version, 5);
assert.strictEqual(v2u.someFutureField, 'keep-me');
assert.strictEqual(v2u.resetHour, undefined);
assert.strictEqual(v2u.timezone, 'UTC');

// v2 -> v3: old notes without shareable default to private (false), never shared
const v3t = migrateToday({ version: 2, date: '2026-11-17', count: 2, notes: [{ text: 'warm soup', time: '09:12' }, { text: 'my sister called', time: '13:40', shareable: true }] });
assert.strictEqual(v3t.version, 5);
assert.strictEqual(v3t.notes[0].shareable, false);
assert.strictEqual(v3t.notes[1].shareable, true);

// v3 settings: shareOutsideTelegram defaults on, hours dropped on v4
const v3s = migrateSettings({ version: 2, timezone: 'Asia/Singapore', resetHour: 4, features: {} });
assert.strictEqual(v3s.features.shareOutsideTelegram, true);
assert.strictEqual(v3s.resetHour, undefined);

// v3 -> v4: a user who had custom hours loses them, keeps everything else
const v4s = migrateSettings({ version: 3, timezone: 'Asia/Singapore', resetHour: 2, notifyHour: 20, notificationsOn: false, features: {} });
assert.strictEqual(v4s.version, 5);
assert.strictEqual(v4s.resetHour, undefined);
assert.strictEqual(v4s.notifyHour, undefined);
assert.strictEqual(v4s.notificationsOn, false);

// v5: notes gain stable ids — deterministic from content, so migrating
// the same note twice gives the same id, and a note that already has
// an id keeps it.
assert.strictEqual(stableNoteId('warm soup', '09:12'), stableNoteId('warm soup', '09:12'));
assert.notStrictEqual(stableNoteId('warm soup', '09:12'), stableNoteId('warm soup', '09:13'));
assert.ok(v2t.notes[0].id, 'old note must gain an id');
assert.strictEqual(v2t.notes[0].id, stableNoteId('warm soup', '09:12'));
const kept = migrateToday({ date: '2026-11-17', count: 1, notes: [{ text: 'x', time: '10:00', id: 'app-99', shareable: true, origin: 'bot' }] });
assert.strictEqual(kept.notes[0].id, 'app-99', 'an existing id must be kept');
assert.strictEqual(kept.notes[0].origin, 'bot');

// v5: users gain pendingBot + plantChoices, defaulting to empty.
const v5u = migrateUser({ chatId: 123, timezone: 'UTC', today: { date: '2026-11-17', count: 0, notes: [] } });
assert.deepStrictEqual(v5u.pendingBot, []);
assert.deepStrictEqual(v5u.plantChoices, {});
const v5u2 = migrateUser({ chatId: 123, pendingBot: [{ id: 'bot-1', text: 'hi', time: '11:00' }], plantChoices: { '-100123': 'rose' }, today: { date: '2026-11-17', count: 1, notes: [] } });
assert.strictEqual(v5u2.pendingBot.length, 1);
assert.strictEqual(v5u2.plantChoices['-100123'], 'rose');

// v5.1: users gain lastSyncDate (null = never synced), kept when present.
assert.strictEqual(v5u.lastSyncDate, null);
const v51u = migrateUser({ chatId: 123, lastSyncDate: '2026-11-17', today: { date: '2026-11-17', count: 0, notes: [] } });
assert.strictEqual(v51u.lastSyncDate, '2026-11-17');

console.log('migrations: all upgrade tests pass (v1 -> v5, no loss, unknown fields kept, hours dropped, note ids stable)');
