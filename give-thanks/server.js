// Give Thanks — server.js
// Express (serves Mini App) + Telegraf bot. MVP, single file.
// v1: NO scheduler — no 19:30 nudge, no 03:00 recap message. The day still
// ends at 03:00 (the counter resets then; night owls can review the list
// before bed). The recap is on demand: the app sends it to the 1:1 chat
// via POST /api/recap, or the owner can run /recap.
// Privacy: today's notes live in memory only; the archive is the Telegram
// chat (via the recap button). Settings persist in data.json.
// Timezone is per-user, auto-detected from the device.
// Upgrades: see UPGRADES.md — all data is versioned, migrated on read via lib/migrations.js,
// new features are behind flags in lib/features.js. Never delete unknown fields.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { CURRENT_VERSION, migrateUser, FIXED_RESET_HOUR, FIXED_RESET_MINUTE, FIXED_NOTIFY_HOUR, FIXED_NOTIFY_MINUTE } = require('./lib/migrations');
const { isEnabled } = require('./lib/features');

// ---- env (no dotenv dependency, tiny parser) ----
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MINI_APP_URL = (process.env.MINI_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const PORT = parseInt(process.env.PORT || '3000', 10);
// v1: no scheduled messages. The day ends at 03:00 (the counter resets
// then); the recap is on demand (app button / owner-only /recap).
// No hour settings. Timezone is still per-user, auto-detected.
if (!BOT_TOKEN) console.warn('[give-thanks] WARNING: BOT_TOKEN not set. Copy .env.example to .env first.');

// ---- ephemeral store ----
// users: Map<userId, { chatId, timezone, notificationsOn, notifyOnlyIfEmpty, gardenOptIn, groupGardens:Set, today:{date,count,notes[]}, lastRecap, lastNotifyDate, lastRecapDate, blocked }>
// (lastRecap / lastNotifyDate / lastRecapDate are dormant leftovers from the
// removed scheduler — kept in the record so old data still migrates cleanly.)
const DATA_FILE = path.join(__dirname, 'data.json');
const users = new Map();
const gardens = new Map(); // groupId -> { title, members:Set, countToday, date }

function defaultUser(chatId) {
  return {
    version: CURRENT_VERSION, chatId, timezone: 'Asia/Singapore',
    notificationsOn: true, notifyOnlyIfEmpty: true,
    gardenOptIn: false, groupGardens: [], features: { gardenWeeklyShare: false, newRecapFormat: false, shareOutsideTelegram: true },
    today: { version: CURRENT_VERSION, date: localDateStr(new Date(), 'Asia/Singapore'), count: 0, notes: [] },
    lastRecap: null,
    lastNotifyDate: '', lastRecapDate: '', blocked: false,
  };
}
function getUser(id, chatId) {
  // Recaps and nudges must ONLY ever go to the user's private 1:1 chat.
  // A private chat's id IS the user id (positive); group ids are negative.
  // BUG (2026-11-17): this used to save wherever the last command came
  // from, so dab's /today in the group at 02:56 overwrote their 1:1 chat
  // with the group id, and the 03:00 recap — personal notes included —
  // went to the group instead of 1:1. Never again: chatId is always the
  // user id, and any old record holding a group id is healed here.
  if (!users.has(id)) users.set(id, defaultUser(id));
  else users.set(id, migrateUser(users.get(id))); // migrate on read — v1 data keeps working in v2
  const u = users.get(id);
  if (u.chatId !== id) u.chatId = id;
  return u;
}
function saveSettings() {
  try {
    const out = {};
    for (const [id, u] of users) {
      // Preserve unknown fields by spreading the migrated user, then picking durable fields.
      // Today's notes are ephemeral and are NOT saved to data.json.
      out[id] = { ...u, version: CURRENT_VERSION, today: undefined };
      delete out[id].today;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
  } catch (e) { console.error('saveSettings', e.message); }
}
function loadSettings() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const [id, s] of Object.entries(raw)) {
      // v1 records have no version — migrateUser() fills defaults and keeps unknown fields.
      const u = migrateUser({ ...defaultUser(s.chatId), ...s });
      u.today = { version: CURRENT_VERSION, date: localDateStr(new Date(), u.timezone), count: 0, notes: [] };
      // Heal records saved before the 2026-11-17 fix that hold a group id
      // as chatId (recaps must only go to the private 1:1 chat = user id).
      const uid = Number(id) || id;
      if (u.chatId !== uid) u.chatId = uid;
      users.set(uid, u);
    }
  } catch (e) { console.error('loadSettings', e.message); }
}
loadSettings();

