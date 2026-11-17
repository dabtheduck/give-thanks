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

### 9. v5 example: bot commands + group garden (2026-11-17)
Commands (`/thanks`, `/share`, `/garden`, `/sharerecap`, `/seegardens`, `/recap` for everyone) and a live group garden, added without rebuilding v1–v4:
- `CURRENT_VERSION` 4 → 5 in `lib/migrations.js` and `DATA_VERSION` in `public/app.js`.
- Migration v4 → v5: notes gain stable ids — old notes get a deterministic id from text+time (same note, same id, every migration), new notes carry their own (`app-…` from the app, `bot-…` from `/thanks`). Users gain `pendingBot: []` (bot-logged thanks the app hasn't picked up yet) and `plantChoices: {}` (chosen plant per group garden). No field removed, no CloudStorage key reused. `gt_today_meta` now also stores `adoptedBotIds` (ids the app has already merged).
- New pure modules, each with its own test: `lib/recap.js` (recap/share text + staleness notice), `lib/merge.js` (bot/app merge — no double-count, deleted stays deleted), `lib/plants.js` (10 species + deterministic defaults), `lib/garden.js` (garden store, daily reset, dedup by note id).
- `/recap` stopped being owner-only: the admin-claim code was removed, and the recap text changed (empty day: “No thanks logged today yet.”; the “A fresh day starts now. No backlog, no guilt.” line is gone when there are thanks).
- The garden is in-memory on the server (daily reset at 03:00) — a restart/redeploy empties it and it rebuilds from syncs. Since it resets every day anyway, a redeploy just resets it early. That is a deliberate storage decision, not a bug: the durable parts (garden membership `groupGardens`, plant choices `plantChoices`) live in `data.json` and survive restarts.

### 10. v5.1 example: daily garden + not-synced recap (2026-11-17)
- The garden dropped its 7-day rolling window for a daily reset at 03:00 (dab: "let's just have the garden reset every day"). `lib/garden.js` gained `rolloverGarden()`; the store shape gained a `date` field (in-memory only, no persisted change, no version bump).
- Users gained `lastSyncDate` (`null` = never synced), set on every successful `/api/sync` and persisted in `data.json`. `/recap` and `/share` use `recapStatus()` (`lib/recap.js`) to tell "not synced yet" from "genuinely empty" — the first gets an "open the app to sync" prompt, the second gets "No thanks logged today yet."
- `/thanks` now calls `saveSettings()` so `pendingBot` survives a server restart. A redeploy still wipes `data.json` — the practice is to redeploy just after 03:00.
- No version bump (data stays v5): `lastSyncDate` is additive with a `null` default, and the garden is in-memory.

### 11. v5.2 example: /send_announcement (2026-11-17)
- Owner-only, hidden from the menu, 1:1 chats only — the owner can update every user about new things, with no group posts (anyone who uses the bot in a group already has a 1:1 chat with it). Two-step like `/edit_about`: type the command, then send the announcement text as the next message; `/cancel` aborts. The bot replies with how many chats got it and how many couldn't be reached.
- Pure module: `lib/announce.js` (`formatAnnouncement` — the "🌱 Give Thanks — update" header — and `collectRecipients` — every known user's 1:1 chat id, deduped). The send loop itself lives in `server.js` (it calls `bot.telegram.sendMessage` per chat, with a per-chat try/catch so one blocked user never stops the rest).
- No version bump (data stays v5): the announcement flow is transient state only (`awaitingAnnouncement`, in-memory, like `awaitingAbout`).

### 12. v5.3 example: bare presses as editable items + picker fix + no personal garden (2026-11-17)
- Every press is a list item now — even a bare press with no note, so it shows in Today's list as "add a note…" and the note can be added later by tapping the item (or the ✏️) to edit it inline (Enter saves, Esc cancels, leaving the field saves too). The share tick only appears once a note has text. Notes with no text are left out of the recap, the share text, and the share preview (the count still includes them). A bare `/thanks` in the bot chat merges the same way.
- Plant picker fix: the fixed tab bar at the bottom of the screen was covering the picker (the `.tab` content had no bottom padding), so taps landed on the tab bar instead of the plant buttons. Fixed with `padding-bottom: 80px` on `.tab`. The picker now also shows a status line ("Your plant: 🌷 Tulip") and says so if a pick fails to save, instead of failing silently.
- Random fallback plant: a member who hasn't picked gets a random plant, assigned once and saved (`plantChoices`), so it sticks instead of changing on every load. `lib/plants.js` gained `randomPlant()`; the deterministic default is gone.
- Personal garden deleted: gardens are group features. The Garden tab shows a group garden when opened from a group's `/garden` link, the user's group gardens (or just opens the one garden) when opened normally, or a setup line ("add Give Thanks to a Telegram group, then type /garden") if they have none. `GET /api/garden` with `gardenId=personal` now 400s, and `/api/sync` no longer plants notes into a 'personal' garden.
- Dates are shown as DD-MM-YYYY (dab, 2026-11-17). Dates are stored as YYYY-MM-DD — only what the user sees is reformatted (`displayDate` in `lib/recap.js`, `formatDateDisplay` in `public/app.js`).

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
