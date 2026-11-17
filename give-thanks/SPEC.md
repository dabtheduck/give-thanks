# Give Thanks — Full Product Spec
**Version:** 1.0 MVP, data v5 — 17 Nov 2026 (v5: bot commands + group garden; v1: no scheduled nudge/recap; the day ends at 03:00, see §3)
**Platform:** Telegram Bot + Telegram Mini App
**Audience:** Everyone. Cozy pixel art, rougher / retro-RPG feel, for guys and girls. Low cortisol throughout.

## 1. What it is
Give Thanks is a daily gratitude counter.

Press a big button once = +1 thanks. Optionally tag a short note to that press, e.g. “warm soup”, “my sister called”, “sun on my face”.

Whenever you want, tap “Send today’s recap to chat” in the app and the bot sends you a recap message in your 1:1 chat with the bot. That recap *is* the archive. There is no long-term database of your history. You can search / scroll your Telegram chat to find past days.

Each user's 1:1 chat with the bot is their identity. No username, email, or password. Telegram `chat_id` / `user_id` is the ID.

## 2. Core loop
1. Tap the Add to Home Screen shortcut. It opens straight to the Counter — no splash, no feed.
2. Big pixel button in the centre. Press it. Haptic + soft pop + tiny pixel sparkle / flower bloom.
3. Count for today goes up. An optional note field sits right under the button. Type a note and press + again, or press + first and add a note to the last press.
4. You can press as many times as you like. No timers, no combos, no penalties.
5. Your day runs until 3am, so night owls can add thanks and look back over the list before bed — the counter resets at 3am, and a fresh day starts.
6. Tap “Send today’s recap to chat” any time to save the day’s list in your 1:1 chat. It works at any time and does not reset the day.

### Non-goals for MVP
- No streaks shown as a number to protect, no leaderboards, no likes, no public profiles.
- No streak-shaming copy. Missing a day is neutral: the recap just says “No thanks logged today yet.” if applicable.
- No medical claims. The About / Bulletin Board page is educational only.
- No scheduled notifications and no scheduled recap in v1 (removed 2026-11-17: the server could not be trusted to have the day’s list at 03:00, so the recap is on demand from the app instead).

## 3. Screens (Mini App)
All in one Mini App, bottom tabs: Counter | Garden | Share | About

### 3.1 Counter (home / first screen)
- Today's date, in the user's timezone, shown as DD-MM-YYYY (dab, 2026-11-17). Dates are stored as YYYY-MM-DD (it sorts and compares correctly) — only what the user sees is reformatted.
- Large count for today, in chunky pixel numerals.
- Big press button, at least 120px, centre screen.
- Note input under the button, placeholder: “What are you thankful for? (optional)”
- “Add note to last press” behaviour: if you type a note without pressing, it attaches to the most recent press. If you type then press +, it creates a new press with that note.
- Today's notes list below, newest first, each with its press number (#1, #2…), time, and text. Tap a note to edit / delete it before reset. A press with no note shows as "add a note…" — tap it to add the note later (v5.3).
- Small, calm progress visual: a pixel plant / lantern that grows slightly with count, but with no target number and no “goal reached” pressure. It just grows.
- Settings gear top-right, Garden and Science via bottom tabs.

### 3.2 Settings
- Timezone: auto-detected from device (`Intl.DateTimeFormat().resolvedOptions().timeZone`), editable via a dropdown of IANA zones.
- Reset: hardcoded 03:00, in the user's timezone. No setting. The day ends at 3am, not midnight, so night owls up past midnight don't lose their day.
- No notifications in v1. No notification settings.
- Garden opt-in: toggle, default off. (Personal garden. Group gardens are per-group, see §3.4.)
- Language: English for MVP.
- Data: “Your notes live in Telegram CloudStorage on your device/account and in a temporary store on the server. Your recaps stay in your Telegram chat.” + a “Clear today's data” button.

### 3.3 Sharing — outside Telegram, as a message or an art page
Sharing is opt-in per note, not per day. Default is private.