// ---- time helpers (user-local) ----
function localParts(now, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return { hour: parseInt(parts.hour, 10) % 24, minute: parseInt(parts.minute, 10), date: `${parts.year}-${parts.month}-${parts.day}` };
}
function localDateStr(now, tz) { return localParts(now, tz).date; }
// The app's day (see public/app.js todayKey): the day ends at 03:00, so
// before 03:00 the current day is still yesterday's calendar date.
function serverDayStr(now, tz) {
  const parts = localParts(now, tz);
  if (parseInt(parts.hour, 10) < FIXED_RESET_HOUR) {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return localDateStr(y, tz);
  }
  return parts.date;
}

// ---- Telegram initData validation ----
function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const pairs = [];
    for (const [k, v] of [...params.entries()].sort()) pairs.push(`${k}=${v}`);
    const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    if (hmac !== hash) return null;
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return null;
    return user;
  } catch { return null; }
}

// ---- recap ----
function formatRecap(user, dateLabel) {
  const n = user.today.notes || [];
  // v2 opt-in format lives behind a flag — default is the exact v1 format, so existing users see no change.
  if (isEnabled(user, 'newRecapFormat')) {
    const lines = [`🌱 Give Thanks — ${dateLabel}`, ``, `${user.today.count} thanks today.`, ``];
    n.forEach((note, i) => lines.push(`• ${note.text}`));
    return lines.join('\n');
  }
  if (!user.today.count && n.length === 0) {
    return `🌱 Give Thanks — ${dateLabel}\n\nNo thanks logged today. That's okay — fresh start tomorrow.`;
  }
  const lines = [`🌱 Give Thanks — ${dateLabel}`, ``, `You said thanks ${user.today.count} time${user.today.count === 1 ? '' : 's'} today.`, ``];
  n.forEach((note, i) => lines.push(`${i + 1}. ${note.time || ''} — ${note.text}`));
  lines.push(``, `A fresh day starts now. No backlog, no guilt.`);
  return lines.join('\n');
}
function splitMessage(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const out = []; let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + '\n' + line).length > limit) { out.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) out.push(cur);
  return out;
}
// ---- bot ----
const bot = new Telegraf(BOT_TOKEN);
const openKeyboard = () => Markup.inlineKeyboard([[Markup.button.webApp('🌱 Open Give Thanks', MINI_APP_URL)]]);
// ---- Owner-only commands ----
// /recap and /edit_about are for the bot owner only, and hidden from the
// menu (everyone else only sees /start). Admin: set ADMIN_USER_ID in
// .env to your Telegram ID (from @userinfobot). If not set, the first
// person to run an owner command in a 1:1 chat becomes admin.
let adminId = process.env.ADMIN_USER_ID ? String(process.env.ADMIN_USER_ID) : null;
function isAdmin(userId) {
  if (adminId) return String(userId) === adminId;
  return true; // no admin set yet — first editor becomes admin, see below
}
bot.start(async (ctx) => {
  const u = getUser(ctx.from.id, ctx.chat.id);
  u.blocked = false; saveSettings();
  await ctx.reply(
    `Hey, welcome to Give Thanks 🌱\n\nPress the button, say thanks, add a little note if you like.\n\nYour day runs until 3am, so night owls can add thanks and look back over the list before bed — the counter resets at 3am, and we start fresh.\n\nWhenever you want your list saved here, tap “Send today’s recap to chat” in the app — it works any time.\n\nNo streaks. No pressure. Just one quiet habit.`,
    openKeyboard()
  );
});
bot.command('recap', async (ctx) => {
  // Owner-only, hidden from the menu (like /edit_about). The owner keeps
  // it as a quick check of what the server knows; everyone else gets a
  // polite no. If no admin is set yet, the first person to run it in a
  // 1:1 chat becomes admin — same claim rule as /edit_about.
  // NOTE: this reads the server's today, which is ephemeral (a restart
  // wipes it until the app re-syncs on open). The reliable recap is the
  // app's "Send today's recap to chat" button (POST /api/recap), which
  // sends the list the app itself holds.
  if (ctx.chat.type === 'private' && !adminId) { adminId = String(ctx.from.id); console.log(`[give-thanks] Recap admin set to ${adminId}`); }
  if (adminId && String(ctx.from.id) !== adminId) return ctx.reply('That one’s just for the bot owner 🌱');
  const u = getUser(ctx.from.id, ctx.chat.id);
  const text = formatRecap(u, localDateStr(new Date(), u.timezone));
  if (ctx.chat.type === 'private') {
    for (const part of splitMessage(text)) await ctx.reply(part);
    return;
  }
  // Privacy, learned 2026-11-17: a personal recap must never be posted
  // in a group. So in a group this DMs the full recap to whoever asked,
  // and only leaves a short note in the group.
  try {
    for (const part of splitMessage(text)) await bot.telegram.sendMessage(ctx.from.id, part);
    await ctx.reply('Sent your full recap to your 1:1 chat 🌱 — your notes stay private.');
  } catch (e) {
    // 403 = the bot can't DM them yet (they never tapped /start in 1:1).
    await ctx.reply('I couldn’t send it privately — tap /start in a 1:1 chat with me first, then try /recap again.');
  }
});

