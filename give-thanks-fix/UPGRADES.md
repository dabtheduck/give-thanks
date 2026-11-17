# Give Thanks — Upgrades: v1.0 → v2.0 without losing data

This is the rulebook the code in `lib/migrations.js` and `public/app.js` follows.

## The promise
A person on v1.0 opens v2.0 and sees the same count, notes, settings, and gardens. No crash, no reset, no “please start over”.

## How we keep it

### 1. Version everything
- Settings: `{ version: 4, timezone, ... , features: {...} }` (v4 dropped `resetHour` / `notifyHour` — see §8)
- Today: `{ version: 2, date, count, notes: [...] }`
- Server user record in `data.json`: `{ version: 2, ... }`
- API payloads: `{ apiVersion: 1 }` for v1, `{ apiVersion: 2 }` for v2. The server accepts both.

No `version` field on an old record = version 1. That's deliberate.

### 2. Migrate on read, never on deploy
When old data is loaded, `migrateUser()` / `migrateSettings()` / `migrateToday()` run in memory:
- fill in defaults for new fields
- keep every old field
- keep every *unknown* field (so v2 data opened by v1 code doesn't lose v2 fields)

Then the migrated shape is saved back. No bulk migration, no downtime.

### 3. Additive only
- New fields are optional with defaults.
- Renames: add the new name, keep the old name for one full version.
- Never reuse a CloudStorage key for a different shape. New feature = new key, e.g. `gt_garden_weekly_1`.

### 4. Feature flags, not forks
New features live in `lib/features.js` behind a flag, default off. Example:
```js
features: { gardenWeeklyShare: false, newRecapFormat: false }
```
Turning a flag off returns behaviour to v1.0. Turning it on never touches core data.

### 5. One feature = one module
```
lib/migrations.js   pure migration functions, tested
lib/features.js     flag registry
lib/store.js        (planned) settings + ephemeral store
lib/scheduler.js    (planned) tick / notify / recap
lib/bot.js          (planned) commands
lib/garden.js       (planned) group garden
features/weekly-share.js  example feature module, registers itself
public/features/garden.js / science.js  lazy-loaded tabs
```
Core (counter, settings, scheduler, recap) never imports a feature module directly. Features register themselves.

### 6. Safe fallback in the Mini App
If new data fails to parse, `app.js` falls back to the last known good today from CloudStorage and shows “Couldn't load the new bits, your thanks are safe” — never a blank screen, never a zeroed count.

### 7. v3 example: sharing (2026-11-17)
Sharing was added as a v3 feature without rebuilding v1/v2:
- `CURRENT_VERSION` 2 → 3 in `lib/migrations.js` and `DATA_VERSION` in `public/app.js`.
- Migration v2 → v3: notes gain `shareable: false` by default. Old notes stay private.
- Flag `shareOutsideTelegram` added in `lib/features.js`, default on.
- No CloudStorage key was reused. No recap format changed. Core counter code was untouched except for the per-note checkbox.

### 8. v4 example: hardcoded times (2026-11-17)
Times are now fixed — recap 03:00, notification 19:30, in each user's timezone. No hour settings.
- `CURRENT_VERSION` 3 → 4 in `lib/migrations.js` and `DATA_VERSION` in `public/app.js`.
- Migration v3 → v4: drops `resetHour` / `notifyHour` from settings and user records. This is the only field removal ever made, by explicit user decision. All other unknown fields are still kept.
- Old clients sending `resetHour` / `notifyHour` in `/api/sync` are ignored by the server. `/api/state` returns the fixed times (3, 0, 19, 30) for display.
- Timezone is still per-user, auto-detected from the device, and still stored.
- Scheduler: the tick now only acts at 19:30 (notify) and 03:00 (recap), once per day per user.

## Adding a feature in v2.0 — checklist
1. Add the flag to `lib/features.js`, default off.
2. Add one file under `lib/` or `features/`. Do not edit the counter or recap core.
3. If it needs new data, add one migration step in `lib/migrations.js` (v2 → v3).
4. Add a new CloudStorage key if the client needs it. Never overwrite an old key.
5. Test: v1 data → v2 code (no loss), v2 data → v1 code (no crash, no loss of unknown fields), offline v1 press → sync after upgrade.
6. Ship with the flag off, turn it on for a few users first.

## What is durable vs ephemeral
- Durable, must survive upgrades: settings, timezone, garden membership, feature flags. (Reset/notify hours were durable until v4, when they were removed — see §8.)
- Ephemeral, deleted after recap: today's count + notes. Even here, an upgrade mid-day must not wipe today — migration preserves `today` as-is.
- Archive: Telegram chat history. Upgrades never touch it.
