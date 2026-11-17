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
7. Optional: `/setcommands` and paste (v1 — only `/start` is listed; `/recap` and `/edit_about` are owner-only and hidden):
```
start - Start Give Thanks
```

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
- **Recap (v1, on demand — no scheduler):** the app's “Send today’s recap to chat” button POSTs today’s list to `/api/recap` (validated `initData`); the server formats it with `formatRecap` and sends it to the user’s 1:1 chat. It works at any time and does not reset the day — the day ends at 03:00, when the app’s counter resets on next open. Owner-only `/recap` in chat reads the server’s copy instead (same text, no reset).
- **Group garden:** parked for v1. The Garden tab shows a blurred “we’re still working on this!” card. The `/garden` command and the `/api/garden` aggregation are dormant in the code, not deleted.
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
6. Garden tab → blurred content with a “we’re still working on this!” card.
7. Open About tab → text reads well, links work.
8. Send `/recap` (owner-only, hidden from the menu) → full list arrives, from the server’s copy. In a group it arrives by DM, never posted in the group. It reads the server’s today, so if the app hasn’t re-synced since a restart it can say 0 even though the app shows thanks — reopen the app and try again, or use the recap button instead (that one sends the app’s own list).
9. Leave the app open across 03:00, press after 03:00 → the new day starts fresh at 1 and the counter resets on next open. Reopen the app → it re-syncs on open, so a Render restart/redeploy can’t lose today’s list from the app’s side. A sync dated before today is ignored by the server (check Render logs for "sync ignored stale today").

### Bot commands (menu)
The command menu is set by `server.js` on startup (`setMyCommands`), so it stays in sync with the code — no BotFather step needed. Type `/` in any chat with the bot to see it. v1: only `/start` is listed.
- `/start` — welcome + Open button. The welcome text says the day runs until 3am (night owls can review the list before bed), the counter resets at 3am, and the recap button in the app sends the list to the chat any time.
- `/recap` does not reset the day. It reads the server’s copy of today (not the app’s), so it can say 0 after a restart until the app re-syncs on open. In a group it DMs the full recap to whoever asked (personal notes never post in a group); in 1:1 it replies there. If the bot can't DM someone (they never tapped /start in 1:1), it says so in the group.
- Owner-only, not in the menu: `/recap` (1:1 or group DM, owner only), `/edit_about` (1:1 only), `/cancel`.

## 6. Common gotchas
- **Mini App won't open:** URL must be HTTPS and return 200. Check BotFather Menu Button URL matches `MINI_APP_URL` exactly, no trailing slash mismatch.
- **“Bot blocked” / 403 on recap:** user blocked the bot. They need to /start again.
- **Wrong reset time:** almost always timezone. The app’s day ends at 03:00 in the timezone it detected (or stored). Check the app’s stored timezone.
- **Notes missing from /recap:** the press saved to CloudStorage but the sync POST failed (server down / initData invalid), or the server restarted since. Check server logs for `/api/sync`. The CloudStorage copy is the fallback — the app’s “Send today’s recap to chat” button sends the app’s own list, so it works even when the server copy is empty.
- **Bot deaf after a deploy:** during a Render swap the old and new instances can both try to poll at once; Telegram answers 409 and the new instance gives up. `bot.launch()` now retries (up to 6 attempts, 10s apart). If it still doesn’t answer, Restart Service in Render.
- **CloudStorage 4096-char limit:** notes are chunked in `app.js`. Don't store the whole day in one key.
- **Telegram message limit:** recap >4096 chars is split into 2 messages in `server.js`.
- **Server's today is ephemeral:** a Render restart or redeploy wipes `u.today` (it is never saved to `data.json`); the app re-syncs on open, so the app is the source of truth. If `/recap` says 0 but the app shows thanks, reopen the app and try `/recap` again.
- **Presses across 03:00:** the app rolls over on press and on return (`rolloverIfNeeded` in `app.js`), rescuing post-03:00 presses stored under yesterday's date by their note times. A sync dated before the current day is ignored by the server.

## 7. What to do next after MVP works
1. Move the ephemeral store to Cloudflare KV / Upstash with TTL.
2. Switch polling → webhook.
3. Finish the garden (un-blur the tab, bring back `/garden`).
4. Write your About / Bulletin Board text in public/content/about.md — as much as you like.
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
