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
7. Optional: `/setcommands` and paste:
```
start - Start Give Thanks
open - Open the counter
today - See today's count
settings - Open settings
garden - Create or join a group garden
about - About / Bulletin Board
stop - Pause notifications
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
- Scheduler ticking every 60 seconds, checking the fixed 03:00 / 19:30 times in each user's timezone

Test in Telegram:
- Open your bot, send `/start`, tap “Open Give Thanks”.
- If Telegram says the Mini App URL is not reachable, that's expected on localhost — you need a public URL for Telegram to load it. See §4 for the 2-minute tunnel.

## 3. How the code is organised
```
give-thanks/
  SPEC.md                 Full spec (this project)
  HOW_TO_BUILD.md         This file
  README.md               Quick start for anyone cloning it
  package.json            Node 20, express, telegraf, node-cron
  .env.example            BOT_TOKEN, MINI_APP_URL, PORT
  server.js               Everything: Express + Bot + Scheduler in one file for MVP
  public/
    index.html            Mini App shell, tabs: Counter / Garden / Science / Settings
    style.css             Cozy rough pixel art, cream / forest / burnt orange
    app.js                Counter logic, CloudStorage (chunked), sync to /api/sync,
                          settings, garden view, about content
```

### Key design decisions in code
- **CloudStorage first:** `app.js` saves today to `Telegram.WebApp.CloudStorage` immediately on press, so the counter works even if the server is briefly down. Keys: `gt_today_meta`, `gt_today_notes_1`, `gt_today_notes_2`, `gt_settings`.
- **Sync second:** after saving locally, `app.js` POSTs to `/api/sync` with the press / settings. The server validates Telegram `initData` (HMAC with bot token) before trusting `user_id`.
- **Ephemeral server store:** `server.js` keeps `users` in memory + `data.json` for *settings only*. Today's notes are in memory, keyed by user, and deleted after recap. Restarting the server loses today's unsent notes — that's acceptable for MVP, and the CloudStorage copy means the user still sees their count. For production, swap the in-memory map for Cloudflare KV / Upstash Redis with TTL 36h.
- **Scheduler:** `node-cron` every minute. For each user, compute local time with `Intl.DateTimeFormat(..., { timeZone })`. If local time is 19:30 → notify once. If it is 03:00 → send recap, clear.
- **Group garden:** `server.js` handles `/garden` in groups. Garden ID = group chat_id. Membership is checked with `bot.telegram.getChatMember`. Garden view in the Mini App is a grid of pixel flowers, count only, no names.
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
4. In Settings, set timezone to your zone. Times are fixed (03:00 recap, 19:30 notify), so to test the recap quickly, temporarily change the fixed times in lib/migrations.js, restart, then change them back.
5. Wait → notification arrives (only if you haven't pressed — press once first to test the skip, then test again with a fresh test user / reset).
6. Wait for reset → recap arrives in chat, count goes to 0 on next open.
7. Add bot to a test Telegram group, send `/garden` → bot posts join link, tap it, opt in, press in the Mini App → garden flower count goes up, no name shown.
8. Open Science tab → text reads well, links work.
9. Send `/recap` → full list arrives, unblurred. In a group it arrives by DM, never posted in the group.

### Bot commands (menu)
The command menu is set by `server.js` on startup (`setMyCommands`), so it stays in sync with the code — no BotFather step needed. Type `/` in any chat with the bot to see it.
- `/start` — welcome + Open button. `/open` — open the counter. `/today` — today's count. `/recap` — full instant recap, now. `/garden` — create a group garden (groups only). `/about` — Bulletin Board text. `/settings` — recap 3am / nudge 7:30pm. `/stop` — pause recaps and nudges.
- `/recap` does not reset the day; the 03:00 recap still does that. In a group it DMs the full recap to whoever asked (personal notes never post in a group); in 1:1 it replies there. If the bot can't DM someone (they never tapped /start in 1:1), it says so in the group.
- Owner-only, not in the menu: `/edit_about` (1:1 only), `/cancel`.

## 6. Common gotchas
- **Mini App won't open:** URL must be HTTPS and return 200. Check BotFather Menu Button URL matches `MINI_APP_URL` exactly, no trailing slash mismatch.
- **“Bot blocked” / 403 on recap:** user blocked the bot. Scheduler marks them blocked and stops. They need to /start again.
- **Wrong reset time:** almost always timezone. Check Settings → timezone is e.g. `Asia/Singapore`, not UTC. The scheduler uses that zone.
- **Notes missing from recap:** the press saved to CloudStorage but the sync POST failed (server down / initData invalid). Check server logs for `/api/sync`. The CloudStorage copy is the fallback — the app will offer a “Send recap now” button if it detects a missed reset.
- **CloudStorage 4096-char limit:** notes are chunked in `app.js`. Don't store the whole day in one key.
- **Telegram message limit:** recap >4096 chars is split into 2 messages in `server.js`.

## 7. What to do next after MVP works
1. Move the ephemeral store to Cloudflare KV / Upstash with TTL.
2. Switch polling → webhook.
3. Add weekly anonymous garden share.
4. Write your About / Bulletin Board text in public/content/about.md — as much as you like.
5. Add a “Send recap now” manual button and a missed-day catch-up.
6. Privacy page + delete-my-data (`/delete` wipes settings + today).

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
