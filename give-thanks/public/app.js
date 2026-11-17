// Give Thanks — Mini App (mockup-matched rebuild)
// DATA_VERSION 5. v1: no scheduled nudge/recap. The day ends at 03:00
// (the counter resets then); the recap is on demand via the app's
// "Send today's recap to chat" button (POST /api/recap) or /recap.
// v5: notes have stable ids; /thanks logged in the bot chat merges into
// the counter on open; group gardens (7-day, one plant per shared thanks).
// CloudStorage first (chunked notes), then POST /api/sync for the server copy.
//
// COUNTER BUG — why it stayed at 0 even after the todayKey fix:
//   press() incremented state, then awaited saveToday(), which awaited csSet().
//   Outside Telegram, telegram-web-app.js still defines tg.CloudStorage, but its
//   getItem/setItem callbacks NEVER fire in a regular browser, so csSet never
//   resolved, saveToday() never reached render(), and the count never appeared.
//   loadToday() at startup hung the same way.
// FIX (this file):
//   1. Listeners are attached FIRST, before any async init.
//   2. press() renders IMMEDIATELY and synchronously, then saves in the background.
//   3. Every CloudStorage call races a 500ms timeout and falls back to localStorage.
//   4. Every init step is individually try/catch'd; a bad load never kills the UI.
const DATA_VERSION = 5;
const FIXED_RESET_HOUR = 3;
const FIXED_NOTIFY_HOUR = 19;
const FIXED_NOTIFY_MINUTE = 30;
const CS_TIMEOUT_MS = 500;

const tg = (typeof window !== 'undefined' && window.Telegram) ? window.Telegram.WebApp : undefined;
try { tg && tg.ready(); tg && tg.expand(); } catch (e) { /* not in Telegram, fine */ }
const cs = tg ? tg.CloudStorage : undefined;

function el(id) { return document.getElementById(id); }
function setText(id, v) { const n = el(id); if (n) n.textContent = v; }
function showError(msg) { setText('syncStatus', msg); }

window.addEventListener('error', (e) => {
  // Visible fallback: the app must never silently die again.
  showError('Something went wrong loading — your thanks are safe, try pressing again.');
  try { render(); } catch (_) {}
});

// ---- migrations (v4, migrate on read, never delete unknown fields) ----
function migrateSettings(raw) {
  const s = { ...(raw || {}) };
  const from = s.version || 1;
  if (from < 2) {
    if (!s.features || typeof s.features !== 'object') s.features = {};
    if (typeof s.features.gardenWeeklyShare !== 'boolean') s.features.gardenWeeklyShare = false;
    if (typeof s.features.newRecapFormat !== 'boolean') s.features.newRecapFormat = false;
  }
  if (from < 3) {
    if (!s.features || typeof s.features !== 'object') s.features = {};
    if (typeof s.features.shareOutsideTelegram !== 'boolean') s.features.shareOutsideTelegram = true;
  }
  if (from < 4) { delete s.resetHour; delete s.notifyHour; }
  s.version = DATA_VERSION;
  if (!s.timezone) s.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore';
  if (typeof s.notificationsOn !== 'boolean') s.notificationsOn = true;
  if (typeof s.notifyOnlyIfEmpty !== 'boolean') s.notifyOnlyIfEmpty = true;
  if (typeof s.gardenOptIn !== 'boolean') s.gardenOptIn = false;
  if (!Array.isArray(s.groupGardens)) s.groupGardens = [];
  return s;
}
function migrateToday(raw) {
  const t = { ...(raw || {}) };
  t.version = DATA_VERSION;
  if (!t.date) t.date = new Date().toISOString().slice(0, 10);
  if (!Number.isInteger(t.count)) t.count = 0;
  if (!Array.isArray(t.notes)) t.notes = [];
  t.notes = t.notes.map(n => ({ text: String(n.text || '').slice(0, 140), time: String(n.time || ''), shareable: typeof n.shareable === 'boolean' ? n.shareable : false, id: String(n.id || stableNoteId(n.text, n.time)), origin: n.origin === 'bot' ? 'bot' : 'app' }));
  return t;
}

