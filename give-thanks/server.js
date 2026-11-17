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
// v5 (2026-11-17): /thanks, /share, /garden, /sharerecap, /seegardens;
// group gardens (daily reset, in-memory); note ids + bot/app merge.
// v5.2 (2026-11-17): /send_announcement (owner-only, 1:1 chats only,
// two-step like /edit_about) — the owner can update every user about
// new things. No group posts.
// v5.3 (2026-11-17): bare +thanks presses are list items (editable
// later); plant picker fixed + random fallback plant that sticks;
// personal garden deleted — gardens are group-only. Dates shown as
// DD-MM-YYYY (stored as YYYY-MM-DD).
// v5.4 (2026-11-17): counter fix — saves are queued one at a time (an
// old count overwrote a newer one), the meta carries savedAt and load
// picks the fresher of CloudStorage/localStorage, stale note chunks are
// cleared on save and trimmed on load, and presses made while the app is
// still loading fold on top of the stored count instead of being wiped
// by it. See UPGRADES.md §13.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { CURRENT_VERSION, migrateUser, migrateToday, FIXED_RESET_HOUR, FIXED_RESET_MINUTE, FIXED_NOTIFY_HOUR, FIXED_NOTIFY_MINUTE } = require('./lib/migrations');
const { formatRecap, buildShareText, staleNotice, notSyncedNotice, recapStatus, displayDate } = require('./lib/recap');
const { PLANTS, plantById, randomPlant } = require('./lib/plants');
const { mergeSync } = require('./lib/merge');
const { createGardenStore, getGarden, rolloverGarden, pruneGarden, addGardenNote } = require('./lib/garden');
const { formatAnnouncement, collectRecipients } = require('./lib/announce');

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
// users: Map<userId, { chatId, timezone, notificationsOn, notifyOnlyIfEmpty, gardenOptIn, groupGardens, pendingBot:[{id,text,time}], plantChoices:{gardenId: plantId}, today:{date,count,notes[]}, lastRecap, lastNotifyDate, lastRecapDate, blocked }>
// (lastRecap / lastNotifyDate / lastRecapDate are dormant leftovers from the
// removed scheduler — kept in the record so old data still migrates cleanly.)
const DATA_FILE = path.join(__dirname, 'data.json');
const users = new Map();
// The garden store lives in lib/garden.js (daily reset at 03:00,
// in-memory only — a restart/redeploy empties it and it rebuilds from
// syncs, but since it resets every day anyway, a redeploy just resets it
// early). The user's groupGardens list + plantChoices ARE persisted
// (data.json), so the garden itself is re-discoverable after a restart.
const gardens = createGardenStore();

