# Give Thanks 🌱

Telegram Bot + Mini App gratitude counter. Press, tag a note, get a daily recap in your bot chat. No long-term database — the recap in Telegram *is* the archive.

Read `SPEC.md` for the full product spec and `HOW_TO_BUILD.md` for setup, BotFather, deploy, and testing.

## Quick start
```bash
cp .env.example .env
# edit .env with your BOT_TOKEN from @BotFather
npm install
npm start
# open http://localhost:3000 in a browser to preview the Mini App UI
# (Telegram itself needs a public HTTPS URL — see HOW_TO_BUILD.md §4)
```

## Files
- `server.js` — Express + Telegraf bot + scheduler (every minute)
- `public/index.html` — Mini App shell
- `public/style.css` — cozy rough pixel art
- `public/app.js` — counter, CloudStorage (chunked, 4096-char values), sync, settings, garden, about

## Privacy model
- Today's count + notes: Telegram CloudStorage (free, 1024 keys, 4096 chars/value) + an ephemeral in-memory copy on the server until recap.
- After the recap is sent at 03:00 your time, today's server copy is deleted.
- History lives only in your Telegram chat.
