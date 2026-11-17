# Give Thanks — Go Live Checklist (do in one sitting, ~15 min)

## What I already did
Code is finished and tested locally in `~/workspace/give-thanks/`:
SPEC.md, HOW_TO_BUILD.md, VISUALS.md, UPGRADES.md, server.js, public/ (Mini App).
Syntax OK, migrations v1→v3 pass, `/health` ok, `/api/sync` v1 payload returns count 3.

## What only you can do (needs your Telegram account)
### 1. Create the bot — 2 min
In Telegram, open @BotFather → `/newbot`
- Name: `Give Thanks`
- Username: pick one ending in `bot`, e.g. `GiveThanksCounterBot`
- Copy the token. Keep it secret — don't paste it in a normal chat message.

### 2. Get a public HTTPS URL — 5 min, free
Option A (test today): `ngrok http 3000` — copy the `https://xxxx.ngrok-free.app` URL.
Option B (proper): Deploy to Render (free tier):
- New Web Service → upload / connect this `give-thanks` folder
- Build: `npm install`, Start: `npm start`
- Env vars: `BOT_TOKEN=<your token>`, `MINI_APP_URL=https://your-app.onrender.com`
- Copy the deployed URL.

### 3. Tell me two things (one message)
- Bot username you picked
- Token — send it via the secure vault link I give you, not in plain chat, OR put it in `.env` yourself if you're deploying it yourself.
- Public URL from step 2.

## What I'll do once you send those (no extra chat needed from you)
1. Set `MINI_APP_URL` in BotFather's Menu Button.
2. Start the bot, test `/start` → open Mini App → press 3x → check the recap arrives at 03:00 your time (or temporarily change the fixed time in lib/migrations.js to 5 min ahead to test it, then change it back).
3. Report back in one message: live or what failed.

## If we run low on chat quota
Fallback, low-chat plan: you deploy with the guide above, I stay out of the loop until you send me “live” or an error screenshot. No visuals rounds, no extra features until after launch.