// FNV-1a, duplicated from lib/migrations.js (the app can't require server
// code). Keep the two in sync. Used for stable note ids and garden plots.
function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function stableNoteId(text, time) {
  return 'n-' + hashStr(String(text || '') + '|' + String(time || '')).toString(16);
}
function newNoteId() {
  return 'app-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

// ---- dates: day ends at 03:00, not midnight ----
const DEFAULT_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore';
function todayKey(d, tz) {
  d = d || new Date();
  let zone = tz;
  if (!zone) { try { zone = state.settings.timezone; } catch (e) { zone = DEFAULT_TZ; } }
  const fmt = (date, withHour) => new Intl.DateTimeFormat('en-CA', withHour
    ? { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }
    : { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const parts = fmt(d, true);
  const get = (t) => parts.find(p => p.type === t) ? parts.find(p => p.type === t).value : '';
  const hour = parseInt(get('hour'), 10) % 24;
  if (hour < FIXED_RESET_HOUR) {
    // Before 03:00 it is still yesterday's day. Format yesterday directly —
    // never recurse with the same time of day (that loops forever).
    const y = new Date(d); y.setDate(y.getDate() - 1);
    const yp = fmt(y, false);
    const yg = (t) => yp.find(p => p.type === t) ? yp.find(p => p.type === t).value : '';
    return yg('year') + '-' + yg('month') + '-' + yg('day');
  }
  return get('year') + '-' + get('month') + '-' + get('day');
}
// Display dates as DD-MM-YYYY (dab, 2026-11-17). The day key itself
// stays YYYY-MM-DD (it sorts and compares correctly) — only what the
// user sees is reformatted. Anything that isn't YYYY-MM-DD is left alone.
function formatDateDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return m[3] + '-' + m[2] + '-' + m[1];
}
function timeNow() {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: state.settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  catch (e) { return ''; }
}

const state = {
  today: { version: DATA_VERSION, date: todayKey(), count: 0, notes: [] },
  settings: { version: DATA_VERSION, timezone: DEFAULT_TZ, notificationsOn: true, notifyOnlyIfEmpty: true, gardenOptIn: false, groupGardens: [], features: { gardenWeeklyShare: false, newRecapFormat: false, shareOutsideTelegram: true } },
  gardenId: 'personal',
  // Undo history: one entry per press, in press order. true = that press had
  // a note, false = count-only press. Without it, undo can't tell whether
  // the last press was a note (remove it) or a bare press (just -1 count).
  // Saved in gt_today_meta alongside the count; old installs without it
  // rebuild a safe fallback in loadToday() (notes preserved first).
  pressHistory: [],
  // Bot-logged thanks this app has already merged in (their ids), so the
  // next sync can tell the server to drop them from pendingBot. Saved in
  // gt_today_meta; reset on rollover (yesterday's pending entries are gone).
  adoptedBotIds: [],
};
try { state.gardenId = new URLSearchParams(location.search).get('startapp') ? new URLSearchParams(location.search).get('startapp').replace('garden_', '') : 'personal'; } catch (e) {}

// ---- storage: CloudStorage with a 500ms timeout, localStorage fallback ----
// Telegram's CloudStorage callbacks never fire outside the Telegram client,
// so without a timeout every save/load hangs forever and the UI freezes at 0.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('__TIMEOUT__'), ms))]);
}
// ---- Storage: Telegram CloudStorage + localStorage, kept in sync ----
// COUNTER BUG (dab, 2026-11-17: "my counter keeps getting stuck on 75"):
// The app used to write to localStorage (sync) and CloudStorage (async,
// up to 500ms) on every press, with a new save fired on each press — so
// several saves ran at once and their CloudStorage writes finished OUT
// OF ORDER, leaving an old count (75) in CloudStorage after a newer one
// (74) was saved. And csGet read CloudStorage first and used whatever it
// found, even when localStorage held the newer value — or returned null
// when CloudStorage had no key at all, even though localStorage had the
// data (so the app reset to 0 and /thanks looked like it wiped the day).
// Fix, three parts:
//   1. Saves run ONE AT A TIME, in order (a queue), and each writes the
//      CURRENT state, so the last save to finish always has the latest
//      count. No more out-of-order CloudStorage writes.
//   2. The meta carries savedAt. On load, the app reads the meta from
//      BOTH stores and uses the fresher one, then reads the note chunks
//      from that same store — so a stale CloudStorage can never override
//      a newer localStorage, and vice versa.
//   3. Stale note chunks are cleared on save (a shrink used to leave the
//      old chunk behind, so deleted notes came back), and on load the
//      notes are deduped by id and trimmed to the count, which heals
//      storage that already went stale.
// localStorage is the reliable copy on this device (written synchronously,
// always first); CloudStorage is the per-user store that survives a
// reinstall and works across devices.
function localGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function localSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
function cloudGet(key) {
  if (!cs) return Promise.resolve(null);
  const p = new Promise((resolve) => {
    try { cs.getItem(key, (err, v) => resolve(err ? null : v)); }
    catch (e) { resolve(null); }
  });
  return withTimeout(p, CS_TIMEOUT_MS).then((v) => (v === '__TIMEOUT__' ? null : v));
}
function cloudSet(key, val) {
  if (!cs) return Promise.resolve(true);
  const p = new Promise((resolve) => {
    try { cs.setItem(key, val, (err, ok) => resolve(!err && ok)); }
    catch (e) { resolve(false); }
  });
  return withTimeout(p, CS_TIMEOUT_MS).then((v) => v !== '__TIMEOUT__');
}
// Write to both stores, local first (sync, reliable), then CloudStorage.
// Returns true if at least the local write landed.
async function storeSet(key, val) {
  localSet(key, val);
  try { await cloudSet(key, val); } catch (e) {}
  return true;
}
// Read from both stores; CloudStorage first, but fall back to localStorage
// whenever CloudStorage has nothing (not just on a timeout) — a write
// that timed out can leave the key unset there while localStorage has it.
async function csGet(key) {
  const cloud = await cloudGet(key);
  if (cloud !== null && cloud !== undefined) return cloud;
  return localGet(key);
}
function csSet(key, val) {
  // Fire-and-forget for settings/about (the today saver has its own
  // queued path below). Always write localStorage too, so a CloudStorage
  // hang never loses data.
  localSet(key, val);
  return cloudSet(key, val);
}

// ---- About / Bulletin Board ----
const ABOUT_FALLBACK = [
  { t: 'What this is', b: 'A tiny daily habit. Press, notice one good thing, move on.' },
  { t: 'How it works', b: 'Press to count, tag a note if you like. Your day runs until 3am — then the counter resets. Tap “Send today’s recap to chat” any time to save the list in your chat.' },
];
function renderMarkdown(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = ''; let inList = false;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) { if (inList) { html += '</ul>'; inList = false; } html += '<h3>' + esc(line.slice(3)) + '</h3>'; }
    else if (line.startsWith('# ')) { if (inList) { html += '</ul>'; inList = false; } html += '<h2>' + esc(line.slice(2)) + '</h2>'; }
    else if (line.startsWith('- ')) { if (!inList) { html += '<ul>'; inList = true; } html += '<li class="calm">' + esc(line.slice(2)) + '</li>'; }
    else if (line === '' || line === '---') { if (inList) { html += '</ul>'; inList = false; } }
    else { if (inList) { html += '</ul>'; inList = false; } html += '<p class="calm">' + esc(line) + '</p>'; }
  }
  if (inList) html += '</ul>';
  return html;
}
async function loadAbout() {
  const node = el('aboutContent');
  if (!node) return;
  try {
    const res = await fetch('/api/about');
    if (res.ok) { const j = await res.json(); if (j.text) { node.innerHTML = renderMarkdown(j.text); return; } }
  } catch (e) {}
  try {
    const res = await fetch('content/about.md');
    if (!res.ok) throw new Error('no about file');
    node.innerHTML = renderMarkdown(await res.text());
  } catch (e) {
    node.innerHTML = ABOUT_FALLBACK.map(s => '<h3>' + s.t + '</h3><p class="calm">' + s.b + '</p>').join('');
  }
}
function initThemes() {
  const sel = el('themeSelect');
  if (!sel || !window.GiveThanksThemes) return;
  try {
    const saved = (() => { try { return localStorage.getItem('gt_theme'); } catch (e) { return null; } })();
    sel.innerHTML = window.GiveThanksThemes.listThemes().map(t => '<option value="' + t.id + '">' + t.name + '</option>').join('');
    sel.value = saved && window.GiveThanksThemes.THEMES[saved] ? saved : 'cream-forest';
    window.GiveThanksThemes.applyTheme(sel.value);
  } catch (e) {}
}