// ---- Edit About on the fly in Telegram ----
// About text lives in public/content/about.md. /edit_about lets the owner replace it from Telegram.
// Admin: set ADMIN_USER_ID in .env to your Telegram ID (from @userinfobot).
// If not set, the first person to run /edit_about in a 1:1 chat becomes admin for this install.
const ABOUT_FILE = path.join(__dirname, 'public', 'content', 'about.md');
const awaitingAbout = new Map(); // userId -> true
function getAboutText() {
  try { return fs.readFileSync(ABOUT_FILE, 'utf8'); } catch { return '# Bulletin Board\n\nWrite whatever you like here.'; }
}
function setAboutText(text) {
  fs.mkdirSync(path.dirname(ABOUT_FILE), { recursive: true });
  fs.writeFileSync(ABOUT_FILE, text);
}
bot.command('edit_about', async (ctx) => {
  if (ctx.chat.type !== 'private') return ctx.reply('Please send /edit_about in a 1:1 chat with me, not in a group.');
  if (adminId && String(ctx.from.id) !== adminId) return ctx.reply('Only the bot owner can edit the About page.');
  if (!adminId) { adminId = String(ctx.from.id); console.log(`[give-thanks] About admin set to ${adminId}`); }
  awaitingAbout.set(ctx.from.id, true);
  const current = getAboutText();
  await ctx.reply(
    `Okay, send me the new About / Bulletin Board text as your next message.\n\nYou can write as much as you like, with # headings, blank lines between paragraphs, and - bullets.\n\nIt will replace the current page straight away. Send /cancel to stop without changing anything.\n\nCurrent text:\n${current.slice(0, 800)}${current.length > 800 ? '…' : ''}`,
  );
});
bot.command('cancel', async (ctx) => {
  if (awaitingAbout.delete(ctx.from.id)) await ctx.reply('Cancelled — About page unchanged.');
});
bot.on('text', async (ctx, next) => {
  if (!awaitingAbout.has(ctx.from.id)) return next();
  if (ctx.message.text.startsWith('/')) return next();
  awaitingAbout.delete(ctx.from.id);
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the bot owner can edit the About page.');
  const text = ctx.message.text.trim();
  if (text.length < 3) return ctx.reply('That looks too short — send /edit_about again and paste the full text.');
  setAboutText(text);
  await ctx.reply(`Saved 🌱 About page updated.\n\nPreview:\n${text.slice(0, 400)}${text.length > 400 ? '…' : ''}\n\nOpen the Mini App → About to see it live.`);
});
bot.catch((err) => console.error('bot error', err.message));

// ---- express ----
const app = express();
app.use(express.json({ limit: '200kb' }));
// No-store for app assets: the live counter once stayed broken because browsers /
// Telegram WebView kept serving a cached pre-fix app.js after a redeploy.
// (index.html also loads app.js/style.css/themes.js with ?v=20261117j.)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0, etag: false,
  setHeaders(res, filePath) { if (/\.(js|css|html)$/.test(filePath)) res.set('Cache-Control', 'no-store'); },
}));

