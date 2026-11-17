// Run: node lib/migrations.test.js
// Tests the v1 -> v4 upgrade path: no data loss, unknown fields preserved.
// v4: hour settings are removed (hardcoded 03:00 recap, 19:30 notify, per-user timezone).
const assert = require('assert');
const { migrateUser, migrateSettings, migrateToday } = require('./migrations');

// v1 settings: no version, no features, with old hour settings
const v1Settings = { timezone: 'Asia/Singapore', resetHour: 4, notifyHour: 21, notificationsOn: true, notifyOnlyIfEmpty: true, gardenOptIn: true, groupGardens: ['-100123'] };
const v2s = migrateSettings(v1Settings);
assert.strictEqual(v2s.version, 4);
assert.strictEqual(v2s.resetHour, undefined);
assert.strictEqual(v2s.notifyHour, undefined);
assert.strictEqual(v2s.timezone, 'Asia/Singapore');
assert.strictEqual(v2s.groupGardens[0], '-100123');
assert.strictEqual(v2s.features.gardenWeeklyShare, false);

// v1 today: no version
const v2t = migrateToday({ date: '2026-11-17', count: 3, notes: [{ text: 'warm soup', time: '09:12' }] });
assert.strictEqual(v2t.version, 4);
assert.strictEqual(v2t.count, 3);
assert.strictEqual(v2t.notes[0].text, 'warm soup');
assert.strictEqual(v2t.notes[0].shareable, false);

// v1 user record from data.json, with an unknown future field — it must survive
const v2u = migrateUser({ chatId: 123, timezone: 'UTC', resetHour: 5, someFutureField: 'keep-me', today: { date: '2026-11-17', count: 1, notes: [] } });
assert.strictEqual(v2u.version, 4);
assert.strictEqual(v2u.someFutureField, 'keep-me');
assert.strictEqual(v2u.resetHour, undefined);
assert.strictEqual(v2u.timezone, 'UTC');

// v2 -> v3: old notes without shareable default to private (false), never shared
const v3t = migrateToday({ version: 2, date: '2026-11-17', count: 2, notes: [{ text: 'warm soup', time: '09:12' }, { text: 'my sister called', time: '13:40', shareable: true }] });
assert.strictEqual(v3t.version, 4);
assert.strictEqual(v3t.notes[0].shareable, false);
assert.strictEqual(v3t.notes[1].shareable, true);

// v3 settings: shareOutsideTelegram defaults on, hours dropped on v4
const v3s = migrateSettings({ version: 2, timezone: 'Asia/Singapore', resetHour: 4, features: {} });
assert.strictEqual(v3s.features.shareOutsideTelegram, true);
assert.strictEqual(v3s.resetHour, undefined);

// v3 -> v4: a user who had custom hours loses them, keeps everything else
const v4s = migrateSettings({ version: 3, timezone: 'Asia/Singapore', resetHour: 2, notifyHour: 20, notificationsOn: false, features: {} });
assert.strictEqual(v4s.version, 4);
assert.strictEqual(v4s.resetHour, undefined);
assert.strictEqual(v4s.notifyHour, undefined);
assert.strictEqual(v4s.notificationsOn, false);

console.log('migrations: all upgrade tests pass (v1 -> v4, no loss, unknown fields kept, hours dropped)');