// ---- load / save (never block the UI, never wipe on error) ----
// Minutes since midnight of a "HH:MM" time (-1 if it has no usable time).
function minutesOf(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return -1;
  return (parseInt(m[1], 10) % 24) * 60 + parseInt(m[2], 10);
}
// The day ends at 03:00. If the app was left open across the boundary,
// state.today still holds yesterday's date — presses after 03:00 would be
// filed under yesterday and the server would drop them. Roll over first,
// rescuing any presses made after 03:00: a note timed between 03:00 and
// right now can only be from the new day (a later time today hasn't
// happened yet, and an earlier one belongs to yesterday's recap). Presses
// are chronological, so bare presses after the first rescued note belong
// to the new day too. Everything else was already in the 03:00 recap, so
// it is dropped, not double-counted.
function rolloverIfNeeded() {
  const today = todayKey();
  if (today === state.today.date) return false;
  const notes = state.today.notes || [];
  const hist = Array.isArray(state.pressHistory) ? state.pressHistory : null;
  const nowMin = minutesOf(timeNow());
  const startMin = FIXED_RESET_HOUR * 60;
  let firstNew = -1;
  for (let i = 0; i < notes.length; i++) {
    const nm = minutesOf(notes[i].time);
    if (nm >= startMin && nm <= nowMin) { firstNew = i; break; }
  }
  if (firstNew === -1) {
    state.today = { version: DATA_VERSION, date: today, count: 0, notes: [] };
    state.pressHistory = [];
    state.adoptedBotIds = [];
  } else {
    const newNotes = notes.slice(firstNew);
    let newHist;
    if (hist) {
      // Walk history, consuming notes in order, until the first rescued
      // note; everything from there on is new-day.
      let seen = 0, cut = hist.length;
      for (let i = 0; i < hist.length; i++) {
        if (hist[i]) { if (seen === firstNew) { cut = i; break; } seen++; }
      }
      newHist = hist.slice(cut);
      if (newHist.length < newNotes.length) newHist = newNotes.map(() => true);
    } else {
      newHist = newNotes.map(() => true);
    }
    state.today = { version: DATA_VERSION, date: today, count: newHist.length, notes: newNotes };
    state.pressHistory = newHist;
    state.adoptedBotIds = [];
  }
  saveTodayBackground();
  syncToServer();
  render();
  return true;
}
async function loadToday() {
  // Snapshot before the first await: the + thanks button is live while
  // this load runs, so a press made during init is a delta to fold on top
  // of the stored count — never wiped by it (dab, 2026-11-17: presses made
  // just after opening the app vanished when the stored count landed).
  const snapCount = state.today.count;
  const snapNotesLen = (state.today.notes || []).length;
  const snapHistLen = Array.isArray(state.pressHistory) ? state.pressHistory.length : 0;
  const snapAdopted = Array.isArray(state.adoptedBotIds) ? state.adoptedBotIds.slice() : [];
  try {
    // Read the meta from BOTH stores and use the fresher one (by savedAt).
    // CloudStorage can hold a stale count after an out-of-order write, and
    // localStorage can hold the newer one — or vice versa. Whichever is
    // newer wins; the note chunks are then read from that same store, so
    // the count and the notes stay consistent with each other.
    const [metaCloud, metaLocal] = await Promise.all([cloudGet('gt_today_meta'), Promise.resolve(localGet('gt_today_meta'))]);
    let meta = null, useCloud = true;
    const parseMeta = (s) => { try { const o = JSON.parse(s); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } };
    const mc = metaCloud ? parseMeta(metaCloud) : null;
    const ml = metaLocal ? parseMeta(metaLocal) : null;
    if (mc && ml) {
      const mcAt = Number(mc.savedAt || 0), mlAt = Number(ml.savedAt || 0);
      // The one saved later wins. On a tie — or when neither has a savedAt
      // (data saved before this fix) — prefer localStorage: every save
      // writes it synchronously first, so on this device it is always at
      // least as fresh as CloudStorage, whose writes can lag or time out.
      if (mcAt !== mlAt) useCloud = mcAt > mlAt;
      else useCloud = false;
      meta = useCloud ? metaCloud : metaLocal;
    }
    else if (mc) { useCloud = true; meta = metaCloud; }
    else if (ml) { useCloud = false; meta = metaLocal; }
    if (meta) {
      try {
        const rawMeta = JSON.parse(meta);
        const m = migrateToday(rawMeta);
        const storedDate = m.date;
        // Presses made while this load was running (snapshot at the top):
        // capture the delta before the stored values overwrite it.
        const deltaCount = state.today.count - snapCount;
        const deltaNotes = (state.today.notes || []).slice(snapNotesLen);
        const deltaHist = (Array.isArray(state.pressHistory) ? state.pressHistory : []).slice(snapHistLen);
        const deltaAdopted = (Array.isArray(state.adoptedBotIds) ? state.adoptedBotIds : []).filter((id) => !snapAdopted.includes(id));
        state.today.count = m.count || 0;
        // Restore undo history if this install saved it; otherwise mark it
        // to be rebuilt from the notes once they finish loading below.
        if (Array.isArray(rawMeta.pressHistory) && rawMeta.pressHistory.every(v => typeof v === 'boolean')) {
          state.pressHistory = rawMeta.pressHistory.slice(0, Math.max(state.today.count, 0));
        } else {
          state.pressHistory = null;
        }
        if (Array.isArray(rawMeta.adoptedBotIds)) state.adoptedBotIds = rawMeta.adoptedBotIds.map(String);
        else state.adoptedBotIds = [];
        state.today.notes = [];
        const readChunk = useCloud ? cloudGet : (k) => Promise.resolve(localGet(k));
        let chunksRead = 0;
        for (let i = 1; i <= 10; i++) {
          const chunk = await readChunk('gt_today_notes_' + i);
          if (!chunk) break;
          chunksRead = i;
          try { state.today.notes.push.apply(state.today.notes, JSON.parse(chunk)); } catch (e) {}
        }
        lastChunkCount = chunksRead;
        // Old installs saved notes without ids — give them stable ones so
        // the merge and the garden can tell notes apart.
        state.today.notes = state.today.notes.map(n => ({ text: String(n.text || '').slice(0, 140), time: String(n.time || ''), shareable: typeof n.shareable === 'boolean' ? n.shareable : false, id: String(n.id || stableNoteId(n.text, n.time)), origin: n.origin === 'bot' ? 'bot' : 'app' }));
        // Heal stale storage: a shrink used to leave an old chunk behind,
        // so deleted notes came back on the next load. Notes are deduped by
        // id, and the list can never hold more notes than presses — trim
        // the extras (they are the stale tail of an old chunk).
        const seenIds = new Set();
        state.today.notes = state.today.notes.filter((n) => { if (seenIds.has(n.id)) return false; seenIds.add(n.id); return true; });
        if (state.today.notes.length > state.today.count) state.today.notes = state.today.notes.slice(0, state.today.count);
        if (state.pressHistory === null) {
          // Old install, no saved history: notes first, count-only presses
          // last, so an undo after reload takes a bare press off before
          // touching a note.
          const bare = Math.max(0, state.today.count - state.today.notes.length);
          state.pressHistory = state.today.notes.map(() => true).concat(Array(bare).fill(false));
        }
        // Fold in presses made while this load was running: they sit on
        // top of the stored count (a press during init adds one; an undo
        // or delete during it takes one off the end). Without this, a
        // fast press just after opening the app was wiped when the stored
        // count landed — the same "counter reverts" the user sees.
        if (deltaCount > 0) {
          state.today.count += deltaCount;
          state.today.notes.push(...deltaNotes);
          state.pressHistory.push(...deltaHist);
          for (const id of deltaAdopted) if (!state.adoptedBotIds.includes(id)) state.adoptedBotIds.push(id);
        } else if (deltaCount < 0) {
          const drop = -deltaCount;
          state.today.count = Math.max(0, state.today.count - drop);
          state.today.notes.splice(Math.max(0, state.today.notes.length - drop), drop);
          state.pressHistory.splice(Math.max(0, state.pressHistory.length - drop), drop);
        }
        if (state.today.notes.length > state.today.count) state.today.notes = state.today.notes.slice(0, state.today.count);
        if (state.pressHistory.length > state.today.count) state.pressHistory = state.pressHistory.slice(0, state.today.count);
        // The stored bucket may be yesterday's (app left open across
        // 03:00). Keep its date, then roll over — rescuing any presses
        // made after 03:00 — instead of wiping them.
        state.today.date = storedDate;
        render();
        rolloverIfNeeded();
        // Merge any /thanks logged in the bot chat, then re-sync: the
        // server's today is ephemeral (a Render restart wipes it), so the
        // app re-sends what it holds. This is what heals the server after
        // a redeploy or a failed sync.
        await fetchServerState();
        syncToServer();
        // If today's data came from localStorage (it was fresher than
        // CloudStorage), push it back to CloudStorage so the two stores
        // agree again — otherwise the stale CloudStorage value lingers.
        if (!useCloud) saveTodayBackground();
        return;
      } catch (e) {
        showError("Couldn't load the new bits, your thanks are safe");
      }
    }
  } catch (e) { /* keep defaults, never crash */ }
  // No stored day (fresh install, or a corrupt meta): start at 0 — unless
  // the user pressed while this load was running, in which case keep those
  // presses instead of wiping them (see the snapshot at the top).
  if (state.today.count === snapCount && (state.today.notes || []).length === snapNotesLen) {
    state.today = { version: DATA_VERSION, date: state.today.date, count: 0, notes: [] };
    state.pressHistory = [];
    state.adoptedBotIds = [];
    lastChunkCount = 0;
  }
  saveTodayBackground();
  render();
  // Even a fresh install may have /thanks waiting on the server (typed in
  // the bot chat before the app was ever opened) — merge them in.
  await fetchServerState();
  syncToServer();
}
// How many note chunks were last written (so a shrink can clear the old
// ones). Reset on load to however many chunks were actually read.
let lastChunkCount = 0;
function saveTodayBackground() {
  // Queued, one save at a time, in order — see the storage comment above.
  // Each save writes the CURRENT state (not a snapshot), so the last save
  // to finish always has the latest count. Fire-and-forget: the UI already
  // updated, and a slow/failed save must never roll back the count.
  saveChain = saveChain.then(() => saveTodayNow()).catch(() => {});
}
let saveChain = Promise.resolve();
async function saveTodayNow() {
  try {
    const chunks = []; let cur = [];
    for (const n of state.today.notes) {
      const test = cur.concat([n]);
      if (JSON.stringify(test).length > 3800) { chunks.push(cur); cur = [n]; } else cur = test;
    }
    if (cur.length) chunks.push(cur);
    await storeSet('gt_today_meta', JSON.stringify({ version: DATA_VERSION, date: state.today.date, count: state.today.count, pressHistory: state.pressHistory, adoptedBotIds: state.adoptedBotIds, chunkCount: chunks.length, savedAt: Date.now() }));
    for (let i = 0; i < Math.max(chunks.length, 1); i++) {
      await storeSet('gt_today_notes_' + (i + 1), JSON.stringify(chunks[i] || []));
    }
    // The notes shrank: clear the old chunks beyond the new count, in both
    // stores, so deleted notes can't come back on the next load.
    for (let i = chunks.length + 1; i <= lastChunkCount; i++) {
      await storeSet('gt_today_notes_' + i, '');
    }
    lastChunkCount = Math.max(chunks.length, 1);
  } catch (e) { /* localStorage already has it; keep going */ }
}
async function loadSettings() {
  try {
    const raw = await csGet('gt_settings');
    if (raw) { try { Object.assign(state.settings, migrateSettings(JSON.parse(raw))); } catch (e) {} }
  } catch (e) {}
  const tzSel = el('timezone');
  if (tzSel) {
    const zones = ['Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Tokyo', 'Asia/Jakarta', 'Australia/Sydney', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'];
    if (zones.indexOf(state.settings.timezone) === -1) zones.unshift(state.settings.timezone);
    tzSel.innerHTML = zones.map(z => '<option' + (z === state.settings.timezone ? ' selected' : '') + '>' + z + '</option>').join('');
  }
  const tzLabel = el('tzLabel'); if (tzLabel) tzLabel.textContent = state.settings.timezone;
  const nOn = el('notificationsOn'); if (nOn) nOn.checked = state.settings.notificationsOn;
  const nEmpty = el('notifyOnlyIfEmpty'); if (nEmpty) nEmpty.checked = state.settings.notifyOnlyIfEmpty;
  render();
}
async function saveSettings() {
  try { await csSet('gt_settings', JSON.stringify(state.settings)); } catch (e) {}
  syncToServer();
}

// ---- Send today's recap to the 1:1 bot chat, on demand, at any time ----
// The app is the source of truth (its list lives in CloudStorage), so the
// recap is built here and posted to /api/recap — the server just delivers
// it. It does NOT reset the day; 03:00 still does that.
let recapSending = false;
async function sendRecapToChat() {
  const status = el('recapStatus');
  const btn = el('sendRecapBtn');
  const setStatus = (t) => { if (status) status.textContent = t; };
  if (recapSending) return;
  if (!tg || !tg.initData) { setStatus('Open this in Telegram to send the recap to your chat.'); return; }
  if (!state.today.count && !state.today.notes.length) { setStatus('Nothing to send yet — press + thanks first.'); return; }
  recapSending = true;
  if (btn) btn.disabled = true;
  setStatus('Sending…');
  try {
    const ctrl = new AbortController();
    // 90s, like sync: sending wakes a sleeping Render (~60s) and the
    // message still goes out — delivery is an outbound API call, so it
    // works even when bot polling is down after a deploy.
    setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 90000);
    const res = await fetch('/api/recap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ initData: tg.initData, today: state.today }),
    });
    if (res.ok) {
      setStatus('Sent to your chat 🌱');
    } else {
      let msg = 'Couldn’t send — try again in a bit.';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      setStatus(msg);
    }
  } catch (e) {
    setStatus('Couldn’t reach the server — try again in a bit.');
  } finally {
    recapSending = false;
    if (btn) btn.disabled = false;
  }
}