- Each note in today's list has a checkbox: “Share this one”.
  - Ticked = shareable. Unticked = private, blurred out in any share.
  - Default for new notes and for all old notes (v1/v2, no flag yet) is **unticked / private**. The user has to actively tick to share.
  - The checkbox state is saved with the note (`shareable: true/false`) in CloudStorage and in the sync payload. Changing it does not change the note text or the recap.
- Share preview: tapping “Share today” opens a preview first. The user sees exactly what will go out, with private notes shown blurred / pixel-blocked, and can tick / untick right there before sending. Nothing is shared without this preview step.
- Two share formats, both outside Telegram:
  1. **As a message (text):** plain text, copyable and shareable via the phone share sheet to WhatsApp, iMessage, Instagram DMs, email, etc.
     ```
     🌱 Give Thanks — Mon 17 Nov 2026
     I said thanks 7 times today.

     1. warm soup
     2. ••• hidden •••
     3. sun on my face
     ```
     Private notes appear as `••• hidden •••`, never as the real text. Count stays true (7 total, even if only 3 are shown).
  2. **As an art page (image):** a pixel-art card PNG, same content as the message, in the Give Thanks style (cream, forest, burnt orange, chunky pixel border). Shared notes in pixel font, private notes as grey pixel blocks. The image is generated on-device with canvas, no server upload, no link that leaks data.
- How it shares outside Telegram:
  - On mobile: Web Share API (`navigator.share`) with text or with the PNG file, so the user picks WhatsApp / Instagram / Messages / etc. from the system sheet.
  - Fallback: Copy text button, and Download image button. Desktop: copy + download.
  - No public link is created. No share goes to the garden, to the bot chat, or to any server unless the user explicitly picks that destination in the share sheet.
- What is never shared: unticked note text, timestamps of private notes (only the count is kept), the user's Telegram ID / name, garden data, or settings.
- This is a v3 feature, behind the `shareOutsideTelegram` flag in `lib/features.js`, default on for new installs, and migrated safely: see UPGRADES.md and `lib/migrations.js` (v2 → v3 adds `shareable: false` to old notes).

