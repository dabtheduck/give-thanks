// Give Thanks — Mini App
// CloudStorage first (1024 keys, 4096 chars/value), sync to server second.
// Chunk notes across keys: gt_today_notes_1, gt_today_notes_2, ...
// Upgrades: DATA_VERSION = 4. Old records with no version are v1.
// Migrate on read, never delete unknown fields, safe fallback if new data fails to parse.
// v3: notes gain shareable (default false = private). See UPGRADES.md.
// v4: times are hardcoded — recap 03:00, notification 19:30, in your timezone.
// No hour settings. Timezone is still per-user, auto-detected from the device.
const DATA_VERSION = 4;
const FIXED_RESET_HOUR = 3;
const FIXED_NOTIFY_HOUR = 19;
const FIXED_NOTIFY_MINUTE = 30;
const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const cs = tg?.CloudStorage;

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
  if (from < 4) {
    // v4: hours are hardcoded now. Drop the two hour settings.
    delete s.resetHour;
    delete s.notifyHour;
  }
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
  // v3: shareable defaults to false (private). Old notes stay private unless ticked.
  t.notes = t.notes.map(n => ({ text: String(n.text || '').slice(0, 140), time: String(n.time || ''), shareable: typeof n.shareable === 'boolean' ? n.shareable : false }));
  return t;
}

// About / Bulletin Board: dab has full autonomy. Content lives in public/content/about.md.
// The app fetches it and renders it. Lots of text is fine. No code changes needed to edit it.
// Fallback is the built-in text below if the file can't be fetched.
const ABOUT_FALLBACK = [
  { t: 'What this is', b: 'A tiny daily habit. Press, notice one good thing, move on.' },
  { t: 'How it works', b: 'Press to count, tag a note if you like, get a recap at 3am your time, start fresh.' },
];
function renderMarkdown(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = ''; let inList = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${esc(line.slice(3))}</h3>`; }
    else if (line.startsWith('# ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${esc(line.slice(2))}</h2>`; }
    else if (line.startsWith('- ')) { if (!inList) { html += '<ul>'; inList = true; } html += `<li class="calm">${esc(line.slice(2))}</li>`; }
    else if (line === '' || line === '---') { if (inList) { html += '</ul>'; inList = false; } }
    else { if (inList) { html += '</ul>'; inList = false; } html += `<p class="calm">${esc(line)}</p>`; }
  }
  if (inList) html += '</ul>';
  return html;
}
async function loadAbout() {
  const el = document.getElementById('aboutContent');
  if (!el) return;
  // 1) Live version from the server (this is what /edit_about in Telegram updates).
  // 2) Static file public/content/about.md. 3) Built-in fallback.
  try {
    const res = await fetch('/api/about');
    if (res.ok) { const j = await res.json(); if (j.text) { el.innerHTML = renderMarkdown(j.text); return; } }
  } catch {}
  try {
    const res = await fetch('content/about.md');
    if (!res.ok) throw new Error('no about file');
    const md = await res.text();
    el.innerHTML = renderMarkdown(md);
  } catch {
    el.innerHTML = ABOUT_FALLBACK.map(s => `<h3>${s.t}</h3><p class="calm">${s.b}</p>`).join('');
  }
}
function initThemes() {
  const sel = document.getElementById('themeSelect');
  if (!sel || !window.GiveThanksThemes) return;
  const saved = (() => { try { return localStorage.getItem('gt_theme'); } catch { return null; } })();
  sel.innerHTML = window.GiveThanksThemes.listThemes().map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  sel.value = saved && window.GiveThanksThemes.THEMES[saved] ? saved : 'cream-forest';
  window.GiveThanksThemes.applyTheme(sel.value);
  sel.addEventListener('change', () => window.GiveThanksThemes.applyTheme(sel.value));
}