// ---- Merge bot-logged thanks (/thanks) into the app's counter (v5) ----
// The bot holds thanks typed in the 1:1 chat until the app opens. On
// open, /api/state returns them as pendingBot; each one joins the local
// counter (note -> notes + pressHistory true; bare -> pressHistory false)
// and its id goes into adoptedBotIds, so the next sync tells the server
// to drop it from pending. No double-counting, and a bot note deleted
// in the app never comes back.
async function fetchServerState() {
  if (!tg || !tg.initData) return;
  try {
    const ctrl = new AbortController();
    setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 90000);
    const res = await fetch('/api/state?initData=' + encodeURIComponent(tg.initData), { signal: ctrl.signal });
    if (!res.ok) return;
    const j = await res.json();
    const pending = Array.isArray(j.pendingBot) ? j.pendingBot : [];
    if (!pending.length) return;
    let changed = false;
    for (const e of pending) {
      if (!e || !e.id) continue;
      if (state.adoptedBotIds.includes(String(e.id))) continue;
      // Every press is a list item now (dab, 2026-11-17) — a bare bot
      // thanks (no text) becomes an empty note the user can edit later,
      // just like a bare press in the app.
      state.today.notes.push({ text: e.text ? String(e.text).slice(0, 140) : '', time: String(e.time || ''), shareable: false, id: String(e.id), origin: 'bot' });
      state.pressHistory.push(true);
      state.today.count += 1;
      state.adoptedBotIds.push(String(e.id));
      changed = true;
    }
    if (changed) { saveTodayBackground(); render(); }
  } catch (e) { /* offline — the /recap nudge covers it; merge on next open */ }
}

