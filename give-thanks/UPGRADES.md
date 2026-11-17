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

### 13. v5.4 example: the counter that kept reverting to 75 (2026-11-17)
- The bug (dab): the counter kept going back to 75 after an undo, and /thanks made the app's own numbers disappear on reopen. Three storage bugs in `public/app.js`, all in the same place:
  1. Saves ran concurrently — a new async save on every press — so their CloudStorage writes finished out of order and an old count (75) overwrote a newer one (74).
  2. `csGet` read CloudStorage first and used it even when localStorage held a newer value, and returned null when CloudStorage had no key at all (a write that timed out) without checking localStorage — so the app reset to 0 and only the bot thanks showed.
  3. A shrink left old note chunks behind, so deleted notes came back on the next load.
- The fix: saves are queued one at a time, in order, and each writes the CURRENT state (so the last save to finish always has the latest count). The meta carries `savedAt`; on load the app reads the meta from BOTH stores and uses the fresher one (on a tie, localStorage — it is written synchronously first, so on this device it is always at least as fresh), then reads the note chunks from that same store. Stale chunks are cleared on save, and on load the notes are deduped by id and trimmed to the count, which heals storage that already went stale. If the data came from localStorage, the app re-saves it to CloudStorage so the two stores agree again.
- Fourth bug, found while verifying the fix (2026-11-17 ~13:40 SGT): the + thanks button is live before init finishes, so a press made in the first second after opening was wiped when the stored count landed — `loadToday()` overwrote the in-memory state, and on a fresh install its reset-to-0 path did the same. Fix: `loadToday()` snapshots the in-memory state before its first await and folds the delta back on top of the stored count (presses add, undo/delete take off the end), and the fresh-install path only resets when nothing was pressed during the load. Covered by the new test below.
- No version bump (data stays v5): `savedAt` and `chunkCount` are additive fields in the meta; old metas without them load fine (tie goes to localStorage).
- Test: `lib/counter-bug.test.js` — loads the real `public/app.js` in a `node:vm` harness with stubbed Telegram CloudStorage / localStorage / DOM (no jsdom needed) and drives `press()` / `undoLastPress()` / `loadToday()`: fresh local beats stale Cloud, Cloud empty + local has data (no reset to 0), stale chunks trimmed, rapid press + undo sticks across a reload, presses during a load land on top of the stored count, and a slow CloudStorage write landing late cannot resurrect the old count. All 6 pass; all 12 lib tests pass.

### 14. v5.5 example: the group garden, in the 1:1 app (2026-11-17)
- The bug (dab): the counter worked, but the shared garden didn't — tapping a flower did literally nothing, the garden's counter showed 0, and it wasn't linked to the personal counter in the 1:1 bot. Dab wants the group garden added to the 1:1 Mini App interface.
- Root causes:
  1. The app never learned about group gardens. The server records a garden in the user's `groupGardens` when someone runs `/garden` or opens a garden, but the app only read `groupGardens` from its own CloudStorage settings — which nothing ever wrote. So the Garden tab in the 1:1 app showed the setup line, and the only way in was the group link, away from the counter.
  2. The garden's "counter" is the shared-thanks count — only notes ticked as shareable grow into the garden. With nothing ticked it shows 0 even though the personal counter has thanks. Not a bug, but nothing explained it, so it looked disconnected.
  3. The picker: per-button click listeners rebuilt with the buttons on every render, and `pickPlant` returned silently when `initData` was missing — a tap that does nothing looks broken.
- The fix: `fetchServerState` now merges the server's `groupGardens` (already returned by `GET /api/state`) into settings and saves them, so the Garden tab in the 1:1 app shows the user's gardens (one auto-opens, several give a list) — no group link needed. The garden view shows "Your thanks today: N" from the same app state as the Counter tab, so it reads as linked to the personal counter. The picker uses one delegated listener on `#plantPicker` (survives re-renders) and `pickPlant` shows a visible error instead of returning silently. `/garden` now welcomes everyone to the group's garden and explains how it grows; the bot also says hello when added to a group (`my_chat_member`) and points to `/garden`. Clicking the garden link creates the garden for that group (members = only that group's people, checked on every open) and adds it to the opener's 1:1 app. The shared group recap is `/sharerecap` in the group (plant emoji + note, no names) and a "Today's shared thanks" list in the garden view in the 1:1 app.
- No version bump (data stays v5, cache bust v20261117q): `groupGardens` was already a settings field and already returned by `/api/state`; the merge is additive.
- Test: `/tmp/gt-test/garden-v55.test.js` (jsdom 31.0.1, recreate with `npm install jsdom@31.0.1` in `/tmp/gt-test` — /tmp is ephemeral): gardens sync into the 1:1 app, a single garden auto-opens, the picker tap POSTs `/api/garden/plant` and confirms, the my-count line shows the personal count, and the in-app recap lists the shared notes with their plants. All pass.

