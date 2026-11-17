# Give Thanks — How To Build It (Implementation Guide)

This is the step-by-step to get the MVP in `~/workspace/give-thanks/` running today.

## 0. What you need
- A Telegram account
- Node.js 20+ (`node -v`)
- A Telegram bot token (free, 5 min)
- A public HTTPS URL for the Mini App (for testing today: use `ngrok`, Cloudflare Tunnel, or deploy to Render / Railway / Fly.io — see §4)
- 30–60 minutes

## 1. Create the bot in BotFather
1. In Telegram, open @BotFather.
2. Send `/newbot`
3. Name: `Give Thanks`
4. Username: must end in `bot`, e.g. `GiveThanksCounterBot` (pick what's free)
5. Copy the token BotFather gives you. It looks like `123456:ABC-DEF...`
6. In BotFather, send `/setmenubutton` → pick your bot → send the Mini App URL once you have it (see §4) with text “Open Give Thanks”.
7. The command menu is set in code (v5, scoped menus — see §5), so no BotFather `/setcommands` step is needed.

Keep the token secret. Never commit `.env` to git.

## 2. Run it locally
```bash
cd ~/workspace/give-thanks
cp .env.example .env
# edit .env: BOT_TOKEN=your-token, MINI_APP_URL=http://localhost:3000, PORT=3000
npm install
npm start
```

What starts:
- Express on `http://localhost:3000` serves `public/` (the Mini App)
- Telegraf bot polling (no webhook needed locally)
- v1 has NO scheduler: no 19:30 nudge, no 03:00 recap message. The day still ends at 03:00 — the counter resets then (app-side day boundary).

Test in Telegram:
- Open your bot, send `/start`, tap “Open Give Thanks”.
- If Telegram says the Mini App URL is not reachable, that's expected on localhost — you need a public URL for Telegram to load it. See §4 for the 2-minute tunnel.

## 3. How the code is organised
```
give-thanks/
  SPEC.md                 Full spec (this project)
  HOW_TO_BUILD.md         This file
  README.md               Quick start for anyone cloning it
  package.json            Node 20, express, telegraf (node-cron is still listed but unused since v1 removed the scheduler)
  .env.example            BOT_TOKEN, MINI_APP_URL, PORT
  server.js               Everything: Express + Bot in one file for MVP (no scheduler in v1)
  public/
    index.html            Mini App shell, tabs: Counter / Garden / Science / Settings
    style.css             Cozy rough pixel art, cream / forest / burnt orange
    app.js                Counter logic, CloudStorage (chunked), sync to /api/sync,
                          settings, garden view, about content
```

### Key design decisions in code
- **CloudStorage first:** `app.js` saves today to `Telegram.WebApp.CloudStorage` immediately on press, so the counter works even if the server is briefly down. Keys: `gt_today_meta`, `gt_today_notes_1`, `gt_today_notes_2`, `gt_settings`.
- **Sync second:** after saving locally, `app.js` POSTs to `/api/sync` with the press / settings. The server validates Telegram `initData` (HMAC with bot token) before trusting `user_id`.
- **Ephemeral server store:** `server.js` keeps `users` in memory + `data.json` for *settings only*. Today's notes are in memory, keyed by user, and overwritten by the next sync. Restarting the server loses today's server copy — that's acceptable for MVP, and the CloudStorage copy means the user still sees their count (the recap button sends the app's own list, so it works even when the server copy is empty). For production, swap the in-memory map for Cloudflare KV / Upstash Redis with TTL 36h.
- **Recap (v1, on demand — no scheduler):** the app's “Send today’s recap to chat” button POSTs today’s list to `/api/recap` (validated `initData`); the server formats it with `formatRecap` (in `lib/recap.js`) and sends it to the user’s 1:1 chat. It works at any time and does not reset the day — the day ends at 03:00, when the app’s counter resets on next open. `/recap` in chat reads the server’s copy instead (same text, no reset) — everyone in 1:1 can use it (v5, no longer owner-only).
- **`/thanks` merge (v5):** `/thanks <note>` in a 1:1 chat logs to the server's today and to `pendingBot`. On next open the app fetches `/api/state`, merges the pending entries into its counter (no double-counting), and sends the adopted ids back in the next `/api/sync` so the server drops them. A bot note deleted in the app never comes back. If `/thanks` was logged but the app hasn't opened yet, `/recap` and `/share` append a nudge to open the app first, then ask again. If the app hasn't synced today at all, `/recap` and `/share` say to open the app to sync first instead of claiming the day is empty. `pendingBot` is saved to `data.json` on every `/thanks`, so it survives a server restart; a redeploy still wipes it — redeploy just after 03:00.
- **Group garden (v5, live; daily reset in v5.1):** the Garden tab shows a group garden when opened from a group's `/garden` link (`?startapp=garden_<groupId>`). One plant per shared thanks, resets every day at 03:00 with the counter, in-memory (`lib/garden.js`). `GET /api/garden` checks membership via `getChatMember` (deny on error); `POST /api/garden/plant` saves the member's plant choice. The app's sync aggregates shareable notes into every garden the user is in.
- **About / Bulletin Board:** content is `public/content/about.md`. Edit that file, write as much as you like, no code changes needed. The app fetches and renders it.

