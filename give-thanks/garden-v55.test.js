// Give Thanks — garden v5.5 test (dab, 2026-11-17).
// The group garden was disconnected from the 1:1 Mini App: the server
// knew about group gardens (via /garden) but the app never asked, so the
// Garden tab showed the setup line instead of the garden. And tapping a
// flower did literally nothing (no highlight, no "saving…").
// v5.5: fetchServerState merges the server's groupGardens into settings
// (so the Garden tab shows the user's gardens in the 1:1 app), the picker
// uses one delegated listener (survives re-renders) and pickPlant says so
// instead of failing silently, the garden shows "Your thanks today: N"
// (linked to the personal counter), and an in-app recap list shows the
// shared notes with their plants.
//
// Run: node garden-v55.test.js   (jsdom 31.0.1, in /tmp/gt-test)
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const APP = fs.readFileSync('/home/hatch/workspace/give-thanks/public/app.js', 'utf8');
const HTML = fs.readFileSync('/home/hatch/workspace/give-thanks/public/index.html', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GARDEN_ID = '-100123';
const PLANTS = [
  { id: 'sunflower', name: 'Sunflower', emoji: '🌻' },
  { id: 'tulip', name: 'Tulip', emoji: '🌷' },
  { id: 'rose', name: 'Rose', emoji: '🌹' },
];

function boot() {
  const cloud = new Map();
  const local = new Map();
  const fetchCalls = [];
  let serverMyPlant = 'sunflower';
  const dom = new JSDOM(HTML, { url: 'https://give-thanks.onrender.com/', runScripts: 'outside-only' });
  const { window } = dom;
  window.Telegram = {
    WebApp: {
      ready() {}, expand() {},
      initData: 'query_id=test&user=%7B%22id%22%3A42%7D&auth_date=1700000000&hash=deadbeef',
      HapticFeedback: { impactOccurred() {} },
      CloudStorage: {
        getItem: (k, cb) => setTimeout(() => cb(null, cloud.has(k) ? cloud.get(k) : null), 0),
        setItem: (k, v, cb) => setTimeout(() => { cloud.set(k, String(v)); if (cb) cb(null, true); }, 0),
        removeItem: (k, cb) => setTimeout(() => { cloud.delete(k); if (cb) cb(null, true); }, 0),
      },
    },
  };
  window.localStorage = {
    getItem: (k) => (local.has(k) ? local.get(k) : null),
    setItem: (k, v) => { local.set(k, String(v)); },
    removeItem: (k) => { local.delete(k); },
  };
  window.fetch = async (url, opts = {}) => {
    fetchCalls.push({ url: String(url), opts });
    if (String(url).startsWith('/api/state')) {
      return { ok: true, json: async () => ({ ok: true, pendingBot: [], settings: { groupGardens: [GARDEN_ID] } }) };
    }
    if (String(url).startsWith('/api/garden?')) {
      return { ok: true, json: async () => ({
        ok: true, gardenId: GARDEN_ID, title: 'Test group', memberCount: 2,
        notes: [
          { id: 'n1', plant: 'tulip', emoji: '🌷', plantName: 'Tulip', text: 'good food', time: '12:00', date: '2026-11-17' },
          { id: 'n2', plant: 'sunflower', emoji: '🌻', plantName: 'Sunflower', text: 'a kind word', time: '13:00', date: '2026-11-17' },
        ],
        myPlant: serverMyPlant, plants: PLANTS,
      }) };
    }
    if (String(url) === '/api/garden/plant') {
      // Stateful stub: a real server saves the pick, so the next garden
      // load returns the NEW plant (not the old one).
      try { serverMyPlant = JSON.parse(opts.body || '{}').plant || serverMyPlant; } catch (e) {}
      return { ok: true, json: async () => ({ ok: true, plant: serverMyPlant }) };
    }
    if (String(url) === '/api/sync') return { ok: true, json: async () => ({ ok: true }) };
    if (String(url) === '/api/about') return { ok: true, json: async () => ({ ok: true, text: '' }) };
    return { ok: false, json: async () => ({}) };
  };
  // Drive the app through its top-level function declarations (jsdom:
  // only function declarations are visible across window.eval calls).
  window.eval(APP);
  return { window, document: window.document, cloud, local, fetchCalls };
}

(async () => {
  const { window, document, cloud, fetchCalls } = boot();
  await sleep(300);

  // 1. Garden sync: /api/state returns groupGardens; the app merges them
  //    into settings (CloudStorage gt_settings) so the Garden tab can
  //    show the garden in the 1:1 app.
  window.fetchServerState();
  await sleep(300);
  const settings = JSON.parse(cloud.get('gt_settings') || '{}');
  assert.ok(Array.isArray(settings.groupGardens) && settings.groupGardens.includes(GARDEN_ID),
    'groupGardens from /api/state must be merged into settings, got ' + JSON.stringify(settings.groupGardens));

  // 2. Garden tab: a single known garden auto-opens — groupGarden shown,
  //    the setup line hidden.
  window.switchTab('garden');
  await sleep(300);
  assert.notStrictEqual(document.getElementById('groupGarden').style.display, 'none', 'group garden must show');
  assert.strictEqual(document.getElementById('gardenSetup').style.display, 'none', 'setup line must hide once a garden is known');
  assert.ok(document.getElementById('groupGardenTitle').textContent.includes('Test group'), 'garden title must load');

  // 3. "Your thanks today" links the garden to the personal counter.
  const myCount = document.getElementById('gardenMyCount').textContent;
  assert.ok(/Your thanks today: \d+ thanks/.test(myCount), 'garden must show the personal count, got: ' + myCount);

  // 4. Picker (delegated): tapping a flower POSTs /api/garden/plant and
  //    shows the pick. The tap used to do literally nothing.
  const picker = document.getElementById('plantPicker');
  const tulipBtn = picker.querySelector('[data-plant="tulip"]');
  assert.ok(tulipBtn, 'picker must have a tulip button');
  tulipBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const plantCall = fetchCalls.find((c) => c.url === '/api/garden/plant');
  assert.ok(plantCall, 'tapping a flower must POST /api/garden/plant');
  assert.ok(JSON.parse(plantCall.opts.body).plant === 'tulip', 'the POST must carry the picked plant');
  assert.ok(document.getElementById('plantStatus').textContent.includes('Tulip'), 'status must confirm the pick, got: ' + document.getElementById('plantStatus').textContent);

  // 5. In-app recap: the shared notes as a list, plant + note.
  const recap = document.getElementById('gardenRecapList');
  assert.ok(recap.textContent.includes('good food') && recap.textContent.includes('a kind word'),
    'recap list must show the shared notes, got: ' + recap.textContent);
  assert.ok(recap.textContent.includes('🌷') && recap.textContent.includes('🌻'),
    'recap list must show each note’s plant');

  console.log('garden v5.5: all tests pass (gardens sync into the 1:1 app, picker tap saves, my-count link, in-app recap)');
})().catch((e) => { console.error('garden v5.5 FAILED:', e.message); process.exit(1); });
