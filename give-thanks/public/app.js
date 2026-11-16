// Give Thanks — Mini App (mockup-matched rebuild)
// DATA_VERSION 4. Fixed schedule: recap/reset 03:00, notification 19:30, in your timezone.
// CloudStorage first (chunked notes), then POST /api/sync for scheduler/recap.
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
const DATA_VERSION = 4;
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
  t.notes = t.notes.map(n => ({ text: String(n.text || '').slice(0, 140), time: String(n.time || ''), shareable: typeof n.shareable === 'boolean' ? n.shareable : false }));
  return t;
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
};
try { state.gardenId = new URLSearchParams(location.search).get('startapp') ? new URLSearchParams(location.search).get('startapp').replace('garden_', '') : 'personal'; } catch (e) {}

// ---- storage: CloudStorage with a 500ms timeout, localStorage fallback ----
// Telegram's CloudStorage callbacks never fire outside the Telegram client,
// so without a timeout every save/load hangs forever and the UI freezes at 0.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('__TIMEOUT__'), ms))]);
}
function csGet(key) {
  if (!cs) { try { return Promise.resolve(localStorage.getItem(key)); } catch (e) { return Promise.resolve(null); } }
  const p = new Promise((resolve) => {
    try { cs.getItem(key, (err, v) => resolve(err ? null : v)); }
    catch (e) { resolve(null); }
  });
  return withTimeout(p, CS_TIMEOUT_MS).then((v) => {
    if (v === '__TIMEOUT__') { try { return localStorage.getItem(key); } catch (e) { return null; } }
    return v;
  });
}
function csSet(key, val) {
  // Always write localStorage too, so a CloudStorage hang never loses data.
  try { localStorage.setItem(key, val); } catch (e) {}
  if (!cs) return Promise.resolve(true);
  const p = new Promise((resolve) => {
    try { cs.setItem(key, val, (err, ok) => resolve(!err && ok)); }
    catch (e) { resolve(false); }
  });
  return withTimeout(p, CS_TIMEOUT_MS).then((v) => v !== '__TIMEOUT__');
}