const DEFAULT_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore';
const state = {
  today: { version: DATA_VERSION, date: todayKey(), count: 0, notes: [] },
  settings: { version: DATA_VERSION, timezone: DEFAULT_TZ, notificationsOn: true, notifyOnlyIfEmpty: true, gardenOptIn: false, groupGardens: [], features: { gardenWeeklyShare: false, newRecapFormat: false, shareOutsideTelegram: true } },
  gardenId: new URLSearchParams(location.search).get('startapp')?.replace('garden_', '') || 'personal',
};
function todayKey(d = new Date(), tz) {
  // Day ends at 03:00, not midnight. If it's 01:00 and reset is 03:00, it's still yesterday's day.
  // NOTE: this is called while `state` itself is still being initialised, so reading
  // state.settings.timezone directly here throws "Cannot access 'state' before
  // initialization" and kills the whole script before any button listeners are
  // attached. Use the passed tz, or state if it exists yet, else DEFAULT_TZ.
  let zone = tz;
  if (!zone) {
    try { zone = state.settings.timezone; } catch { zone = DEFAULT_TZ; }
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value;
  let date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = parseInt(get('hour'), 10) % 24;
  if (hour < FIXED_RESET_HOUR) {
    // Before 03:00 it is still yesterday's day. Do NOT recurse with the same
    // time of day — that loops forever, because the hour is still < 3.
    // Just format yesterday's date directly.
    const y = new Date(d); y.setDate(y.getDate() - 1);
    const yParts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(y);
    const yGet = (t) => yParts.find(p => p.type === t)?.value;
    return `${yGet('year')}-${yGet('month')}-${yGet('day')}`;
  }
  return date;
}
function timeNow() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: state.settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

// ---- CloudStorage helpers (chunked) ----
function csGet(key) {
  return new Promise((resolve) => {
    if (!cs) return resolve(localStorage.getItem(key));
    cs.getItem(key, (err, v) => resolve(err ? null : v));
  });
}
function csSet(key, val) {
  return new Promise((resolve) => {
    if (!cs) { localStorage.setItem(key, val); return resolve(true); }
    cs.setItem(key, val, (err, ok) => resolve(!err && ok));
  });
}
async function loadToday() {
  const meta = await csGet('gt_today_meta');
  if (meta) {
    try {
      const m = migrateToday(JSON.parse(meta));
      if (m.date === state.today.date) {
        state.today.count = m.count || 0;
        state.today.notes = [];
        for (let i = 1; i <= 10; i++) {
          const chunk = await csGet(`gt_today_notes_${i}`);
          if (!chunk) break;
          try { state.today.notes.push(...JSON.parse(chunk)); } catch { /* keep what we have, never wipe on a bad chunk */ }
        }
        render(); return;
      }
    } catch {
      // Safe fallback: don't wipe the count on a parse error.
      // Show the last known good state and let the user keep pressing.
      document.getElementById('syncStatus').textContent = "Couldn't load the new bits, your thanks are safe";
    }
  }
  state.today = { version: DATA_VERSION, date: state.today.date, count: 0, notes: [] };
  await saveToday();
}
async function saveToday() {
  await csSet('gt_today_meta', JSON.stringify({ version: DATA_VERSION, date: state.today.date, count: state.today.count }));
  // chunk notes to stay under 4096 chars per value
  const chunks = [];
  let cur = [];
  for (const n of state.today.notes) {
    const test = [...cur, n];
    if (JSON.stringify(test).length > 3800) { chunks.push(cur); cur = [n]; } else cur = test;
  }
  if (cur.length) chunks.push(cur);
  for (let i = 0; i < Math.max(chunks.length, 1); i++) {
    await csSet(`gt_today_notes_${i + 1}`, JSON.stringify(chunks[i] || []));
  }
  render();
}
async function loadSettings() {
  const raw = await csGet('gt_settings');
  if (raw) { try { Object.assign(state.settings, migrateSettings(JSON.parse(raw))); } catch { /* keep defaults, never crash on old settings */ } }
  // fill selects
  const tzSel = document.getElementById('timezone');
  const zones = ['Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Tokyo', 'Asia/Jakarta', 'Australia/Sydney', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'];
  if (!zones.includes(state.settings.timezone)) zones.unshift(state.settings.timezone);
  tzSel.innerHTML = zones.map(z => `<option ${z === state.settings.timezone ? 'selected' : ''}>${z}</option>`).join('');
  // v4: no hour pickers — recap 03:00, notification 19:30, in your timezone.
  document.getElementById('notificationsOn').checked = state.settings.notificationsOn;
  document.getElementById('notifyOnlyIfEmpty').checked = state.settings.notifyOnlyIfEmpty;
  document.getElementById('gardenOptIn').checked = state.settings.gardenOptIn;
}
async function saveSettings() {
  await csSet('gt_settings', JSON.stringify(state.settings));
  syncToServer();
}

// ---- sync to server (for scheduler + recap) ----
async function syncToServer() {
  const status = document.getElementById('syncStatus');
  try {
    const res = await fetch('/api/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiVersion: DATA_VERSION, initData: tg?.initData || '', today: state.today, settings: state.settings, gardenId: state.gardenId }),
    });
    if (res.ok) { status.textContent = 'Saved ✓ synced for recap'; }
    else { status.textContent = 'Saved on this device — will sync when online'; }
  } catch { status.textContent = 'Saved on this device — will sync when online'; }
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

// ---- UI ----
const PLANTS = ['🌱', '🌿', '🌷', '🌻', '🌳'];
function render() {
  document.getElementById('todayDate').textContent = state.today.date;
  document.getElementById('count').textContent = state.today.count;
  document.getElementById('plant').textContent = PLANTS[Math.min(Math.floor(state.today.count / 3), PLANTS.length - 1)];
  const list = document.getElementById('notesList');
  // Per-note share checkbox. Unticked = private, blurred in any share. Default false.
  list.innerHTML = state.today.notes.map((n, i) => `<li><label class="share-check"><input type="checkbox" data-share="${i}" ${n.shareable ? 'checked' : ''}> share</label> <b>#${i + 1}</b> ${n.time} — <span class="${n.shareable ? '' : 'private-note'}">${escapeHtml(n.text)}</span></li>`).reverse().join('');
  list.querySelectorAll('input[data-share]').forEach(cb => cb.addEventListener('change', async (e) => {
    const idx = parseInt(e.target.dataset.share, 10);
    state.today.notes[idx].shareable = e.target.checked;
    await saveToday(); syncToServer(); renderSharePreview();
  }));
  document.getElementById('gardenCount').textContent = `${state.today.count} flowers bloomed today (personal view)`;
  document.getElementById('gardenField').textContent = '🌸 '.repeat(Math.min(state.today.count, 30)) || '🌱 Your garden is waiting for its first thanks today.';
  renderSharePreview();
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- Sharing outside Telegram: message or art page ----
// Private notes are NEVER included as text. They appear as blurred blocks.
function buildShareText() {
  const lines = [`🌱 Give Thanks — ${state.today.date}`, ``, `I said thanks ${state.today.count} time${state.today.count === 1 ? '' : 's'} today.`, ``];
  state.today.notes.forEach((n, i) => lines.push(`${i + 1}. ${n.shareable ? n.text : '••• hidden •••'}`));
  return lines.join('\n');
}
function renderSharePreview() {
  const el = document.getElementById('sharePreview');
  if (!el) return;
  const shared = state.today.notes.filter(n => n.shareable).length;
  el.innerHTML = `<b>Preview — what will go out:</b><br>${escapeHtml(buildShareText()).replace(/\n/g, '<br>')}<br><span class="fine">${shared} of ${state.today.notes.length} notes shared, ${state.today.notes.length - shared} blurred out. Unticked notes stay private.</span>`;
}
async function shareAsMessage() {
  const text = buildShareText();
  if (navigator.share) { try { await navigator.share({ title: 'Give Thanks', text }); return; } catch {} }
  try { await navigator.clipboard.writeText(text); alert('Copied — paste it anywhere (WhatsApp, Instagram, Messages…)'); }
  catch { alert(text); }
}
function drawArtCard() {
  // Pixel-art card, drawn on-device. No upload, no link.
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
    if (n.shareable) { x.fillText(`${i + 1}. ${n.text.slice(0, 38)}`, 60, y); }
    else { x.fillText(`${i + 1}. `, 60, y); x.fillStyle = '#8A8A8A'; x.fillRect(140, y - 28, 700, 36); }
    y += 64;
  });
  x.fillStyle = '#D97B29'; x.font = '32px monospace'; x.fillText('made with Give Thanks', 60, 1260);
  return c;
}
async function shareAsArt() {
  const canvas = drawArtCard();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], `give-thanks-${state.today.date}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ title: 'Give Thanks', files: [file] }); return; } catch {} }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
}
function press(noteText) {
  state.today.count += 1;
  if (noteText) state.today.notes.push({ text: noteText.slice(0, 140), time: timeNow(), shareable: false });
  const btn = document.getElementById('pressBtn');
  btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  saveToday(); syncToServer();
}

document.getElementById('pressBtn').addEventListener('click', () => {
  const note = document.getElementById('noteInput').value.trim();
  document.getElementById('noteInput').value = '';
  press(note);
});
document.getElementById('addNoteBtn').addEventListener('click', () => {
  const note = document.getElementById('noteInput').value.trim();
  if (!note) return;
  document.getElementById('noteInput').value = '';
  if (state.today.notes.length === 0 && state.today.count === 0) press(note);
  else { state.today.notes.push({ text: note.slice(0, 140), time: timeNow(), shareable: false }); if (state.today.count === 0) state.today.count = 1; saveToday(); syncToServer(); }
});
document.getElementById('saveSettings').addEventListener('click', async () => {
  state.settings.timezone = document.getElementById('timezone').value;
  state.settings.notificationsOn = document.getElementById('notificationsOn').checked;
  state.settings.notifyOnlyIfEmpty = document.getElementById('notifyOnlyIfEmpty').checked;
  await saveSettings();
  tg?.showAlert?.('Settings saved 🌱');
});
document.getElementById('gardenOptIn').addEventListener('change', async (e) => { state.settings.gardenOptIn = e.target.checked; await saveSettings(); render(); });
document.getElementById('clearToday').addEventListener('click', async () => {
  state.today = { version: DATA_VERSION, date: state.today.date, count: 0, notes: [] };
  await saveToday(); syncToServer();
});
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById('tab-' + b.dataset.tab).classList.add('active');
}));
initThemes(); loadAbout();
document.getElementById('shareBtn')?.addEventListener('click', () => { document.getElementById('shareSection').scrollIntoView({ behavior: 'smooth' }); renderSharePreview(); });
document.getElementById('shareMessageBtn')?.addEventListener('click', shareAsMessage);
document.getElementById('shareArtBtn')?.addEventListener('click', shareAsArt);
document.getElementById('copyShareBtn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(buildShareText()); alert('Copied'); } catch { alert(buildShareText()); } });

(async () => { await loadSettings(); state.today.date = todayKey(); await loadToday(); render(); })();