app.get('/health', (req, res) => res.json({ ok: true, users: users.size }));

// Sync today's snapshot from the Mini App. Validates initData.
app.post('/api/sync', (req, res) => {
  const user = validateInitData(req.body.initData || '');
  // Allow local preview without Telegram (no initData) only when MINI_APP_URL is localhost
  let userId = user?.id;
  if (!userId) {
    if (MINI_APP_URL.includes('localhost')) userId = req.body.userId || 'preview-user';
    else return res.status(401).json({ ok: false, error: 'invalid initData' });
  }
  const u = getUser(userId, userId);
  // apiVersion is accepted but not required: v1 clients send no version, v2 sends 2.
  // Unknown fields are ignored, missing fields keep their current value (backwards compat).
  if (req.body.settings) {
    const s = req.body.settings;
    if (s.timezone) u.timezone = s.timezone;
    // v1: no scheduled messages. The day ends at 03:00 (the app's
    // todayKey); hour settings are ignored.
    if (typeof s.notificationsOn === 'boolean') u.notificationsOn = s.notificationsOn;
    if (typeof s.notifyOnlyIfEmpty === 'boolean') u.notifyOnlyIfEmpty = s.notifyOnlyIfEmpty;
    if (typeof s.gardenOptIn === 'boolean') u.gardenOptIn = s.gardenOptIn;
    if (Array.isArray(s.groupGardens)) u.groupGardens = s.groupGardens;
    if (s.features && typeof s.features === 'object') u.features = { ...u.features, ...s.features };
    u.version = CURRENT_VERSION;
    saveSettings();
  }
  if (req.body.today) {
    const t = req.body.today;
    // The app's day ends at 03:00 (see public/app.js todayKey). A sync
    // dated before the current app-day is stale — e.g. an app left open
    // across 03:00, or a retry arriving after the reset — and must never
    // drag the server's today backwards (2026-11-17: stale syncs hid
    // post-03:00 presses from /recap).
    const currentDay = serverDayStr(new Date(), u.timezone);
    if (String(t.date || '') && String(t.date) < currentDay) {
      console.log('sync ignored stale today', String(t.date), 'current day', currentDay);
    } else {
    u.today = { version: CURRENT_VERSION, date: String(t.date || u.today.date), count: Number(t.count || 0), notes: Array.isArray(t.notes) ? t.notes.slice(0, 200).map(n => ({ text: String(n.text || '').slice(0, 140), time: String(n.time || ''), shareable: typeof n.shareable === 'boolean' ? n.shareable : false })) : [] };
    // garden aggregation, anonymous count only
    if (u.gardenOptIn && req.body.gardenId) {
      const g = gardens.get(String(req.body.gardenId));
      if (g) g.countToday = u.today.count; // MVP: per-garden total is summed on read, see /api/garden
    }
    } // end else (non-stale today)
  }
  res.json({ ok: true, count: u.today.count });
});

// Send today's recap to the 1:1 bot chat, on demand from the Mini App.
// The app is the source of truth (its list lives in CloudStorage), so the
// recap is built from the payload, not from the server's ephemeral today
// (2026-11-17: the server often had 0 even though the app had 3 — a
// restart wipes the server's today, and the app only re-syncs on open).
// Works at any time of day; it does NOT reset the day (03:00 still does).
// Delivery is an outbound API call, so it works even when bot polling is
// down (e.g. after a deploy clash) — only the web server needs to be up.
app.post('/api/recap', async (req, res) => {
  const user = validateInitData(req.body.initData || '');
  let userId = user?.id;
  if (!userId) {
    if (MINI_APP_URL.includes('localhost')) userId = req.body.userId || 'preview-user';
    else return res.status(401).json({ ok: false, error: 'invalid initData' });
  }
  const t = req.body.today || {};
  const count = Number(t.count || 0);
  const notes = Array.isArray(t.notes) ? t.notes.slice(0, 200).map(n => ({ text: String(n.text || '').slice(0, 140), time: String(n.time || '') })) : [];
  const date = String(t.date || localDateStr(new Date(), 'Asia/Singapore'));
  if (!count && !notes.length) return res.json({ ok: false, error: 'nothing to send yet' });
  const text = formatRecap({ today: { count, notes }, features: {} }, date);
  try {
    for (const part of splitMessage(text)) await bot.telegram.sendMessage(userId, part);
    res.json({ ok: true });
  } catch (e) {
    console.error('api/recap send failed', e.message);
    res.status(502).json({ ok: false, error: 'could not send to your chat — open the bot chat and send /start first, then try again' });
  }
});

