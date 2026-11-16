// Give Thanks — lib/migrations.js
// Pure functions. No Telegram, no Express, no side effects except returning new data.
// Rule: migrate on read, never delete unknown fields, fill defaults for new fields.
// v1: { timezone, resetHour, notifyHour, notificationsOn, notifyOnlyIfEmpty, gardenOptIn, groupGardens }
//     today: { date, count, notes: [{text, time}] } — no version field
// v2: same + { version: 2, features: { gardenWeeklyShare: false, ... } }
//     today: { version: 2, date, count, notes: [...] }
// v3: notes gain shareable: false by default (private). Old notes without it are private.
//     features gains shareOutsideTelegram: true.
// v4: times are hardcoded, no hour settings. Recap 03:00, notification 19:30,
//     both in the user's timezone (timezone is still per-user, from device).
//     v4 migration drops resetHour / notifyHour — the only fields ever removed,
//     by explicit user decision 2026-11-17. All other unknown fields are kept.

const CURRENT_VERSION = 4;

// Fixed schedule (local time, per-user timezone). No settings, no env override.
const FIXED_RESET_HOUR = 3;
const FIXED_RESET_MINUTE = 0;
const FIXED_NOTIFY_HOUR = 19;
const FIXED_NOTIFY_MINUTE = 30;

function migrateSettings(raw) {
  const s = { ...(raw || {}) };
  const from = s.version || 1;
  if (from < 2) {
    // v1 -> v2: add features object, keep everything else untouched
    if (!s.features || typeof s.features !== 'object') s.features = {};
    if (typeof s.features.gardenWeeklyShare !== 'boolean') s.features.gardenWeeklyShare = false;
    if (typeof s.features.newRecapFormat !== 'boolean') s.features.newRecapFormat = false;
  }
  if (from < 3) {
    if (!s.features || typeof s.features !== 'object') s.features = {};
    if (typeof s.features.shareOutsideTelegram !== 'boolean') s.features.shareOutsideTelegram = true;
  }
  if (from < 4) {
    // v3 -> v4: hours are hardcoded now. Drop the two hour settings.
    delete s.resetHour;
    delete s.notifyHour;
  }
  s.version = CURRENT_VERSION;
  // defaults for any missing core field (old or new clients)
  if (!s.timezone) s.timezone = 'Asia/Singapore';
  if (typeof s.notificationsOn !== 'boolean') s.notificationsOn = true;
  if (typeof s.notifyOnlyIfEmpty !== 'boolean') s.notifyOnlyIfEmpty = true;
  if (typeof s.gardenOptIn !== 'boolean') s.gardenOptIn = false;
  if (!Array.isArray(s.groupGardens)) s.groupGardens = [];
  return s;
}

function migrateToday(raw) {
  const t = { ...(raw || {}) };
  const from = t.version || 1;
  // v1 -> v2: no shape change yet, just stamp the version. Keep notes as-is.
  // v2 -> v3: notes gain shareable. Old notes default to false = private, never shared.
  void from;
  t.version = CURRENT_VERSION;
  if (!t.date) t.date = new Date().toISOString().slice(0, 10);
  if (!Number.isInteger(t.count)) t.count = 0;
  if (!Array.isArray(t.notes)) t.notes = [];
  t.notes = t.notes.slice(0, 200).map(n => ({ text: String(n.text || '').slice(0, 140), time: String(n.time || ''), shareable: typeof n.shareable === 'boolean' ? n.shareable : false }));
  return t;
}

function migrateUser(raw) {
  // raw may be a v1 user record from data.json, or a partial sync payload.
  // Preserve unknown top-level fields (forward compat: v2 fields seen by v1 code).
  const u = { ...(raw || {}) };
  const settingsPart = migrateSettings({
    version: u.version, timezone: u.timezone, resetHour: u.resetHour,
    notifyHour: u.notifyHour, notificationsOn: u.notificationsOn,
    notifyOnlyIfEmpty: u.notifyOnlyIfEmpty, gardenOptIn: u.gardenOptIn,
    groupGardens: u.groupGardens, features: u.features,
  });
  Object.assign(u, settingsPart);
  // v4: make sure no stale hour fields survive on the user record either.
  delete u.resetHour;
  delete u.notifyHour;
  if (u.today) u.today = migrateToday(u.today);
  u.version = CURRENT_VERSION;
  return u;
}

module.exports = { CURRENT_VERSION, migrateSettings, migrateToday, migrateUser, FIXED_RESET_HOUR, FIXED_RESET_MINUTE, FIXED_NOTIFY_HOUR, FIXED_NOTIFY_MINUTE };