// ---- sync to server (background only, 5s timeout, never blocks UI) ----
function syncToServer() {
  try {
    const ctrl = new AbortController();
    // 90s, not 5s: a sync that wakes a sleeping Render takes ~60s, and
    // aborting it loses the sync (2026-11-17: presses after 03:00 never
    // reached the server). Background only, never blocks the UI.
    setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 90000);
    fetch('/api/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ apiVersion: DATA_VERSION, initData: (tg && tg.initData) || '', today: state.today, settings: state.settings, gardenId: state.gardenId, mergedBotIds: state.adoptedBotIds }),
    }).then((res) => { if (res.ok) setText('syncStatus', 'Saved ✓ synced for recap'); else setText('syncStatus', 'Saved on this device — will sync when online'); })
      .catch(() => setText('syncStatus', 'Saved on this device — will sync when online'));
  } catch (e) { setText('syncStatus', 'Saved on this device — will sync when online'); }
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch (e) {}
}

// ---- UI ----
const PLANTS = ['🌱', '🌿', '🌷', '🌻', '🌳'];
// ---- loading cover: plant grows while the app starts, fades once loaded ----
// Shown from first paint (it is plain HTML). Hidden when init finishes,
// with a 4s safety net so a hung load can never trap the user on it.
const bootStartedAt = Date.now();
let loadingTimer = null;
let loadingHidden = false;
function hideLoading() {
  if (loadingHidden) return;
  loadingHidden = true;
  const cover = el('loadingCover');
  if (!cover) { if (loadingTimer) { clearInterval(loadingTimer); loadingTimer = null; } return; }
  // Let it show at least briefly, so it never just flickers. The plant
  // keeps growing until the cover is actually gone, not just until init
  // finishes (fast loads would otherwise freeze it on 🌱).
  const wait = Math.max(0, 700 - (Date.now() - bootStartedAt));
  setTimeout(() => {
    cover.classList.add('hidden');
    setTimeout(() => {
      if (loadingTimer) { clearInterval(loadingTimer); loadingTimer = null; }
      if (cover.parentNode) cover.parentNode.removeChild(cover);
    }, 600);
  }, wait);
}
(function startLoadingPlant() {
  const node = el('loadingPlant');
  if (!node) return;
  let li = 0;
  loadingTimer = setInterval(() => { li = (li + 1) % PLANTS.length; node.textContent = PLANTS[li]; }, 450);
})();
setTimeout(hideLoading, 4000);
const STAGES = ['JUST SPROUTED', 'GROWING', 'NICE PATCH', 'BLOOMING', 'FULL GARDEN'];
function plantIndex(count) { return Math.min(Math.floor(count / 3), PLANTS.length - 1); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function render() {
  try {
    setText('todayDate', formatDateDisplay(state.today.date));
    setText('count', String(state.today.count));
    setText('countLabel', state.today.count === 1 ? 'thank today' : 'thanks today');
    setText('plant', PLANTS[plantIndex(state.today.count)]);
    setText('plantStage', STAGES[plantIndex(state.today.count)] + ' • ' + state.today.count + ' thanks today');
    const list = el('notesList');
    // While a note is being edited inline, the list is left alone, so the
    // text the user is typing is never wiped out by a re-render. The edit
    // input is built by notesListHtml() when editingIdx is set.
    if (list && editingIdx < 0) {
      list.innerHTML = notesListHtml();
    }
    const undoBtn = el('undoBtn');
    if (undoBtn) undoBtn.style.display = state.today.count > 0 ? '' : 'none';
    renderGardenTab();
    renderSharePreview();
  } catch (e) { showError('Something went wrong showing your thanks — try pressing again.'); }
}

// ---- Group garden (v5, daily in v5.1) ----
// A plot of land, one plant per shared thanks. It resets every day at
// 03:00 with the counter (dab, 2026-11-17) — a fresh garden each morning,
// no lost week of plants when the server restarts.
// Tap a plant to read its note in a bubble (with a haptic pop).
// Each member picks one of 10 plant designs to represent themselves.
// Keep the fallback list in sync with lib/plants.js; the server sends
// the real list with the garden data.
const GARDEN_PLANTS_FALLBACK = [
  { id: 'sunflower', emoji: '🌻', name: 'Sunflower' },
  { id: 'tulip', emoji: '🌷', name: 'Tulip' },
  { id: 'rose', emoji: '🌹', name: 'Rose' },
  { id: 'daisy', emoji: '🌼', name: 'Daisy' },
  { id: 'cactus', emoji: '🌵', name: 'Cactus' },
  { id: 'fern', emoji: '🌿', name: 'Fern' },
  { id: 'mushroom', emoji: '🍄', name: 'Mushroom' },
  { id: 'clover', emoji: '🍀', name: 'Clover' },
  { id: 'bamboo', emoji: '🎋', name: 'Bamboo' },
  { id: 'hyacinth', emoji: '🪻', name: 'Hyacinth' },
];
const groupGarden = { title: '', notes: [], myPlant: '', plants: GARDEN_PLANTS_FALLBACK, memberCount: 0, loaded: false, error: '' };

async function loadGarden() {
  // Gardens are group-only (dab, 2026-11-17) — the personal garden was
  // deleted in v5.3. If the app was opened without a garden (menu button),
  // show the user's group gardens — or how to set one up if there are none.
  if (state.gardenId === 'personal') {
    const gardens = Array.isArray(state.settings.groupGardens) ? state.settings.groupGardens.map(String) : [];
    if (gardens.length === 1) {
      // One garden: just open it.
      state.gardenId = gardens[0];
    } else {
      renderGardenTab();
      return;
    }
  }
  if (!tg || !tg.initData) {
    // Opened from a plain link, not as a Mini App — no initData, so the
    // server can't confirm membership. Tell them how to open it properly.
    groupGarden.error = 'Open this garden from the button in your group chat — Telegram needs to confirm you’re a member.';
    groupGarden.loaded = false;
    renderGardenTab();
    return;
  }
  try {
    const res = await fetch('/api/garden?gardenId=' + encodeURIComponent(state.gardenId) + '&initData=' + encodeURIComponent(tg.initData));
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j && j.error) || 'could not load the garden');
    groupGarden.title = j.title || 'Group garden';
    groupGarden.notes = Array.isArray(j.notes) ? j.notes : [];
    groupGarden.myPlant = j.myPlant || '';
    groupGarden.plants = Array.isArray(j.plants) && j.plants.length ? j.plants : GARDEN_PLANTS_FALLBACK;
    groupGarden.memberCount = j.memberCount || 0;
    groupGarden.loaded = true;
    groupGarden.error = '';
    plantStatusMsg = ''; // a fresh load clears any stale pick message
  } catch (e) {
    groupGarden.error = String((e && e.message) || e || 'Couldn’t load the garden — try again in a bit.');
    groupGarden.loaded = false;
  }
  renderGardenTab();
}