app.get('/api/state', (req, res) => {
  const user = validateInitData(req.query.initData || '');
  let userId = user?.id;
  if (!userId && MINI_APP_URL.includes('localhost')) userId = req.query.userId || 'preview-user';
  if (!userId) return res.status(401).json({ ok: false, error: 'invalid initData' });
  const u = getUser(userId, userId);
  res.json({ ok: true, settings: { timezone: u.timezone, resetHour: FIXED_RESET_HOUR, resetMinute: FIXED_RESET_MINUTE, notifyHour: FIXED_NOTIFY_HOUR, notifyMinute: FIXED_NOTIFY_MINUTE, notificationsOn: u.notificationsOn, notifyOnlyIfEmpty: u.notifyOnlyIfEmpty, gardenOptIn: u.gardenOptIn, groupGardens: u.groupGardens }, today: u.today });
});

app.get('/api/about', (req, res) => res.json({ ok: true, text: getAboutText() }));
app.post('/api/about', (req, res) => {
  const user = validateInitData(req.body.initData || '');
  if (!user) return res.status(401).json({ ok: false, error: 'invalid initData' });
  if (!isAdmin(user.id)) return res.status(403).json({ ok: false, error: 'only the bot owner can edit About' });
  const text = String(req.body.text || '').trim();
  if (text.length < 3) return res.status(400).json({ ok: false, error: 'text too short' });
  setAboutText(text);
  res.json({ ok: true });
});

app.get('/api/garden', (req, res) => {
  const gid = String(req.query.gardenId || 'personal');
  if (gid === 'personal') {
    let total = 0; for (const u of users.values()) if (u.gardenOptIn) total += u.today.count;
    return res.json({ ok: true, gardenId: gid, countToday: total, flowers: Math.min(total, 200) });
  }
  const g = gardens.get(gid);
  if (!g) return res.json({ ok: true, gardenId: gid, countToday: 0, flowers: 0 });
  return res.json({ ok: true, gardenId: gid, countToday: g.countToday, flowers: Math.min(g.countToday, 200) });
});

// ---- Telegram command menu (what users see when they type /) ----
// Set on every start so it stays in sync with the code — no BotFather
// step needed. v1: only /start is listed. /recap and /edit_about are
// owner-only and deliberately NOT listed: everyone would see them, and
// only the owner can use them.
const BOT_COMMANDS = [
  { command: 'start', description: 'Open Give Thanks and start the habit' },
];

// ---- start ----
app.listen(PORT, () => console.log(`[give-thanks] Mini App at http://localhost:${PORT} — set MINI_APP_URL to your public URL for Telegram`));
if (BOT_TOKEN) bot.telegram.setMyCommands(BOT_COMMANDS).then(() => console.log('[give-thanks] command menu set')).catch(e => console.error('setMyCommands', e.message));
// Launch with retries: during a Render deploy the old instance may still
// be polling when the new one starts, Telegram answers 409, and the new
// instance gives up — the website works but the bot goes deaf (2026-11-17).
// Retrying lets the new instance take over once the old one has shut down.
async function launchBot(attempt = 1) {
  try {
    await bot.launch();
    console.log('[give-thanks] bot polling started');
  } catch (e) {
    console.error(`[give-thanks] bot launch failed (attempt ${attempt}):`, e.message);
    if (attempt < 6) setTimeout(() => launchBot(attempt + 1), 10000);
  }
}
if (BOT_TOKEN) launchBot();
process.once('SIGINT', () => { try { if (BOT_TOKEN) bot.stop('SIGINT'); } catch (e) {} process.exit(0); });
process.once('SIGTERM', () => { try { if (BOT_TOKEN) bot.stop('SIGTERM'); } catch (e) {} process.exit(0); });