// ---- About / Bulletin Board ----
const ABOUT_FALLBACK = [
  { t: 'What this is', b: 'A tiny daily habit. Press, notice one good thing, move on.' },
  { t: 'How it works', b: 'Press to count, tag a note if you like, get a recap at 3am your time, start fresh.' },
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
async function loadToday() {
  try {
    const meta = await csGet('gt_today_meta');
    if (meta) {
      try {
        const rawMeta = JSON.parse(meta);
        const m = migrateToday(rawMeta);
        if (m.date === state.today.date) {
          state.today.count = m.count || 0;
          // Restore undo history if this install saved it; otherwise mark it
          // to be rebuilt from the notes once they finish loading below.
          if (Array.isArray(rawMeta.pressHistory) && rawMeta.pressHistory.every(v => typeof v === 'boolean')) {
            state.pressHistory = rawMeta.pressHistory.slice(0, Math.max(state.today.count, 0));
          } else {
            state.pressHistory = null;
          }
          state.today.notes = [];
          for (let i = 1; i <= 10; i++) {
            const chunk = await csGet('gt_today_notes_' + i);
            if (!chunk) break;
            try { state.today.notes.push.apply(state.today.notes, JSON.parse(chunk)); } catch (e) {}
          }
          if (state.pressHistory === null) {
            // Old install, no saved history: notes first, count-only presses
            // last, so an undo after reload takes a bare press off before
            // touching a note.
            const bare = Math.max(0, state.today.count - state.today.notes.length);
            state.pressHistory = state.today.notes.map(() => true).concat(Array(bare).fill(false));
          }
          render(); return;
        }
      } catch (e) {
        showError("Couldn't load the new bits, your thanks are safe");
      }
    }
  } catch (e) { /* keep defaults, never crash */ }
  state.today = { version: DATA_VERSION, date: state.today.date, count: 0, notes: [] };
  state.pressHistory = [];
  saveTodayBackground();
  render();
}
function saveTodayBackground() {
  // Fire-and-forget: the UI already updated. A slow/failed save must never
  // roll back or hide the count.
  (async () => {
    try {
      await csSet('gt_today_meta', JSON.stringify({ version: DATA_VERSION, date: state.today.date, count: state.today.count, pressHistory: state.pressHistory }));
      const chunks = []; let cur = [];
      for (const n of state.today.notes) {
        const test = cur.concat([n]);
        if (JSON.stringify(test).length > 3800) { chunks.push(cur); cur = [n]; } else cur = test;
      }
      if (cur.length) chunks.push(cur);
      for (let i = 0; i < Math.max(chunks.length, 1); i++) {
        await csSet('gt_today_notes_' + (i + 1), JSON.stringify(chunks[i] || []));
      }
    } catch (e) { /* localStorage already has it; keep going */ }
  })();
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
  const gOpt = el('gardenOptIn'); if (gOpt) gOpt.checked = state.settings.gardenOptIn;
  render();
}
async function saveSettings() {
  try { await csSet('gt_settings', JSON.stringify(state.settings)); } catch (e) {}
  syncToServer();
}

// ---- sync to server (background only, 5s timeout, never blocks UI) ----
function syncToServer() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 5000);
    fetch('/api/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ apiVersion: DATA_VERSION, initData: (tg && tg.initData) || '', today: state.today, settings: state.settings, gardenId: state.gardenId }),
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
    setText('todayDate', state.today.date);
    setText('count', String(state.today.count));
    setText('countLabel', state.today.count === 1 ? 'thank today' : 'thanks today');
    setText('plant', PLANTS[plantIndex(state.today.count)]);
    setText('plantStage', STAGES[plantIndex(state.today.count)] + ' • ' + state.today.count + ' thanks today');
    const list = el('notesList');
    if (list) {
      list.innerHTML = state.today.notes.map((n, i) => '<li><button class="delete-note" data-delete="' + i + '" title="Delete this thanks" aria-label="Delete this thanks">×</button><label class="share-check"><input type="checkbox" data-share="' + i + '"' + (n.shareable ? ' checked' : '') + '> share</label> <b>#' + (i + 1) + '</b> ' + escapeHtml(n.time || '') + ' — <span class="' + (n.shareable ? '' : 'private-note') + '">' + escapeHtml(n.text) + '</span></li>').reverse().join('');
      list.querySelectorAll('input[data-share]').forEach(cb => cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.share, 10);
        state.today.notes[idx].shareable = e.target.checked;
        saveTodayBackground(); syncToServer(); renderSharePreview();
      }));
      list.querySelectorAll('button[data-delete]').forEach(btn => btn.addEventListener('click', (e) => {
        deleteNote(parseInt(e.currentTarget.dataset.delete, 10));
      }));
    }
    const undoBtn = el('undoBtn');
    if (undoBtn) undoBtn.style.display = state.today.count > 0 ? '' : 'none';
    setText('gardenCount', state.today.count + ' flowers bloomed today (personal view)');
    const field = el('gardenField');
    if (field) field.textContent = state.today.count ? '🌸 '.repeat(Math.min(state.today.count, 30)) : '🌱 Your garden is waiting for its first thanks today.';
    renderSharePreview();
  } catch (e) { showError('Something went wrong showing your thanks — try pressing again.'); }
}
function buildShareText() {
  const lines = ['🌱 Give Thanks — ' + state.today.date, '', 'I said thanks ' + state.today.count + ' time' + (state.today.count === 1 ? '' : 's') + ' today.', ''];
  state.today.notes.forEach((n, i) => lines.push((i + 1) + '. ' + (n.shareable ? n.text : '••• hidden •••')));
  return lines.join('\n');
}
function renderSharePreview() {
  const node = el('sharePreview');
  if (!node) return;
  const shared = state.today.notes.filter(n => n.shareable).length;
  node.innerHTML = '<b>Preview — what will go out:</b><br>' + escapeHtml(buildShareText()).replace(/\n/g, '<br>') + '<br><span class="fine">' + shared + ' of ' + state.today.notes.length + ' notes shared, ' + (state.today.notes.length - shared) + ' blurred out. Unticked notes stay private.</span>';
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
async function shareAsArt() {
  const canvas = drawArtCard();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], 'give-thanks-' + state.today.date + '.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ title: 'Give Thanks', files: [file] }); return; } catch (e) {} }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
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
  if (state.today.count <= 0 || !state.pressHistory.length) return;
  const hadNote = state.pressHistory.pop();
  if (hadNote) state.today.notes.pop();
  state.today.count = Math.max(0, state.today.count - 1);
  render();
  saveTodayBackground();
  syncToServer();
}
function press(noteText) {
  // Render FIRST, synchronously — never let storage/sync delay the visible count.
  state.pressHistory.push(!!noteText);
  state.today.count += 1;
  if (noteText) state.today.notes.push({ text: noteText.slice(0, 140), time: timeNow(), shareable: false });
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
  const gardenOptIn = el('gardenOptIn');
  if (gardenOptIn) gardenOptIn.addEventListener('change', async (e) => { state.settings.gardenOptIn = e.target.checked; await saveSettings(); render(); });
  const undoBtn = el('undoBtn');
  if (undoBtn) undoBtn.addEventListener('click', undoLastPress);
  const clearBtn = el('clearToday');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    state.today = { version: DATA_VERSION, date: state.today.date, count: 0, notes: [] };
    state.pressHistory = [];
    render(); saveTodayBackground(); syncToServer();
  });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  const goShare = el('goShareBtn');
  if (goShare) goShare.addEventListener('click', () => { switchTab('share'); renderSharePreview(); });
  const shareMsg = el('shareMessageBtn'); if (shareMsg) shareMsg.addEventListener('click', shareAsMessage);
  const shareArt = el('shareArtBtn'); if (shareArt) shareArt.addEventListener('click', shareAsArt);
  const copyShare = el('copyShareBtn');
  if (copyShare) copyShare.addEventListener('click', async () => { try { await navigator.clipboard.writeText(buildShareText()); alert('Copied'); } catch (e) { alert(buildShareText()); } });
}
attachListeners();
render();

// ---- init, each step isolated so one failure never kills the rest ----
(async () => {
  try { initThemes(); } catch (e) {}
  try { await loadAbout(); } catch (e) {}
  try { await loadSettings(); } catch (e) {}
  try { state.today.date = todayKey(); await loadToday(); } catch (e) {}
  try { render(); } catch (e) {}
  hideLoading();
})();