## 4. Give the Mini App a public HTTPS URL
Telegram Mini Apps require HTTPS, and Telegram's servers must reach it.

Fastest for today (testing):
```bash
# Option A: ngrok
ngrok http 3000
# copy the https://xxxx.ngrok-free.app URL, put it in .env as MINI_APP_URL, restart, set it in BotFather

# Option B: Cloudflare Tunnel (free, no account card)
cloudflared tunnel --url http://localhost:3000
```

Proper deploy (free tier, 10 min):
- **Render:** New Web Service → connect this folder → Build `npm install`, Start `npm start`, add `BOT_TOKEN` and `MINI_APP_URL=https://your-app.onrender.com` as env vars.
- **Railway / Fly.io:** same, `npm start`, set env vars.
- After deploy, set `MINI_APP_URL` to the deployed URL and update BotFather's Menu Button.

Note: polling (used in MVP) works on Render/Railway. Webhooks are more efficient at scale, but polling is fine to start.

## 5. Test checklist (do this in order)
1. `/start` → bot replies, button opens Mini App.
2. Press + 3 times, add notes to 2 of them → count = 3, notes show.
3. Reload Mini App → count still 3 (CloudStorage).
4. The day ends at 03:00 in your timezone (fixed). Leave the app open across 03:00, press after 03:00 → the new day starts fresh at 1.
5. Tap “Send today’s recap to chat” in the Counter tab → the full list arrives in your 1:1 chat with the bot, unblurred. It works at any time and does not reset the day.
6. Garden tab → your personal garden (opt-in toggle, flower field). Open it from a group's `/garden` button → the group garden plot, plants, and plant picker.
7. Open About tab → text reads well, links work.
8. Send `/recap` in a 1:1 chat → full list arrives, from the server’s copy. In a group it arrives by DM, never posted in the group. It reads the server’s today, so if the app hasn’t re-synced since a restart it says to open the app to sync first instead of claiming the day is empty — reopen the app and try again, or use the recap button instead (that one sends the app’s own list). Empty day says “No thanks logged today yet.”; a day with thanks has no “A fresh day starts now” line.
9. Send `/thanks good food` in a 1:1 chat → bot confirms; open the app → the note is in the counter (count +1, no double-count on reopen). Ask `/recap` before opening the app → the nudge to open the app first appears.
10. In a group: `/garden` → button opens the group garden; tick share on a note in the app, reopen the garden → a plant appears; tap it → the note opens in a bubble. Pick a plant → your notes show with that plant. `/sharerecap` → today's shared thanks with plant emojis, no names. In 1:1: `/seegardens` → your gardens with a button each; `/share` → the share-format list with hidden notes as `••• hidden •••`.
11. Leave the app open across 03:00, press after 03:00 → the new day starts fresh at 1 and the counter resets on next open. Reopen the app → it re-syncs on open, so a Render restart/redeploy can’t lose today’s list from the app’s side. A sync dated before today is ignored by the server (check Render logs for "sync ignored stale today").

### Bot commands (menu)
The command menu is set by `server.js` on startup (`setMyCommands`), so it stays in sync with the code — no BotFather step needed. Type `/` in any chat with the bot to see it. v5: scoped menus — 1:1 chats get `start`, `recap`, `thanks`, `share`, `seegardens`; groups get `garden`, `sharerecap`.
- `/start` — welcome + Open button. The welcome text says the day runs until 3am (night owls can review the list before bed), the counter resets at 3am, and the recap button in the app sends the list to the chat any time. It also mentions `/thanks` works right in the chat.
- `/recap` does not reset the day. It reads the server’s copy of today (not the app’s), so if the app hasn’t synced today it says to open the app to sync first instead of claiming the day is empty. In a group it DMs the full recap to whoever asked (personal notes never post in a group); in 1:1 it replies there. If the bot can't DM someone (they never tapped /start in 1:1), it says so in the group. If `/thanks` was logged but the app hasn't picked it up yet, the recap ends with a nudge to open the app first, then type `/recap` again.
- `/thanks` (1:1 only): the command is `/thanks` — everything after it is the note. `/thanks good food` logs a thanks with the note “good food”. `/thanks` alone is just +1. It logs to the server's today and to `pendingBot` (saved to `data.json` right away, so it survives a restart); the app merges it on next open. In a group it points to 1:1.
- `/send_announcement` (owner-only, hidden from the menu, 1:1 only): type the command, then send the announcement text as your next message (`/cancel` aborts). The bot sends it to every known user's 1:1 chat — no group posts — and replies with how many chats got it. Pure module: `lib/announce.js` (`formatAnnouncement`, `collectRecipients`).
- `/share` (1:1 only) sends today's list in share format. `/seegardens` (1:1 only) lists your group gardens. `/garden` and `/sharerecap` are group-only.
- Owner-only, not in the menu: `/edit_about` (1:1 only), `/cancel`.