### 15. v5.5 addendum: the garden link opened in the browser, not the Mini App (2026-11-17)
- The bug (dab): the garden link opened as a browser tab instead of the Telegram Mini App.
- Root cause: the link sent as plain text (the fallback when the web_app button fails to send, in `/garden` and `/seegardens`) was the raw Mini App URL (`https://give-thanks.onrender.com/?startapp=garden_<id>`). A raw URL pasted in a chat is just a URL — Telegram has no way to know it is a Mini App, so it opens in the browser. The web_app BUTTON was fine (a button opens the Mini App directly); only the pasted-text link was wrong.
- The fix: plain-text garden links are now `t.me` deep links (`https://t.me/givethanksbot?startapp=garden_<id>`, built by `gardenDeepLink()` in server.js, using `bot.botInfo.username` with a `givethanksbot` fallback). Tapping one opens Telegram and launches the Mini App with the start parameter. The app now reads the garden from `tg.initDataUnsafe.start_param` as well as from `?startapp=` in the URL, because a deep link passes the start parameter through `initDataUnsafe` and the URL may not carry `?startapp=` at all. Buttons keep the raw Mini App URL.
- Follow-up (dab, 2026-11-17 ~16:45 SGT): the t.me link itself failed with "something went wrong, sorry. please try again later." — but the same garden opened fine from the 1:1 app. Root cause: a `t.me/<bot>?startapp=` link launches the bot's configured Mini App, i.e. its **Menu Button**. The Menu Button was never reliably set (Muse's connector `set-menu-button` call failed with HTTP 404 on 2026-11-17, and the user opens the app via the web_app button in `/start`, not the Menu Button). Fix (v5.6, cache bust v20261117s): the server sets its own Menu Button on every start (`bot.telegram.setChatMenuButton`, next to `setMyCommands`), so no manual BotFather step and no flaky connector call is needed — the server's own token is valid. Once redeployed, the bot sets the Menu Button on startup and the t.me links work.
- No version bump (data stays v5, cache bust v20261117s → v20261117t in v5.6): additive only — a new link format and a second place to read the garden id from.
- Test: `garden-v55.test.js` gained a deep-link case — booting with `initDataUnsafe.start_param = 'garden_<id>'` and no `?startapp=` in the URL opens that garden (group garden shown, title loads). All pass.

### 16. v5.6 example: garden names, toggle, delete / archive / reorder (2026-11-17)
- The problems (dab, collated 2026-11-17 ~17:01 SGT): (1) the group link failed (see §15 — Menu Button fix); (2) with more than one garden, every row said "Open group garden" — label each with its group chat name; (3) need a button to toggle between the gardens list and an individual garden; (4) need a way to delete / archive / reorder gardens.
- The fix: `GET /api/state` now returns `gardenTitles` (gid → group chat name; fetched via `bot.telegram.getChat` when the in-memory garden record has no title, e.g. after a restart) and `archivedGardens`, and `POST /api/sync` accepts `archivedGardens`. The user record gains `archivedGardens: []` (additive — `defaultUser` + `migrateUser`, old records default to empty). The app caches titles in `settings.gardenTitles` so the list stays labelled even after a server restart, and merges `archivedGardens` from the server. The Garden tab list now labels each row with its group chat name (e.g. "🌸 Family Chat"), with per-row controls: ↑ ↓ reorder (the `groupGardens` array order IS the display order), 📥 archive, × delete. Archived gardens hide in a collapsed "Archived gardens (N)" section with a ↩ Restore button. A "← Your gardens" back button at the top of an open garden toggles to the list; `loadGarden(forceList)` makes the back button show the list even with exactly one garden (otherwise the single-garden auto-open would bounce straight back in). Delete removes a garden from YOUR list only — the garden still exists for the group, and opening it again (via `/garden` or its link) adds it back. Every change saves settings and syncs to the server, so it survives restarts and redeploys.
- No version bump (data stays v5, cache bust v20261117t): `archivedGardens` and `gardenTitles` are additive fields; old records default to empty.
- Test: `garden-v55.test.js` now covers v5.5 + v5.6 — list rows labelled with group names (no generic "Open group garden"), tap a row to open it, back button returns to the list, reorder changes the stored order and the rendered order, archive moves a garden to the archived section and restore brings it back, delete removes it from both lists and the row leaves the list, plus the picker, recap and t.me deep-link cases. All pass; all lib tests pass.

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