function gardenPlantPos(id) {
  // Deterministic position per note id, so the plot doesn't reshuffle on
  // every render. Left 4–88%, top 6–82%, size 26–44px.
  const h = hashStr(id);
  return { left: 4 + (h % 85), top: 6 + (Math.floor(h / 85) % 77), size: 26 + (h % 19) };
}

function renderGardenTab() {
  const group = el('groupGarden');
  const list = el('gardenList');
  const setup = el('gardenSetup');
  if (!group || !list || !setup) return;
  const isGroup = state.gardenId !== 'personal';
  const gardens = Array.isArray(state.settings.groupGardens) ? state.settings.groupGardens : [];
  group.style.display = isGroup ? '' : 'none';
  list.style.display = (!isGroup && gardens.length > 1) ? '' : 'none';
  setup.style.display = (!isGroup && gardens.length === 0) ? '' : 'none';
  if (!isGroup) {
    // No garden open: a list of the user's gardens to open, or the setup
    // line if they have none yet.
    if (gardens.length > 1) {
      list.innerHTML = '<h3>Your group gardens</h3><p class="calm">Tap one to open it.</p>' + gardens.map((gid) => '<button type="button" class="garden-open-btn" data-garden="' + escapeHtml(String(gid)) + '">🌸 Open group garden</button>').join('');
      list.querySelectorAll('[data-garden]').forEach((b) => b.addEventListener('click', () => {
        state.gardenId = b.dataset.garden;
        loadGarden();
      }));
    }
    return;
  }
  setText('groupGardenTitle', groupGarden.title || 'Group garden');
  const status = el('groupGardenStatus');
  if (groupGarden.error) { if (status) status.textContent = groupGarden.error; }
  else if (groupGarden.loaded) { if (status) status.textContent = groupGarden.notes.length + ' shared thanks growing here today · ' + groupGarden.memberCount + ' member' + (groupGarden.memberCount === 1 ? '' : 's'); }
  else if (status) status.textContent = 'Loading the garden…';
  const plot = el('groupGardenPlot');
  if (plot) {
    plot.innerHTML = '';
    if (groupGarden.loaded && !groupGarden.notes.length) {
      plot.innerHTML = '<div class="garden-empty">🌱 Nothing planted yet — tap + thanks in the app and tick share to plant the first one.</div>';
    } else {
      for (const n of groupGarden.notes) {
        const pos = gardenPlantPos(n.id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'garden-plant';
        b.style.left = pos.left + '%';
        b.style.top = pos.top + '%';
        b.style.fontSize = pos.size + 'px';
        b.textContent = n.emoji || '🌱';
        b.setAttribute('aria-label', 'A shared thanks');
        b.addEventListener('click', () => openNoteBubble(n));
        plot.appendChild(b);
      }
    }
  }
  const picker = el('plantPicker');
  if (picker) {
    picker.innerHTML = '';
    for (const p of groupGarden.plants) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plant-pick' + (p.id === groupGarden.myPlant ? ' selected' : '');
      b.textContent = p.emoji;
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.addEventListener('click', () => pickPlant(p.id));
      picker.appendChild(b);
    }
  }
  updatePlantStatus();
}

function openNoteBubble(note) {
  // Haptic pop + a bubble card with the note. Satisfying, like popping a bubble.
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium'); } catch (e) {}
  const bubble = el('noteBubble');
  if (!bubble) return;
  setText('noteBubblePlant', note.emoji || '🌱');
  setText('noteBubbleText', note.text || '');
  setText('noteBubbleMeta', (note.plantName || 'A plant') + (note.date ? ' · ' + formatDateDisplay(note.date) : '') + (note.time ? ' · ' + note.time : ''));
  bubble.classList.add('open');
}

function closeNoteBubble() {
  const bubble = el('noteBubble');
  if (bubble) bubble.classList.remove('open');
}

// The plant status line under the picker: what your plant is, and
// whether a pick saved. A custom message (saving / error) sticks until
// the next successful garden load clears it.
let plantStatusMsg = '';
function plantName(id) {
  const p = (groupGarden.plants || []).find((x) => x.id === id);
  return p ? p.emoji + ' ' + p.name : '';
}
function updatePlantStatus() {
  const node = el('plantStatus');
  if (!node) return;
  node.textContent = plantStatusMsg || (groupGarden.myPlant ? 'Your plant: ' + plantName(groupGarden.myPlant) : '');
}
function setPlantStatus(msg) { plantStatusMsg = msg || ''; updatePlantStatus(); }