### 3.4 Garden (community, anonymous, opt-in)
**Live in v5 (2026-11-17), group-only in v5.3, in the 1:1 app in v5.5.** The Garden tab shows the user's group gardens in the 1:1 Mini App (one auto-opens, several give a list) — the app merges the server's `groupGardens` (from `GET /api/state`) into its settings, so no group link is needed. It also shows a group garden when opened from a group's `/garden` link. The personal garden was deleted in v5.3 — gardens are group features. The garden view shows "Your thanks today: N" (the personal counter, same app state as the Counter tab) so the garden reads as linked to it, and a "Today's shared thanks" recap list (plant + note, tap to read) — the same list `/sharerecap` sends to the group.
- Personal Garden: if opted in, each of your thanks adds an anonymous flower / pixel plant to a shared garden. No names, no note text shown by default.
- Group Garden: a garden just for one Telegram group.
  - How to create: add @GiveThanksBot to a group (it says hello and points to `/garden`), send `/garden` in the group. The bot welcomes everyone to the garden and posts a button to open it, plus the plain link as a fallback (a bad button URL can fail the whole send silently, so the link is the safety net). The plain-text link is a `t.me` deep link (`https://t.me/givethanksbot?startapp=garden_<id>`) — a raw Mini App URL pasted as text opens in the browser instead of the Mini App. Clicking the link creates the garden for that group — members are only that group's people, checked on every open — and adds it to the opener's 1:1 app. The app reads the garden from `?startapp=` in the URL or from `tg.initDataUnsafe.start_param` (a deep link passes it there).
  - What it looks like: a cute plot of land. One plant per shared thanks, placed at a stable spot (position comes from the note's id, so the plot doesn't reshuffle). Tap a plant and its note opens in a bubble card, with a haptic pop.
  - The garden's count is the shared-thanks count: only notes ticked as shareable grow into it, so it can show 0 while the personal counter has thanks — that means nothing is shared yet, not that it is disconnected.
  - Managing gardens (v5.6): the Garden tab lists each garden by its group chat name (not "Open group garden"). Tap a name to open it; a "← Your gardens" button at the top of an open garden toggles back to the list. Each row has ↑ ↓ to reorder, 📥 to archive (hidden in a collapsed "Archived gardens" section, restorable with ↩), and × to remove it from your list. Removing a garden only removes it from YOUR list — the garden still exists for the group, and opening it again adds it back.
  - Who can see it: only members of that group. The server checks membership via `getChatMember` on every load; if it can't confirm, access is denied (safe default).
  - What is shared: only thanks with the share box ticked. No names — each member picks one of 10 plant designs to represent themselves (Sunflower, Tulip, Rose, Daisy, Cactus, Fern, Mushroom, Clover, Bamboo, Hyacinth), changeable any time. A member who hasn't picked yet gets a random plant, assigned once and saved, so it sticks. The plant is the identity: somewhat anonymous, but not entirely.
  - How long it grows: one day. The garden resets at 03:00 with the counter — a fresh garden each morning. The garden is stored in memory on the server (like today's notes) — a restart or redeploy empties it, and it rebuilds as members open the app and sync, but since it resets every day anyway, a redeploy just resets it early. The user's list of gardens and their plant choices are persisted (data.json), so a garden is re-discoverable after a restart.
  - `/seegardens` in a 1:1 chat lists all your group gardens, with a button to open each.
  - `/sharerecap` in a group posts today's shared thanks, each with the member's plant emoji, no names.
  - Leaving: leave the group, and your future presses stop adding to that garden. Past shared notes stay until the garden resets at 03:00.
- No likes, no comments, no DMs, no follower counts, no ranking. Garden view is a calm pixel field, not a feed.

### 3.5 About / Bulletin Board
A page inside the Mini App, not a separate website for MVP.
Sections:
1. What this is — a tiny daily habit, not a cure.
2. What research says — short, plain-language summaries of gratitude journaling studies: e.g. people who regularly note things they are grateful for tend to report higher wellbeing in studies, with links to sources. No overclaiming, no numbers presented as guarantees.
3. How Give Thanks works — press, note, recap, reset. Why a daily reset helps: fresh start, no backlog guilt.
4. Why low cortisol by design — no streaks, no social comparison, no notifications.
5. Not medical advice — if you are struggling, consider talking to a clinician / trusted person, with a link to local support resources (to be added per region).
6. Privacy in one paragraph — see §6.

Content is editable in `public/content/about.md` — dab has full autonomy to write whatever, as much text as they like, no code changes needed.

## 4. Notifications
None in v1. The 19:30 nudge was removed 2026-11-17 along with the scheduled recap — the server could not be trusted to be awake and to have the day’s list at the right minute, so v1 sends nothing on a schedule. If notifications come back, they must be gentle, rotating, never shaming (“Anything you're thankful for today?”, never “You haven't pressed yet!” / “Don't break your streak!”), max 1 per day, and skipped if the user already pressed.

## 5. Recap (the archive)
On demand, from the app. Tap “Send today’s recap to chat” in the Counter tab and the bot sends this in the 1:1 chat:

```
🌱 Give Thanks — [Date, e.g. Mon 17 Nov 2026]
You said thanks 7 times today.

1. 09:12 — warm soup
2. 13:40 — my sister called
3. 18:05 — sun on my face
…
```

- If 0 presses: “No thanks logged today yet.”
- Notes are listed in press order, with local time.
- Sending the recap does NOT reset the day — the counter resets at 03:00 on next open. You can send the recap as many times as you like.
- The recap message is the archive. Users find old days via Telegram search in that chat.
- The recap is built from the app’s own list (CloudStorage), via POST `/api/recap` — not from the server’s ephemeral copy, which a restart can wipe. `/recap` in chat reads the server’s copy instead (same text, no reset); it can say 0 after a restart until the app re-syncs on open. If thanks were logged in the bot chat with `/thanks` but the app hasn't picked them up yet, `/recap` says so and asks the user to open the app first, then type `/recap` again. If the app hasn't synced today at all, `/recap` doesn't claim the day is empty — it says to open the app so it syncs, then type `/recap` again.

## 6. Data & privacy
### 6.1 What is stored, where, for how long
| Data | Where | How long |
|---|---|---|
| Today's count + notes | Telegram CloudStorage (per user, per bot, synced by Telegram, free) + temporary server store (see below) | Until the 03:00 reset, then a new day starts |
| Settings: timezone, toggles, garden opt-ins | Temporary server store, mirrored in CloudStorage | Until user changes / deletes |
| Chat ID / user ID | Server store, to send the recap | Until user blocks the bot |
| Recaps | Telegram chat history only | As long as Telegram keeps the chat |
| Garden counts | Ephemeral aggregate per garden per day, no names | Until daily garden summary, then reset to count only |
| Group garden notes | In-memory server store, one day only, no names | Resets at 03:00 with the counter; emptied on restart/redeploy, rebuilds from syncs |
| Group garden membership + plant choices | Server `data.json` (user record: `groupGardens`, `plantChoices`) | Until user leaves the group / changes plant |
| Last sync day | Server `data.json` (user record: `lastSyncDate`) | Until the next sync |

No long-term history database. No passwords. No email.

### 6.2 Telegram CloudStorage limits (verified)
- Up to 1024 keys per user per bot, each value 0–4096 characters, keys 1–128 characters.
- Free, hosted by Telegram, synced across devices.
- Total theoretical max ~4 MB. Plenty for today-only data.
- Implementation: one key for `today_meta` (date, count), chunked keys `today_notes_1`, `today_notes_2`, … each ≤4096 chars, ~50 short notes per chunk. Settings in `settings` key.
- CloudStorage is client-only: only the Mini App JS can read/write it. The bot server cannot read it via the Bot API.

### 6.3 Why a temporary server store is needed
CloudStorage is client-only: only the Mini App JS can read/write it. The bot server cannot read it via the Bot API. So the app also syncs a copy to the server:
- On each press, the Mini App saves to CloudStorage (source of truth on device), AND POSTs a lightweight sync to `/api/sync` with validated Telegram `initData`. Saves are queued one at a time, in order (v5.4 — concurrent saves let an old count overwrite a newer one). The meta carries `savedAt`; on load the app reads the meta from both CloudStorage and localStorage and uses the fresher one. Stale note chunks are cleared on save and trimmed on load.
- The server copy exists for `/recap` in chat, for merging `/thanks` logged in the bot chat into the app's counter on next open, and for feeding group gardens. The on-demand recap button does not need it — it POSTs the app’s own list to `/api/recap` and the server just delivers it.
- The server store is ephemeral: in the MVP code it is an in-memory map + a `data.json` for settings only, with today's notes held in memory and overwritten by the next sync (a restart wipes it; the app re-syncs on open). In production, use a KV with TTL 36 hours (e.g. Cloudflare KV, Upstash Redis). Never store past days. v5.9: the garden (all groups) is also saved to `garden.json` on every change and reloaded on startup, so a restart keeps it; a redeploy still wipes it and it rebuilds from syncs as people open the app.
- v1 has no scheduler (removed 2026-11-17): nothing on the server fires on a clock. The 03:00 reset is app-side (the day key changes), and a wake-up ping at 02:55 keeps the server awake around the reset so the app’s first sync of the new day is fast.

### 6.4 Group garden data
- Garden ID = Telegram group `chat_id`.
- Membership check via Bot API `getChatMember`, on every garden load and every plant pick. If the check fails or can't be confirmed, access is denied.
- Only shareable (ticked) notes enter a garden. Their text IS shown in the garden (tap a plant to read it) — that's the point of the garden — but with no name, only the member's plant.
- Daily reset at 03:00 with the counter (v5.1 — was a 7-day rolling window in v5). In-memory. A restart/redeploy empties the garden; it rebuilds from syncs — but since it resets every day anyway, a redeploy just resets it early.
- Plant choice is per user per garden, persisted in the user record (`plantChoices`); the list of gardens a user is in (`groupGardens`) is persisted too.

## 7. Art style
**Direction:** Cozy pixel art, rougher / retro-RPG, for everyone.
- Reference feel: Stardew Valley, old Game Boy / SNES RPGs, chunky 8-bit.
- Palette: cream #FFF6E5, charcoal #2B2B2B, forest #4A7C59, sage #A8C3A0, burnt orange #D97B29, burnt sienna #A0522D, stone grey #8A8A8A, wood brown #7A5230. No pastel-pink-only, no hearts everywhere.
- Motifs: lantern, mug, tree, mountain, campfire, stone, leaf, flower. Pixel font for numbers/headings (e.g. “Press Start 2P” for headings, system sans for body notes so notes stay readable).
- Motion: 120ms pop on press, tiny pixel sparkle, plant grows a pixel at a time. No flashing, no loud sounds. Optional soft pop sound, mutable.
- Buttons: chunky pixel borders, 4px, hard shadow, no gradients.
- Low cortisol visual rules: no red alerts, no badge counts, no pulsing “urgent” animation, plenty of whitespace.

## 8. Bot commands
Menus are scoped (v5) and set in code on every start via `setMyCommands` — no BotFather step needed.
- **1:1 chat:** `/start` — welcome, open Mini App button, explain the loop. `/recap` — today's thanks log, from the server's copy (same text as the app's recap button, no reset). `/thanks` — log a thanks right in the chat: whatever you type after `/thanks` becomes the note (e.g. `/thanks good food` logs a thanks with the note “good food”, just like a press). `/thanks` on its own is just +1. `/share` — today's list in share format (ticked notes shown, unticked as `••• hidden •••`). `/seegardens` — list your group gardens, with a button to open each.
- **Group chat:** `/garden` — open this group's garden (button + plain link fallback). `/sharerecap` — today's shared thanks in this group, each with the member's plant emoji, no names.
- **Hidden, owner-only:** `/edit_about` (1:1 only), `/cancel`.

`/thanks` merges into the app on next open: the bot-logged thanks live on the server (`pendingBot`, persisted to `data.json` on every `/thanks`, so they survive a server restart — a redeploy still wipes `data.json`, so redeploy just after 03:00) until the app opens and picks them up (no double-counting; a bot note deleted in the app never comes back). If `/thanks` was logged but the app hasn't opened yet, `/recap` and `/share` say so and ask the user to open the app first, then ask again. If the app hasn't synced today at all, `/recap` and `/share` don't claim the day is empty — they say to open the app so it syncs, then ask again.

`/send_announcement` (owner-only, hidden from the menu) lets the owner update every user about new things. Two-step, like `/edit_about`: type the command, then send the announcement text as the next message; `/cancel` aborts. It goes to every known user's 1:1 chat — no group posts, because anyone who uses the bot in a group already has a 1:1 chat with it. The bot replies with how many chats got it (and how many couldn't be reached, e.g. they blocked the bot).
`/thanks` and `/share` are 1:1 only — in a group they point to 1:1, so notes never leak. `/recap` in a group DMs the recap to whoever asked, never posts it in the group.

The bot does not handle `web_app_data` in v1 (the recap button uses POST `/api/recap` instead).

## 9. Scheduler
None in v1. The 19:30 nudge and 03:00 recap were removed 2026-11-17: the server could not be trusted to be awake and to hold the day’s list at the right minute, so the recap is on demand from the app instead.
- The 03:00 reset is app-side: the day key changes at 03:00 in the user’s timezone, and the counter resets on next open (or on press / return via `rolloverIfNeeded`).
- A wake-up ping at 02:55 (a scheduled job outside this codebase) keeps the server awake around the 03:00 reset, so the app’s first sync of the new day and any recap send are fast.
- If a scheduler comes back, it must be idempotent per user per day (`last_notify_date` / `last_recap_date`), and the recap must be built from a store the server can trust — see §6.3.
- Timezone / DST: use IANA zone + `Intl` / `luxon`-style handling in production. In MVP code, use `Intl.DateTimeFormat` with `timeZone`.
- Scale note: this design works to thousands of users on a free Cloudflare Worker / single Node process. Beyond that, shard by hour.

## 10. Edge cases
- User presses after midnight but before 03:00 (e.g. 01:00): still counts for *yesterday's* day, because the “day” ends at 03:00, not midnight.
- Times are fixed, so there is no mid-day reset change to handle.
- User changes timezone while travelling: next reset uses new zone, today is not retroactively split.
- User opens app after 03:00: app detects date mismatch vs CloudStorage, shows fresh day, and re-syncs on open.
- User blocks bot: Telegram returns 403 when the recap button tries to send; the app says so and asks them to /start again.
- Note longer than limit: cap at 140 characters per note, truncate with ellipsis.
- More than ~50 notes: chunk CloudStorage keys, recap message capped at Telegram's 4096-char message limit — if longer, split into 2 messages.
- Offline press: save to CloudStorage / localStorage first, sync when back online, show “saved on this device, syncing…”.

## 11. Success criteria for MVP (today)
- [ ] Bot created in BotFather, Mini App URL set, token in `.env`, bot responds to /start.
- [ ] Shortcut opens straight to Counter, press works, count persists across reloads via CloudStorage.
- [ ] Note attaches to a press, shows in today's list, appears in recap.
- [ ] Counter resets at 03:00 local time on next open; night-owl presses before 03:00 still count for that day.
- [ ] “Send today’s recap to chat” sends the full list to the 1:1 chat, any time, and does not reset the day.
- [ ] Empty day says “No thanks logged today yet.”; a day with thanks has no “A fresh day starts now” line.
- [ ] `/thanks good food` in a 1:1 chat logs to the counter and merges into the app on next open, no double-count; `/recap` nudges to open the app first if the merge hasn't happened yet.
- [ ] Group garden works: `/garden` in a group opens a plot, shared thanks plant, tap a plant to read its note in a bubble, plant picker works, `/seegardens` lists your gardens, `/sharerecap` posts shared thanks with plant emojis.
- [ ] About / Bulletin Board readable, editable in public/content/about.md and via /edit_about.
- [ ] No long-term DB: no past days stored on the server; recaps live in the Telegram chat only.

## 12. Out of scope for MVP
- iOS/Android native home-screen widget (shortcut is enough).
- Payments, premium, accounts, social login.
- Photo notes, voice notes.
- Export / PDF of history (Telegram search is the export for MVP).
- Multi-language.

## 13. Modularity & seamless upgrades (v1.0 → v2.0, no data loss)
This is a hard requirement, not a nice-to-have. A v1.0 user must open v2.0 and see the same count, notes, settings, and gardens, with no crash and no reset.

### 13.1 Rules
1. **Never break the core loop.** Counter → note → recap → reset must keep working even if a new feature fails to load. New features are additive and isolated.
2. **Version every piece of data.** Every stored record carries a `version` number. Code never assumes the current version. See `lib/migrations.js` and `public/app.js` (`DATA_VERSION`).
3. **Migrate on read, never on deploy.** When old data is loaded, it is migrated in memory to the current shape, then saved back in the new shape. No bulk migration job, no downtime, no “run this script first”.
4. **Never delete unknown fields.** If v1.0 code sees a v2.0 field it doesn't understand, it keeps it and passes it through. If v2.0 code sees a v1.0 record, it fills in defaults for new fields and keeps the old ones.
5. **Additive only for v1.x, with one exception.** New fields are optional with defaults. Renames are done by adding the new name *and* keeping the old one for one full version, then deprecating. Never rename a CloudStorage key in place — add a new key and migrate. Exception (v4, 2026-11-17, explicit user decision): `resetHour` / `notifyHour` were removed because times are now hardcoded 03:00 / 19:30. Exception (v1 wrap-up, 2026-11-17, explicit user decision): the scheduled nudge and recap were removed; `lastRecap` / `lastNotifyDate` / `lastRecapDate` are dormant in the record and may be dropped in a future version. No other fields are ever removed.
6. **Feature flags, not forks.** New features ship behind a flag in settings (`features: { gardenWeeklyShare: false }`). Turn it on per user / per group, roll it back without a redeploy of the core. A flag off must be identical to v1.0 behaviour.
7. **Modular code layout.** One feature = one module. Core (counter, recap, reset) never imports a feature module directly; features register themselves. See §13.3.
8. **Backwards-compatible API.** `/api/sync` and `/api/state` accept v1 and v2 payloads. Unknown fields are ignored, missing fields get defaults. API version is in the payload (`apiVersion: 1`), not just the URL.
9. **Safe fallback.** If the Mini App JS fails to parse new data, it falls back to the last known good today from CloudStorage and shows a calm “Couldn't load the new bits, your thanks are safe” — never a blank screen, never a zeroed count.
10. **Test the upgrade path every release.** Test matrix: v1.0 data → v2.0 code, v2.0 data → v1.0 code (must not crash, must preserve unknown fields), and offline v1.0 press → sync after upgrade.

### 13.2 Data versioning
- Client: `gt_settings` now stores `{ version: 5, timezone, ... }` — v4 dropped `resetHour` / `notifyHour`. `gt_today_meta` stores `{ version: 5, date, count, pressHistory, adoptedBotIds }`. Old v1 records with no `version` are treated as version 1.
- Server: `data.json` records store `{ version: 5, ... }`. `lib/migrations.js:migrateUser()` upgrades v1 → v5: notes gain stable ids (v5, deterministic from text+time for old notes), users gain `pendingBot: []` and `plantChoices: {}` (v5.1: `lastSyncDate: null`, set on every successful sync).
- Pure modules (v5, each with its own test): `lib/recap.js` (recap/share text + staleness notice + not-synced prompt + DD-MM-YYYY display), `lib/merge.js` (bot/app merge), `lib/plants.js` (10 species + random fallback), `lib/garden.js` (garden store, daily reset, dedup).
- CloudStorage keys are namespaced and never reused for a different shape: `gt_today_notes_1` stays notes. A new feature gets a new key, e.g. `gt_garden_weekly_1`, never overwrites an old one.
- Today's notes are still ephemeral (a new day starts at 03:00), but *settings* and *garden membership* are durable and must survive upgrades.

### 13.3 Modular layout (from v1.1)
```
server.js              Entry only: wires modules, no feature logic
lib/
  migrations.js        migrateUser(), migrateSettings(), migrateToday() — pure, tested
  store.js             load/save settings, ephemeral today store, TTL helpers
  features.js          FEATURES registry, isEnabled(user, feature), registerFeature()
  scheduler.js         tick(), notify, recap — core only
  bot.js               Telegraf commands — core only
  garden.js            Group garden logic — feature module
  about.js            About / Bulletin Board content — feature module
features/
  weekly-share.js      Example: registers itself, no core changes needed
public/
  app.js               Core counter + loader
  features/
    garden.js          Garden tab, lazy-loaded
    about.js          About tab, lazy-loaded
```
A new feature in v2.0 means: add one file under `lib/` or `features/`, add one flag in `features.js`, add one migration step if it needs new data. It must not edit `server.js` core logic, the counter, or the recap format.

### 13.4 Release checklist for v2.0
- [ ] All v1.0 settings / today data load in v2.0 with no loss (automated test in `lib/migrations.js`).
- [ ] v2.0 data opened in v1.0 code does not crash and does not delete v2.0 fields.
- [ ] New feature behind a flag, default off, can be turned off without losing core data.
- [ ] Recap format unchanged unless the user opts into the new format.
- [ ] Rollback plan: redeploying v1.0 after v2.0 must not lose settings or today's count.