function defaultUser(chatId) {
  return {
    version: CURRENT_VERSION, chatId, timezone: 'Asia/Singapore',
    notificationsOn: true, notifyOnlyIfEmpty: true,
    gardenOptIn: false, groupGardens: [], features: { gardenWeeklyShare: false, newRecapFormat: false, shareOutsideTelegram: true },
    today: { version: CURRENT_VERSION, date: localDateStr(new Date(), 'Asia/Singapore'), count: 0, notes: [] },
    // v5: bot-logged thanks the app hasn't picked up yet, and the user's
    // chosen plant species per group garden. Both persist in data.json.
    pendingBot: [],
    plantChoices: {},
    // v5.1: the app-day of the last successful /api/sync, in the user's
    // timezone. Lets /recap and /share tell "not synced yet" apart from
    // "genuinely empty". Null = never synced. Persisted in data.json.
    lastSyncDate: null,
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

// ---- garden + merge helpers (v5) ----
function localTimeStr(now, tz) {
  const p = localParts(now, tz);
  return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
}
// The server's today can go stale (no sync since the 03:00 reset). Roll
// it to the current app-day before reading or writing it, and drop any
// pending bot thanks from the old day with it (they belonged to yesterday).
function rolloverUserToday(u) {
  const day = serverDayStr(new Date(), u.timezone);
  if (u.today.date === day) return false;
  u.today = { version: CURRENT_VERSION, date: day, count: 0, notes: [] };
  u.pendingBot = [];
  return true;
}
// When /thanks was logged in the bot chat but the app hasn't picked it
// up yet, /recap and /share read a server copy that may be missing the
// app's latest presses. Say so (dab, 2026-11-17).
function staleSuffix(u, command) {
  if (!u.pendingBot || !u.pendingBot.length) return '';
  return '\n\n' + staleNotice(command);
}
// Only members of a group may see its garden. getChatMember throws when
// the bot isn't in the group or Telegram is unreachable — deny on error.
async function isGroupMember(groupId, userId) {
  try {
    const m = await bot.telegram.getChatMember(String(groupId), userId);
    return m && m.status !== 'left' && m.status !== 'kicked';
  } catch (e) { return false; }
}
// The plant shown for a member's notes: their pick, else a deterministic
// default from their user id (so the garden is varied from the first note).
function plantFor(userId, gardenId) {
  const u = users.get(userId);
  const pick = u && u.plantChoices && u.plantChoices[String(gardenId)];
  const p = plantById(pick);
  if (p) return p;
  // No choice yet: give them a random plant and save it, so it sticks
  // (dab, 2026-11-17: "a default randomized fall back plant"). A fresh
  // random pick on every read would reshuffle the garden each time it
  // loads. If there's no user record to save it on (e.g. after a
  // redeploy wiped data.json), return a random one unsaved — it settles
  // once they sync and get a record again.
  const random = randomPlant();
  if (u) {
    if (!u.plantChoices || typeof u.plantChoices !== 'object') u.plantChoices = {};
    u.plantChoices[String(gardenId)] = random.id;
    saveSettings();
  }
  return random;
}

// ---- Telegram initData validation ----
// BUG FOUND 2026-11-17 (dab reported "invalid initData" on the recap
// button, and /api/sync had silently 401'd all along — which is why the
// server never learned the app's thanks and /recap kept saying 0):
// the secret was SHA256(BOT_TOKEN). That is the Telegram *Login widget*
// scheme. For WebApp / Mini App initData the secret is
//   HMAC-SHA256(key="WebAppData", message=BOT_TOKEN)
// per core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// and docs.telegram-mini-apps.com/platform/init-data. Verified against
// Telegram's own test vector (token 5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8,
// initData hash c501b71e…): old code produced 20ab0e87…, new code produces
// c501b71e… exactly, and secret hex a5c609aa… exactly.
// Only `hash` is excluded from the data-check-string; `signature` (Bot API
// 8.0, for third-party Ed25519 checks) stays in, like any other field.
// No auth_date expiry check: dab leaves the app open overnight, and a
// stale-but-genuine launch must still be able to send its recap.
function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const pairs = [];
    for (const [k, v] of [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) pairs.push(`${k}=${v}`);
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    if (hmac.length !== hash.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(hash, 'utf8'))) return null;
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return null;
    return user;
  } catch { return null; }
}