async function pickPlant(plantId) {
  if (!tg || !tg.initData) return;
  const prev = groupGarden.myPlant;
  groupGarden.myPlant = plantId;
  renderGardenTab();
  setPlantStatus('Your plant: ' + plantName(plantId) + ' — saving…');
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch (e) {}
  try {
    const res = await fetch('/api/garden/plant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData, gardenId: state.gardenId, plant: plantId }),
    });
    if (!res.ok) throw new Error('could not save');
    setPlantStatus('Your plant: ' + plantName(plantId) + ' 🌱');
    plantStatusMsg = '';
    loadGarden();
  } catch (e) {
    // Revert the optimistic pick and say so — a silent failure is why
    // the picker looked broken (dab, 2026-11-17).
    groupGarden.myPlant = prev;
    renderGardenTab();
    setPlantStatus('Couldn’t save your plant — try again.');
  }
}
function buildShareText() {
  const lines = ['🌱 Give Thanks — ' + formatDateDisplay(state.today.date), '', 'I said thanks ' + state.today.count + ' time' + (state.today.count === 1 ? '' : 's') + ' today.', ''];
  // Notes with no text yet (a bare press) have nothing to share or hide,
  // so they are left out of the list. The count still includes them.
  const noted = state.today.notes.filter((n) => String(n.text || '').trim().length > 0);
  noted.forEach((n, i) => lines.push((i + 1) + '. ' + (n.shareable ? n.text : '••• hidden •••')));
  return lines.join('\n');
}
function renderSharePreview() {
  const node = el('sharePreview');
  if (!node) return;
  const noted = state.today.notes.filter((n) => String(n.text || '').trim().length > 0);
  const shared = noted.filter(n => n.shareable).length;
  node.innerHTML = '<b>Preview — what will go out:</b><br>' + escapeHtml(buildShareText()).replace(/\n/g, '<br>') + '<br><span class="fine">' + shared + ' of ' + noted.length + ' notes shared, ' + (noted.length - shared) + ' blurred out. Unticked notes stay private.</span>';
}
async function shareAsMessage() {
  const text = buildShareText();
  if (navigator.share) { try { await navigator.share({ title: 'Give Thanks', text: text }); return; } catch (e) {} }
  try { await navigator.clipboard.writeText(text); alert('Copied — paste it anywhere (WhatsApp, Instagram, Messages…)'); }
  catch (e) { alert(text); }
}
function drawArtCard() {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const x = c.getContext('2d');
  x.fillStyle = '#FFF6E5'; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = '#2B2B2B'; x.fillRect(0, 0, 1080, 16); x.fillRect(0, 1334, 1080, 16);
  x.fillStyle = '#4A7C59'; x.font = '900 64px monospace'; x.fillText('🌱 GIVE THANKS', 60, 120);
  x.fillStyle = '#2B2B2B'; x.font = '48px monospace'; x.fillText(state.today.date, 60, 190);
  x.font = '900 140px monospace'; x.fillText(String(state.today.count), 60, 340);
  x.font = '40px monospace'; x.fillText('thanks today', 60, 400);
  let y = 480;
  state.today.notes.forEach((n, i) => {
    x.font = '36px monospace'; x.fillStyle = '#2B2B2B';
    if (n.shareable) { x.fillText((i + 1) + '. ' + n.text.slice(0, 38), 60, y); }
    else { x.fillText((i + 1) + '. ', 60, y); x.fillStyle = '#8A8A8A'; x.fillRect(140, y - 28, 700, 36); }
    y += 64;
  });
  x.fillStyle = '#A0522D'; x.font = '32px monospace'; x.fillText('made with Give Thanks', 60, 1260);
  return c;
}
function dataURLToBlob(dataURL) {
  // Synchronous dataURL -> Blob, so navigator.share() can be called in
  // the same tap as the button — no await before it.
  const parts = dataURL.split(',');
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(parts[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
async function shareAsArt() {
  // BUG FOUND 2026-11-17 (dab: "share as art page also fails on mobile"):
  // the old code did `await canvas.toBlob(...)` BEFORE navigator.share().
  // Web Share needs transient user activation — that await lets the tap
  // expire, so share() throws NotAllowedError in Telegram's WebView /
  // iOS WKWebView, and the fallback (an <a download> click on a detached
  // anchor) is ignored there too, so the button silently did nothing.
  // Fix: build the File synchronously from a data URL, call share() in
  // the same tick as the tap, and if sharing is unavailable, show the
  // image in the app itself — long-press to save — instead of failing
  // silently. AbortError (user cancelled the sheet) is not an error.
  const status = el('artStatus');
  const preview = el('artPreview');
  const setArtStatus = (t) => { if (status) status.textContent = t; };
  let file;
  try {
    const canvas = drawArtCard();
    const dataURL = canvas.toDataURL('image/png');
    if (!dataURL || dataURL === 'data:,') throw new Error('empty canvas');
    file = new File([dataURLToBlob(dataURL)], 'give-thanks-' + state.today.date + '.png', { type: 'image/png' });
  } catch (e) {
    setArtStatus('Couldn’t draw the art page — try again.');
    return;
  }
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: 'Give Thanks', files: [file] });
      setArtStatus('Shared 🌱');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user cancelled the sheet
      // fall through to the in-app preview below
    }
  }
  // No working share sheet in this view (Telegram WebView / iOS): show
  // the image here so it can be long-pressed and saved, then shared
  // from Photos. Also try a download link for desktop browsers.
  try {
    const url = URL.createObjectURL(file);
    if (preview) { preview.src = url; preview.style.display = ''; }
    setArtStatus('Sharing isn’t available in this view — long-press the image below to save it, then share it from Photos.');
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (e) {} }, 1000);
  } catch (e) {
    setArtStatus('Couldn’t share the image here — try “Share as message” instead.');
  }
}
// ---- Today's list: every press is an item, and any item's note can be
// edited after the fact (dab, 2026-11-17). A bare press (no note) shows
// as "add a note…" — tap it (or the ✏️) to add the note later. The share
// tick only appears once a note has text (nothing to share before that).
let editingIdx = -1; // index of the note being edited inline, -1 = none
function notesListHtml() {
  return state.today.notes.map((n, i) => {
    const hasText = String(n.text || '').trim().length > 0;
    if (i === editingIdx) {
      return '<li><input type="text" class="note-edit-input" data-edit-input="' + i + '" value="' + escapeHtml(n.text || '') + '" maxlength="140" placeholder="Add a note…"> <span class="fine">Enter to save · Esc to cancel</span></li>';
    }
    const textHtml = hasText
      ? '<span class="' + (n.shareable ? '' : 'private-note') + '">' + escapeHtml(n.text) + '</span>'
      : '<span class="note-empty">add a note…</span>';
    const shareHtml = hasText
      ? '<label class="share-check"><input type="checkbox" data-share="' + i + '"' + (n.shareable ? ' checked' : '') + '> share</label>'
      : '';
    return '<li><button class="delete-note" data-delete="' + i + '" title="Delete this thanks" aria-label="Delete this thanks">×</button><button class="edit-note" data-edit="' + i + '" title="Edit this note" aria-label="Edit this note">✏️</button>' + shareHtml + ' <b>#' + (i + 1) + '</b> ' + escapeHtml(n.time || '') + ' — <span class="note-text" data-edit="' + i + '">' + textHtml + '</span></li>';
  }).reverse().join('');
}
function startNoteEdit(i) {
  if (!Number.isInteger(i) || i < 0 || i >= state.today.notes.length) return;
  editingIdx = i;
  const list = el('notesList');
  if (list) list.innerHTML = notesListHtml();
  const input = list ? list.querySelector('input[data-edit-input]') : null;
  if (input) { input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {} }
}
function saveNoteEdit(i, newText) {
  if (!Number.isInteger(i) || i < 0 || i >= state.today.notes.length) { editingIdx = -1; return; }
  state.today.notes[i].text = String(newText || '').trim().slice(0, 140);
  editingIdx = -1;
  render();
  saveTodayBackground();
  syncToServer();
}
function cancelNoteEdit() {
  editingIdx = -1;
  render();
}
function pressIndexForNote(noteIdx) {
  // The press-history entry for the noteIdx-th note: the (noteIdx+1)-th
  // `true` in pressHistory (bare presses have no note to delete).
  let seen = -1;
  for (let i = 0; i < state.pressHistory.length; i++) {
    if (state.pressHistory[i]) { seen++; if (seen === noteIdx) return i; }
  }
  return -1;
}
function deleteNote(idx) {
  // Delete one specific thanks: remove its note and take 1 off the count.
  // Renders immediately, then saves/syncs in the background, like press().
  editingIdx = -1; // deleting cancels any in-progress note edit
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.today.notes.length) return;
  const pIdx = pressIndexForNote(idx);
  if (pIdx !== -1) state.pressHistory.splice(pIdx, 1);
  state.today.notes.splice(idx, 1);
  state.today.count = Math.max(0, state.today.count - 1);
  render();
  saveTodayBackground();
  syncToServer();
}
function undoLastPress() {
  // Undo the most recent press. If it had a note, that note goes too;
  // if it was a bare press, only the count drops. Works after a reload as
  // well, because pressHistory is saved with the count.
  editingIdx = -1; // undoing cancels any in-progress note edit
  if (state.today.count <= 0 || !state.pressHistory.length) return;
  const hadNote = state.pressHistory.pop();
  if (hadNote) state.today.notes.pop();
  state.today.count = Math.max(0, state.today.count - 1);
  render();
  saveTodayBackground();
  syncToServer();
}
function press(noteText) {
  // Roll over first: a press after 03:00 belongs to the new day even if
  // the app was opened yesterday (2026-11-17: post-03:00 presses filed
  // under yesterday never showed in /recap).
  rolloverIfNeeded();
  editingIdx = -1; // a new press cancels any in-progress note edit
  // Every press is a list item now (dab, 2026-11-17) — even a bare press
  // with no note, so it shows up in Today's list and the note can be
  // added later by editing the item.
  state.pressHistory.push(true);
  state.today.count += 1;
  state.today.notes.push({ text: noteText ? noteText.slice(0, 140) : '', time: timeNow(), shareable: false, id: newNoteId(), origin: 'app' });
  const btn = el('pressBtn');
  if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  render();
  saveTodayBackground();
  syncToServer();
}
function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  const btn = document.querySelector('.tabs button[data-tab="' + name + '"]');
  if (btn) btn.classList.add('active');
  const tab = el('tab-' + name);
  if (tab) tab.classList.add('active');
  closeNoteBubble();
  // Opening the garden refreshes it, so a plant picked or a thanks
  // shared since last time shows up straight away.
  if (name === 'garden') loadGarden();
}