## 6. Common gotchas
- **Mini App won't open:** URL must be HTTPS and return 200. Check BotFather Menu Button URL matches `MINI_APP_URL` exactly, no trailing slash mismatch.
- **“Bot blocked” / 403 on recap:** user blocked the bot. They need to /start again.
- **Wrong reset time:** almost always timezone. The app’s day ends at 03:00 in the timezone it detected (or stored). Check the app’s stored timezone.
- **Notes missing from /recap:** the press saved to CloudStorage but the sync POST failed (server down / initData invalid), or the server restarted since. Check server logs for `/api/sync`. The CloudStorage copy is the fallback — the app’s “Send today’s recap to chat” button sends the app’s own list, so it works even when the server copy is empty. If the recap ends with a nudge to open the app first, `/thanks` was logged in the chat and the app hasn't merged it yet — open the app, then `/recap` again.
- **Garden empty after sharing:** only notes with the share box ticked plant in a garden, and the garden resets every day at 03:00 — a restart/redeploy just resets it early, and it regrows from today's shared notes as members open the app and sync. Check that the user is a member (the server checks `getChatMember` on every load) and that the note was ticked before syncing.
- **Bot deaf after a deploy:** during a Render swap the old and new instances can both try to poll at once; Telegram answers 409 and the new instance gives up. `bot.launch()` now retries (up to 6 attempts, 10s apart). If it still doesn’t answer, Restart Service in Render.
- **CloudStorage 4096-char limit:** notes are chunked in `app.js`. Don't store the whole day in one key.
- **Telegram message limit:** recap >4096 chars is split into 2 messages in `server.js`.
- **Server's today is ephemeral:** a Render restart or redeploy wipes `u.today` (it is never saved to `data.json`); the app re-syncs on open, so the app is the source of truth. If `/recap` says to open the app to sync, reopen the app and try `/recap` again.
- **Redeploy vs restart:** a redeploy means deploying a new commit — pushing to GitHub (auto-deploy) or Manual Deploy → Deploy latest commit in Render. A restart is Manual Deploy → Restart Service (same code, just restarts the process). Both wipe the in-memory state; only a redeploy wipes `data.json`. Best time to redeploy is just after 03:00 (the day just reset, so the server's today is empty anyway and yesterday's unmerged `/thanks` are stale).
- **Presses across 03:00:** the app rolls over on press and on return (`rolloverIfNeeded` in `app.js`), rescuing post-03:00 presses stored under yesterday's date by their note times. A sync dated before the current day is ignored by the server.

## 7. What to do next after MVP works
1. Move the ephemeral store to Cloudflare KV / Upstash with TTL.
2. Switch polling → webhook.
3. Write your About / Bulletin Board text in public/content/about.md — as much as you like.
5. Privacy page + delete-my-data (`/delete` wipes settings + today).

## 8. Costs
- Telegram Bot API: free.
- Telegram CloudStorage: free.
- Render / Railway free tier: $0 to start, enough for MVP.
- Cloudflare Workers + KV free tier: $0, enough for thousands of users for the scheduler in production.
- Domain (optional): ~$10/year if you want a custom Mini App URL.

## 9. Edit the About page on the fly in Telegram
You have full autonomy over the About / Bulletin Board text. Three ways, easiest first:

**Way 1 — In Telegram (fastest, no code):**
1. Open a 1:1 chat with your bot (not a group).
2. Send `/edit_about`
3. Send your new text as your next message. As much as you like, use `#` headings, blank lines, `-` bullets.
4. The bot replies “Saved 🌱” with a preview. Open the Mini App → About to see it live.
5. Send `/cancel` instead if you change your mind — nothing changes.
Only the bot owner can do this. Set `ADMIN_USER_ID` in `.env` to your Telegram ID (get it from @userinfobot). If you don't set it, the first person to run `/edit_about` becomes the owner for that install.

**Way 2 — Edit the file:**
Edit `public/content/about.md`, save, redeploy. The Mini App loads it automatically.

**Way 3 — In the mockup:**
The mockup's About page has an Edit mode, but that only edits the mockup copy, not the live bot. Use Way 1 or 2 for the live version.