// ---- recap text lives in lib/recap.js (tested, not just eyeballed) ----
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
// /edit_about and /send_announcement are for the bot owner only, and
// hidden from the menu. Admin: set ADMIN_USER_ID in .env to your
// Telegram ID (from @userinfobot). If not set, the first person to run an
// owner command in a 1:1 chat becomes admin.
let adminId = process.env.ADMIN_USER_ID ? String(process.env.ADMIN_USER_ID) : null;
function isAdmin(userId) {
  if (adminId) return String(userId) === adminId;
  return true; // no admin set yet — first editor becomes admin, see below
}
bot.start(async (ctx) => {
  const u = getUser(ctx.from.id, ctx.chat.id);
  u.blocked = false; saveSettings();
  await ctx.reply(
    `Hey, welcome to Give Thanks 🌱\n\nPress the button, say thanks, add a little note if you like.\n\nYour day runs until 3am, so night owls can add thanks and look back over the list before bed — the counter resets at 3am, and we start fresh.\n\nWhenever you want your list saved here, tap “Send today’s recap to chat” in the app — it works any time.\n\nYou can also just type /thanks followed by a note right here — it counts the same as pressing in the app.\n\nNo streaks. No pressure. Just one quiet habit.`,
    openKeyboard()
  );
});
bot.command('recap', async (ctx) => {
  // Everyone in 1:1 (v5 — no longer owner-only, dab 2026-11-17). Reads the
  // server's today, which is ephemeral: a restart wipes it until the app
  // re-syncs on open. The reliable recap is the app's "Send today's recap
  // to chat" button (POST /api/recap), which sends the list the app holds.
  // If /thanks was logged here but the app hasn't picked it up yet, say so.
  // v5.1: if the app hasn't synced today at all, don't claim the day is
  // empty — say to open the app so it syncs, then ask again.
  const u = getUser(ctx.from.id, ctx.chat.id);
  rolloverUserToday(u);
  const day = localDateStr(new Date(), u.timezone);
  let text;
  if (recapStatus(u, day) === 'not-synced') {
    text = notSyncedNotice('recap');
  } else {
    text = formatRecap(u, day) + staleSuffix(u, 'recap');
  }
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

// ---- /thanks, /share, /garden, /sharerecap, /seegardens (v5) ----
bot.command('thanks', async (ctx) => {
  // Log a thanks with a note, right here in the chat. 1:1 only — in a
  // group the note would be visible to everyone, so it points to 1:1.
  // The thanks lives on the server until the app opens and merges it in
  // (pendingBot); /recap says so until then.
  if (ctx.chat.type !== 'private') return ctx.reply('Please send /thanks in a 1:1 chat with me — your notes stay private there.');
  const u = getUser(ctx.from.id, ctx.chat.id);
  rolloverUserToday(u);
  const noteText = (ctx.message.text || '').replace(/^\/thanks(@\w+)?\s*/, '').trim().slice(0, 140);
  const entry = { id: 'bot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), text: noteText || null, time: localTimeStr(new Date(), u.timezone) };
  u.today.count += 1;
  if (noteText) u.today.notes.push({ text: noteText, time: entry.time, shareable: false, id: entry.id, origin: 'bot' });
  u.pendingBot.push(entry);
  // Persist it now, not on the next sync: a /thanks should survive a
  // server restart (data.json survives restarts). A redeploy still wipes
  // data.json, so a /thanks not yet merged can be lost if a redeploy
  // happens before the app opens — redeploy just after 03:00, when
  // yesterday's pending thanks are stale anyway.
  saveSettings();
  await ctx.reply(noteText
    ? `Logged 🌱 — “${noteText}”\nIt’ll show in the app next time you open it.`
    : `Logged 🌱 +1 thanks.\nIt’ll show in the app next time you open it.`);
});

bot.command('share', async (ctx) => {
  // The share-format list, in the chat: ticked notes shown, unticked as
  // "••• hidden •••", total count true. 1:1 only — it's your personal list.
  if (ctx.chat.type !== 'private') return ctx.reply('Please send /share in a 1:1 chat with me — it’s your personal list.');
  const u = getUser(ctx.from.id, ctx.chat.id);
  rolloverUserToday(u);
  const day = localDateStr(new Date(), u.timezone);
  // v5.1: same as /recap — if the app hasn't synced today, say so instead
  // of "nothing to share".
  if (recapStatus(u, day) === 'not-synced') return ctx.reply(notSyncedNotice('share'));
  if (!u.today.count && !u.today.notes.length) return ctx.reply('Nothing to share yet — press + thanks first.');
  const text = buildShareText(u.today, day) + staleSuffix(u, 'share');
  for (const part of splitMessage(text)) await ctx.reply(part);
});

bot.command('garden', async (ctx) => {
  // Welcome everyone to this group's garden (dab, 2026-11-17): one plant
  // per shared thanks, tap a plant to read its note. Group only. The bot
  // replies with a button to open the garden, plus the plain link as a
  // fallback — a bad button URL can fail the whole send silently
  // (2026-11-17), so the link is the safety net. Clicking the link
  // creates the garden for this group (members = only this group's
  // people, checked on every open) and adds it to the opener's 1:1 app.
  if (ctx.chat.type === 'private') return ctx.reply('Run /garden in a group chat to grow a garden with its members.');
  const gid = String(ctx.chat.id);
  const g = getGarden(gardens, gid);
  g.title = ctx.chat.title || 'Group garden';
  g.members.add(ctx.from.id);
  const u = getUser(ctx.from.id, ctx.chat.id);
  if (!u.groupGardens.includes(gid)) { u.groupGardens.push(gid); saveSettings(); }
  const url = MINI_APP_URL + '?startapp=garden_' + gid;
  const text = `🌸 Welcome to the ${g.title} garden!\n\nThis is our group's shared garden. Here's how it grows:\n\n• Press + thanks in the Give Thanks app and tick share on a note — it grows here as a plant.\n• Pick your plant when you open it — that's how the group tells you apart (no names, just plants).\n• Tap any plant to read its thanks.\n• Only people in this group can see it, and it resets every day at 03:00.\n\nThe garden also shows up in your 1:1 Give Thanks app, under the Garden tab — no need to come back to this link.`;
  try {
    await ctx.reply(text, Markup.inlineKeyboard([[Markup.button.webApp('🌱 Open the group garden', url)]]));
  } catch (e) {
    console.error('garden button failed, sending plain link', e.message);
    await ctx.reply(text + '\n\n' + url);
  }
});

// When the bot is added to a group, say hello and point to /garden —
// that's the welcome that starts a group's garden (dab, 2026-11-17).
bot.on('my_chat_member', async (ctx) => {
  try {
    const upd = ctx.update && ctx.update.my_chat_member;
    if (!upd || upd.chat.type === 'private') return;
    const newStatus = upd.new_chat_member && upd.new_chat_member.status;
    if (newStatus !== 'member' && newStatus !== 'administrator') return;
    await ctx.reply('🌱 Hi everyone! I’m Give Thanks — press + thanks in the app, tag a note, and your day grows a little garden.\n\nTo grow a shared garden for this group, type /garden. One plant per shared thanks, tap a plant to read its note, and only this group can see it.');
  } catch (e) { /* a failed hello must never break the bot */ }
});

bot.command('sharerecap', async (ctx) => {
  // The group's shared recap: today's shared thanks, each with the
  // member's plant emoji — no names. Group only.
  if (ctx.chat.type === 'private') return ctx.reply('Run /sharerecap in a group chat to share the group’s thanks.');
  const u = getUser(ctx.from.id, ctx.chat.id);
  const day = serverDayStr(new Date(), u.timezone);
  const g = getGarden(gardens, String(ctx.chat.id));
  // v5.1: the garden is daily — roll it to the asker's day first, so
  // yesterday's plants never show up in today's sharerecap.
  rolloverGarden(g, day);
  pruneGarden(g);
  if (!g.notes.length) return ctx.reply('No shared thanks in this group yet today — tap + thanks in the app and tick share to plant one 🌱');
  const lines = [`🌱 Give Thanks — ${displayDate(day)}`, ``, `${g.notes.length} shared thanks in this group today.`, ``];
  for (const n of g.notes) {
    const p = plantFor(n.userId, String(ctx.chat.id));
    lines.push(`${p.emoji} ${n.text}`);
  }
  for (const part of splitMessage(lines.join('\n'))) await ctx.reply(part);
});

bot.command('seegardens', async (ctx) => {
  // Your gardens, in 1:1: every group garden you're in, with a button
  // to open each. If the buttons fail to send (bad URL fails the whole
  // send, 2026-11-17), fall back to plain links.
  if (ctx.chat.type !== 'private') return ctx.reply('Send /seegardens in a 1:1 chat with me.');
  const u = getUser(ctx.from.id, ctx.chat.id);
  if (!u.groupGardens.length) return ctx.reply('You’re not in any group gardens yet — add me to a group and run /garden there to start one.');
  const lines = ['🌸 Your gardens', ''];
  const buttons = [];
  for (const gid of u.groupGardens) {
    let title = getGarden(gardens, gid).title;
    if (!title) {
      try { const chat = await bot.telegram.getChat(gid); title = chat.title || ('Group ' + gid); } catch (e) { title = 'Group ' + gid; }
    }
    lines.push('• ' + title);
    buttons.push([Markup.button.webApp('🌱 ' + title, MINI_APP_URL + '?startapp=garden_' + gid)]);
  }
  lines.push('', 'Tap one to open it. Only that group’s members can see its garden.');
  try {
    await ctx.reply(lines.join('\n'), Markup.inlineKeyboard(buttons));
  } catch (e) {
    console.error('seegardens buttons failed, sending plain links', e.message);
    const links = u.groupGardens.map((gid) => {
      const title = getGarden(gardens, gid).title || ('Group ' + gid);
      return '• ' + title + '\n' + MINI_APP_URL + '?startapp=garden_' + gid;
    });
    await ctx.reply(['🌸 Your gardens', ''].concat(links).join('\n'));
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
  awaitingAnnouncement.delete(ctx.from.id);
  awaitingAbout.set(ctx.from.id, true);
  const current = getAboutText();
  await ctx.reply(
    `Okay, send me the new About / Bulletin Board text as your next message.\n\nYou can write as much as you like, with # headings, blank lines between paragraphs, and - bullets.\n\nIt will replace the current page straight away. Send /cancel to stop without changing anything.\n\nCurrent text:\n${current.slice(0, 800)}${current.length > 800 ? '…' : ''}`,
  );
});
bot.command('cancel', async (ctx) => {
  if (awaitingAnnouncement.delete(ctx.from.id)) return ctx.reply('Cancelled — no announcement sent.');
  if (awaitingAbout.delete(ctx.from.id)) return ctx.reply('Cancelled — About page unchanged.');
});

// ---- Send an announcement to every user (owner-only, 1:1 chats only) ----
// /send_announcement lets the owner update users about new things
// (dab, 2026-11-17). Two-step, like /edit_about: type the command, then
// send the announcement text as the next message. It goes to every known
// user's 1:1 chat — no group posts, because anyone who uses the bot in a
// group already has a 1:1 chat with it. Hidden from the menu.
const awaitingAnnouncement = new Map(); // userId -> true
bot.command('send_announcement', async (ctx) => {
  if (ctx.chat.type !== 'private') return ctx.reply('Please send /send_announcement in a 1:1 chat with me, not in a group.');
  if (adminId && String(ctx.from.id) !== adminId) return ctx.reply('Only the bot owner can send announcements.');
  if (!adminId) { adminId = String(ctx.from.id); console.log(`[give-thanks] Announcement admin set to ${adminId}`); }
  awaitingAbout.delete(ctx.from.id);
  awaitingAnnouncement.set(ctx.from.id, true);
  await ctx.reply(
    `Okay, send me the announcement text as your next message.\n\nI'll send it to everyone who uses the bot, in their 1:1 chat with me — no group posts. Send /cancel to stop without sending anything.`,
  );
});
bot.on('text', async (ctx, next) => {
  const awaitingA = awaitingAbout.has(ctx.from.id);
  const awaitingN = awaitingAnnouncement.has(ctx.from.id);
  if (!awaitingA && !awaitingN) return next();
  if (ctx.message.text.startsWith('/')) return next();
  if (awaitingA) {
    awaitingAbout.delete(ctx.from.id);
    if (!isAdmin(ctx.from.id)) return ctx.reply('Only the bot owner can edit the About page.');
    const text = ctx.message.text.trim();
    if (text.length < 3) return ctx.reply('That looks too short — send /edit_about again and paste the full text.');
    setAboutText(text);
    await ctx.reply(`Saved 🌱 About page updated.\n\nPreview:\n${text.slice(0, 400)}${text.length > 400 ? '…' : ''}\n\nOpen the Mini App → About to see it live.`);
    return;
  }
  // Announcement: send it to every known user's 1:1 chat.
  awaitingAnnouncement.delete(ctx.from.id);
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the bot owner can send announcements.');
  const text = ctx.message.text.trim();
  if (text.length < 3) return ctx.reply('That looks too short — send /send_announcement again and paste the full text.');
  const announcement = formatAnnouncement(text);
  const recipients = collectRecipients(users);
  let sent = 0, failed = 0;
  for (const chatId of recipients) {
    try { await bot.telegram.sendMessage(chatId, announcement); sent += 1; }
    catch (e) { failed += 1; console.log('announcement failed for', chatId, e.message); }
  }
  await ctx.reply(`Sent 🌱 ${sent} chat${sent === 1 ? '' : 's'} got the announcement.${failed ? ` ${failed} couldn't be reached (they may have blocked the bot).` : ''}`);
});
bot.catch((err) => console.error('bot error', err.message));

// ---- express ----
const app = express();
app.use(express.json({ limit: '200kb' }));
// No-store for app assets: the live counter once stayed broken because browsers /
// Telegram WebView kept serving a cached pre-fix app.js after a redeploy.
// (index.html also loads app.js/style.css/themes.js with ?v=20261117q.)
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
  rolloverUserToday(u);
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
      // v5: merge the app snapshot with bot-logged thanks the app hasn't
      // picked up yet (mergeSync — no double-count, deleted stays deleted).
      // Notes keep their ids (assigned deterministically when missing).
      const appToday = migrateToday({ date: String(t.date || u.today.date), count: Number(t.count || 0), notes: Array.isArray(t.notes) ? t.notes : [] });
      const merged = mergeSync(appToday, u.pendingBot, req.body.mergedBotIds);
      u.today = merged.today;
      u.pendingBot = merged.remainingPending;
      // v5.1: the app has today's list now — record the sync day, so
      // /recap and /share can tell "not synced yet" from "genuinely
      // empty". Saved to data.json (survives restarts, not redeploys).
      u.lastSyncDate = u.today.date;
      saveSettings();
      // Garden aggregation: this user's shareable notes join every group
      // garden they're in. The share tick is the opt-in — only ticked
      // notes ever appear in a garden. Deduped by note id; the garden
      // resets every day at 03:00 (v5.1, no 7-day window).
      const gardenIds = new Set();
      if (Array.isArray(u.groupGardens)) for (const gid of u.groupGardens) gardenIds.add(String(gid));
      // 'personal' is not a garden (v5.3 — the personal garden was
      // deleted); only real group ids get notes planted in them.
      if (req.body.gardenId && String(req.body.gardenId) !== 'personal') gardenIds.add(String(req.body.gardenId));
      for (const gid of gardenIds) {
        for (const n of u.today.notes) addGardenNote(gardens, gid, userId, { ...n, date: u.today.date });
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
  rolloverUserToday(u);
  // pendingBot: bot-logged thanks the app hasn't picked up yet, so the
  // app can merge them in on open (v5, /thanks).
  res.json({ ok: true, settings: { timezone: u.timezone, resetHour: FIXED_RESET_HOUR, resetMinute: FIXED_RESET_MINUTE, notifyHour: FIXED_NOTIFY_HOUR, notifyMinute: FIXED_NOTIFY_MINUTE, notificationsOn: u.notificationsOn, notifyOnlyIfEmpty: u.notifyOnlyIfEmpty, gardenOptIn: u.gardenOptIn, groupGardens: u.groupGardens }, today: u.today, pendingBot: u.pendingBot });
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

app.get('/api/garden', async (req, res) => {
  const gid = String(req.query.gardenId || '');
  // Gardens are group-only (dab, 2026-11-17) — the personal garden was
  // deleted in v5.3. A gardenId of 'personal' (or none) is a bad request.
  if (!gid || gid === 'personal') return res.status(400).json({ ok: false, error: 'gardens are for groups — open one from a group chat' });
  // Group garden (v5): only members may see it. Needs real initData (a
  // Mini App launch) — a plain link opened in a browser has none, so it
  // 401s, and the app tells the user to open it from the group's button.
  const user = validateInitData(req.query.initData || '');
  let userId = user?.id;
  if (!userId && MINI_APP_URL.includes('localhost')) userId = req.query.userId || 'preview-user';
  if (!userId) return res.status(401).json({ ok: false, error: 'invalid initData' });
  if (!(await isGroupMember(gid, userId))) return res.status(403).json({ ok: false, error: 'only members of this group can see its garden' });
  const g = getGarden(gardens, gid);
  if (!g.title) {
    try { const chat = await bot.telegram.getChat(gid); g.title = chat.title || ''; } catch (e) {}
  }
  g.members.add(userId);
  const u = getUser(userId, userId);
  if (!u.groupGardens.includes(gid)) { u.groupGardens.push(gid); saveSettings(); }
  // v5.1: the garden is daily — roll it to the reader's day first, so
  // yesterday's plants never show up in today's garden.
  rolloverGarden(g, serverDayStr(new Date(), u.timezone));
  pruneGarden(g);
  const notes = g.notes.map((n) => {
    const p = plantFor(n.userId, gid);
    return { id: n.id, plant: p.id, emoji: p.emoji, plantName: p.name, text: n.text, time: n.time, date: n.date };
  });
  const myPlant = plantFor(userId, gid);
  res.json({ ok: true, gardenId: gid, title: g.title || 'Group garden', memberCount: g.members.size, notes, myPlant: myPlant.id, plants: PLANTS });
});

// Pick your plant for a group garden (v5). One per group, changeable any time.
app.post('/api/garden/plant', async (req, res) => {
  const user = validateInitData(req.body.initData || '');
  let userId = user?.id;
  if (!userId && MINI_APP_URL.includes('localhost')) userId = req.body.userId || 'preview-user';
  if (!userId) return res.status(401).json({ ok: false, error: 'invalid initData' });
  const gid = String(req.body.gardenId || '');
  const plant = plantById(String(req.body.plant || ''));
  if (!gid || gid === 'personal' || !plant) return res.status(400).json({ ok: false, error: 'bad garden or plant' });
  if (!(await isGroupMember(gid, userId))) return res.status(403).json({ ok: false, error: 'only members of this group can see its garden' });
  const u = getUser(userId, userId);
  u.plantChoices[gid] = plant.id;
  saveSettings();
  res.json({ ok: true, plant: plant.id });
});

// ---- Telegram command menus (what users see when they type /) ----
// Set on every start so they stay in sync with the code — no BotFather
// step needed. v5: scoped menus — 1:1 chats get the personal commands,
// groups get the garden ones. /edit_about, /send_announcement and /cancel stay hidden
// (owner-only); everyone would see them otherwise.
const PRIVATE_COMMANDS = [
  { command: 'start', description: 'Open Give Thanks and start the habit' },
  { command: 'recap', description: 'See today’s thanks log' },
  { command: 'thanks', description: 'Log a thanks — whatever you type after it is the note' },
  { command: 'share', description: 'Get today’s shareable list (hidden notes stay hidden)' },
  { command: 'seegardens', description: 'See your group gardens' },
];
const GROUP_COMMANDS = [
  { command: 'garden', description: 'Open this group’s garden' },
  { command: 'sharerecap', description: 'Share today’s shared thanks in this group' },
];

// ---- start ----
app.listen(PORT, () => console.log(`[give-thanks] Mini App at http://localhost:${PORT} — set MINI_APP_URL to your public URL for Telegram`));
if (BOT_TOKEN) {
  bot.telegram.setMyCommands(PRIVATE_COMMANDS, { scope: { type: 'all_private_chats' } }).then(() => console.log('[give-thanks] private command menu set')).catch(e => console.error('setMyCommands private', e.message));
  bot.telegram.setMyCommands(GROUP_COMMANDS, { scope: { type: 'all_group_chats' } }).then(() => console.log('[give-thanks] group command menu set')).catch(e => console.error('setMyCommands group', e.message));
}
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