// ---- LISTENERS FIRST: attached before any async init, so a load failure
// can never leave the buttons dead. Every handler is null-guarded. ----
function attachListeners() {
  const pressBtn = el('pressBtn');
  if (pressBtn) pressBtn.addEventListener('click', () => {
    const input = el('noteInput');
    const note = input ? input.value.trim() : '';
    if (input) input.value = '';
    press(note);
  });
  const noteInput = el('noteInput');
  if (noteInput) noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (pressBtn) pressBtn.click(); } });
  const addNoteBtn = el('addNoteBtn');
  if (addNoteBtn) addNoteBtn.addEventListener('click', () => {
    const input = el('noteInput');
    const note = input ? input.value.trim() : '';
    if (!note) return;
    if (input) input.value = '';
    press(note);
  });
  const saveBtn = el('saveSettings');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const tz = el('timezone'); if (tz) state.settings.timezone = tz.value;
    const nOn = el('notificationsOn'); if (nOn) state.settings.notificationsOn = nOn.checked;
    const nEmpty = el('notifyOnlyIfEmpty'); if (nEmpty) state.settings.notifyOnlyIfEmpty = nEmpty.checked;
    await saveSettings();
    try { if (tg && tg.showAlert) tg.showAlert('Settings saved 🌱'); } catch (e) {}
    const tzLabel = el('tzLabel'); if (tzLabel) tzLabel.textContent = state.settings.timezone;
    state.today.date = todayKey(); render();
  });
  const undoBtn = el('undoBtn');
  if (undoBtn) undoBtn.addEventListener('click', undoLastPress);
  // Today's list: one delegated listener on the container, so the buttons
  // keep working even though the list HTML is rebuilt on every render.
  // Handles edit (✏️ / note text), delete (×), share tick, and the inline
  // edit input (Enter saves, Esc cancels, leaving the field saves too).
  const list = el('notesList');
  if (list) {
    list.addEventListener('click', (e) => {
      const editEl = e.target.closest ? e.target.closest('[data-edit]') : null;
      if (editEl) { startNoteEdit(parseInt(editEl.dataset.edit, 10)); return; }
      const delEl = e.target.closest ? e.target.closest('[data-delete]') : null;
      if (delEl) deleteNote(parseInt(delEl.dataset.delete, 10));
    });
    list.addEventListener('change', (e) => {
      const cb = e.target.closest ? e.target.closest('input[data-share]') : null;
      if (!cb) return;
      const idx = parseInt(cb.dataset.share, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= state.today.notes.length) return;
      state.today.notes[idx].shareable = cb.checked;
      saveTodayBackground(); syncToServer(); renderSharePreview();
    });
    list.addEventListener('keydown', (e) => {
      const input = e.target.closest ? e.target.closest('input[data-edit-input]') : null;
      if (!input) return;
      if (e.key === 'Enter') { e.preventDefault(); saveNoteEdit(parseInt(input.dataset.editInput, 10), input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelNoteEdit(); }
    });
    list.addEventListener('focusout', (e) => {
      const input = e.target.closest ? e.target.closest('input[data-edit-input]') : null;
      if (!input) return;
      // Save when the field loses focus (tapping elsewhere, or the app
      // going to background). Guard: if the edit was already saved or
      // cancelled, do nothing.
      if (editingIdx >= 0) saveNoteEdit(parseInt(input.dataset.editInput, 10), input.value);
    });
  }
  const clearBtn = el('clearToday');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    editingIdx = -1; // clearing cancels any in-progress note edit
    state.today = { version: DATA_VERSION, date: state.today.date, count: 0, notes: [] };
    state.pressHistory = [];
    render(); saveTodayBackground(); syncToServer();
  });
  // Coming back to the app after 03:00 should show the new day, not
  // yesterday's count — roll over on return, same as on press.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { rolloverIfNeeded(); } catch (e) {} } });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  const goShare = el('goShareBtn');
  if (goShare) goShare.addEventListener('click', () => { switchTab('share'); renderSharePreview(); });
  const recapBtn = el('sendRecapBtn');
  if (recapBtn) recapBtn.addEventListener('click', sendRecapToChat);
  const shareMsg = el('shareMessageBtn'); if (shareMsg) shareMsg.addEventListener('click', shareAsMessage);
  const shareArt = el('shareArtBtn'); if (shareArt) shareArt.addEventListener('click', shareAsArt);
  const copyShare = el('copyShareBtn');
  if (copyShare) copyShare.addEventListener('click', async () => { try { await navigator.clipboard.writeText(buildShareText()); alert('Copied'); } catch (e) { alert(buildShareText()); } });
  const bubble = el('noteBubble');
  if (bubble) bubble.addEventListener('click', (e) => { if (e.target === bubble) closeNoteBubble(); });
  const bubbleClose = el('noteBubbleClose');
  if (bubbleClose) bubbleClose.addEventListener('click', closeNoteBubble);
}
attachListeners();
render();

// ---- init, each step isolated so one failure never kills the rest ----
(async () => {
  try { initThemes(); } catch (e) {}
  try { await loadAbout(); } catch (e) {}
  try { await loadSettings(); } catch (e) {}
  try { state.today.date = todayKey(); await loadToday(); } catch (e) {}
  try { if (state.gardenId !== 'personal') await loadGarden(); } catch (e) {}
  try { render(); } catch (e) {}
  hideLoading();
})();
