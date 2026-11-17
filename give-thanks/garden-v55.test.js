// Give Thanks — garden v5.5 + v5.6 test (dab, 2026-11-17).
// v5.5: the group garden was disconnected from the 1:1 Mini App (the app
// never asked the server for groupGardens), tapping a flower did nothing,
// and the garden's counter showed 0. Fixed: fetchServerState merges the
// server's groupGardens, the picker uses one delegated listener, the
// garden shows "Your thanks today: N", and an in-app recap lists the
// shared notes. A raw Mini App URL pasted as text opens in the browser,
// so garden links are t.me deep links and the app reads the garden from
// initDataUnsafe.start_param too.
// v5.6: the garden list labelled every garden "Open group garden" (no
// group names), there was no way to toggle back to the list from a garden,
// and no way to delete / archive / reorder gardens. Fixed: /api/state
// returns gardenTitles, each list row is labelled with its group chat
// name, a "← Your gardens" button toggles back to the list, and each row
// has ↑ ↓ (reorder), 📥 (archive) and × (delete) controls, with an
// archived section that can restore a garden.
//
// Run: node garden-v55.test.js   (jsdom 31.0.1, in /tmp/gt-test)
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const APP = fs.readFileSync('/home/hatch/workspace/give-thanks/public/app.js', 'utf8');
const HTML = fs.readFileSync('/home/hatch/workspace/give-thanks/public/index.html', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GARDEN_ID = '-100123';
const GARDEN_ID_2 = '-100456';
const PLANTS = [
  { id: 'sunflower', name: 'Sunflower', emoji: '🌻' },
  { id: 'tulip', name: 'Tulip', emoji: '🌷' },
  { id: 'rose', name: 'Rose', emoji: '🌹' },
];

function boot(startParam) {
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
      initDataUnsafe: startParam ? { start_param: startParam } : {},
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
      return { ok: true, json: async () => ({ ok: true, pendingBot: [], settings: { groupGardens: [GARDEN_ID, GARDEN_ID_2], archivedGardens: [], gardenTitles: { [GARDEN_ID]: 'Family Chat', [GARDEN_ID_2]: 'Work Friends' } } }) };
    }
    if (String(url).startsWith('/api/garden?')) {
      return { ok: true, json: async () => ({
        ok: true, gardenId: GARDEN_ID, title: 'Family Chat', memberCount: 2,
        notes: [
          { id: 'n1', plant: 'tulip', emoji: '🌷', plantName: 'Tulip', text: 'good food', time: '12:00', date: '2026-11-17' },
          { id: 'n2', plant: 'sunflower', emoji: '🌻', plantName: 'Sunflower', text: 'a kind word', time: '13:00', date: '2026-11-17' },
        ],
        myPlant: serverMyPlant, plants: PLANTS,
      }) };
    }
    if (String(url) === '/api/garden/plant') {
      try { serverMyPlant = JSON.parse(opts.body || '{}').plant || serverMyPlant; } catch (e) {}
      return { ok: true, json: async () => ({ ok: true, plant: serverMyPlant }) };
    }
    if (String(url) === '/api/sync') return { ok: true, json: async () => ({ ok: true }) };
    if (String(url) === '/api/about') return { ok: true, json: async () => ({ ok: true, text: '' }) };
    return { ok: false, json: async () => ({}) };
  };
  window.eval(APP);
  return { window, document: window.document, cloud, local, fetchCalls };
}

const settingsOf = (cloud) => JSON.parse(cloud.get('gt_settings') || '{}');
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

(async () => {
  const { window, document, cloud, fetchCalls } = boot();
  await sleep(300);

  // 1. Garden sync: /api/state returns groupGardens + gardenTitles; the
  //    app merges them into settings so the Garden tab can show the
  //    gardens in the 1:1 app.
  window.fetchServerState();
  await sleep(300);
  let settings = settingsOf(cloud);
  assert.ok(settings.groupGardens && settings.groupGardens.includes(GARDEN_ID) && settings.groupGardens.includes(GARDEN_ID_2),
    'groupGardens must merge into settings, got ' + JSON.stringify(settings.groupGardens));
  assert.strictEqual(settings.gardenTitles && settings.gardenTitles[GARDEN_ID], 'Family Chat',
    'gardenTitles must merge into settings, got ' + JSON.stringify(settings.gardenTitles));

  // 2. Garden list: each row is labelled with its GROUP CHAT NAME, not
  //    "Open group garden".
  window.switchTab('garden');
  await sleep(300);
  const list = document.getElementById('gardenList');
  assert.notStrictEqual(list.style.display, 'none', 'garden list must show when there are gardens');
  assert.ok(list.textContent.includes('Family Chat'), 'list must label the first garden Family Chat, got: ' + list.textContent);
  assert.ok(list.textContent.includes('Work Friends'), 'list must label the second garden Work Friends');
  assert.ok(!list.textContent.includes('Open group garden'), 'no row may say the generic "Open group garden"');

  // 3. Toggle: tap a garden's name to open it, then "← Your gardens"
  //    goes back to the list.
  click(window, list.querySelector('[data-action="open"][data-garden="' + GARDEN_ID + '"]'));
  await sleep(300);
  assert.notStrictEqual(document.getElementById('groupGarden').style.display, 'none', 'tapping a garden must open it');
  assert.ok(document.getElementById('groupGardenTitle').textContent.includes('Family Chat'), 'the opened garden must be Family Chat');
  const backBtn = document.getElementById('gardenBackBtn');
  assert.notStrictEqual(backBtn.style.display, 'none', 'the back button must show in a garden view');
  click(window, backBtn);
  await sleep(300);
  assert.notStrictEqual(document.getElementById('gardenList').style.display, 'none', 'back button must return to the garden list');
  assert.strictEqual(document.getElementById('groupGarden').style.display, 'none', 'the garden view must hide when back on the list');

  // 4. Reorder: move "Work Friends" up — it becomes first in settings.
  click(window, list.querySelector('[data-action="up"][data-garden="' + GARDEN_ID_2 + '"]'));
  await sleep(200);
  settings = settingsOf(cloud);
  assert.strictEqual(settings.groupGardens[0], GARDEN_ID_2, 'moving Work Friends up must make it first, got ' + JSON.stringify(settings.groupGardens));
  // ... and the list re-renders in the new order.
  assert.ok(list.textContent.indexOf('Work Friends') < list.textContent.indexOf('Family Chat'), 'the list must re-render in the new order');

  // 5. Archive: archiving Family Chat moves it to the archived section;
  //    restoring brings it back to the main list.
  click(window, list.querySelector('[data-action="archive"][data-garden="' + GARDEN_ID + '"]'));
  await sleep(200);
  settings = settingsOf(cloud);
  assert.ok(!settings.groupGardens.includes(GARDEN_ID) && settings.archivedGardens.includes(GARDEN_ID),
    'archiving must move the garden out of groupGardens and into archivedGardens, got ' + JSON.stringify(settings));
  assert.ok(document.querySelector('.garden-archived') && document.querySelector('.garden-archived').textContent.includes('Family Chat'),
    'the archived section must show the archived garden');
  click(window, list.querySelector('[data-action="unarchive"][data-garden="' + GARDEN_ID + '"]'));
  await sleep(200);
  settings = settingsOf(cloud);
  assert.ok(settings.groupGardens.includes(GARDEN_ID) && !settings.archivedGardens.includes(GARDEN_ID),
    'restoring must move the garden back to groupGardens, got ' + JSON.stringify(settings));

  // 6. Delete: removing Work Friends drops it from the list entirely.
  click(window, list.querySelector('[data-action="remove"][data-garden="' + GARDEN_ID_2 + '"]'));
  await sleep(200);
  settings = settingsOf(cloud);
  assert.ok(!settings.groupGardens.includes(GARDEN_ID_2) && !settings.archivedGardens.includes(GARDEN_ID_2),
    'deleting must remove the garden from both lists, got ' + JSON.stringify(settings));
  assert.ok(!list.textContent.includes('Work Friends'), 'the deleted garden must leave the list');

  // 7. Open the remaining garden again and check the garden view: the
  //    personal count link, the picker, and the in-app recap.
  click(window, list.querySelector('[data-action="open"][data-garden="' + GARDEN_ID + '"]'));
  await sleep(300);
  assert.ok(/Your thanks today: \d+ thanks/.test(document.getElementById('gardenMyCount').textContent),
    'garden must show the personal count, got: ' + document.getElementById('gardenMyCount').textContent);
  const tulipBtn = document.getElementById('plantPicker').querySelector('[data-plant="tulip"]');
  assert.ok(tulipBtn, 'picker must have a tulip button');
  click(window, tulipBtn);
  await sleep(300);
  const plantCall = fetchCalls.find((c) => c.url === '/api/garden/plant');
  assert.ok(plantCall && JSON.parse(plantCall.opts.body).plant === 'tulip', 'tapping a flower must POST the pick');
  assert.ok(document.getElementById('plantStatus').textContent.includes('Tulip'), 'status must confirm the pick, got: ' + document.getElementById('plantStatus').textContent);
  const recap = document.getElementById('gardenRecapList');
  assert.ok(recap.textContent.includes('good food') && recap.textContent.includes('🌷'),
    'recap list must show the shared notes with their plants, got: ' + recap.textContent);

  // 8. Deep link: a garden opened from a t.me link (start_param, no
  //    ?startapp= in the URL) must open that garden, not the setup line.
  const b2 = boot('garden_' + GARDEN_ID);
  await sleep(300);
  b2.window.fetchServerState();
  await sleep(300);
  b2.window.switchTab('garden');
  await sleep(300);
  assert.notStrictEqual(b2.document.getElementById('groupGarden').style.display, 'none',
    'a garden opened via start_param must show the group garden');
  assert.ok(b2.document.getElementById('groupGardenTitle').textContent.includes('Family Chat'),
    'the start_param garden must load, got: ' + b2.document.getElementById('groupGardenTitle').textContent);

  console.log('garden v5.5+v5.6: all tests pass (names, toggle, reorder, archive/restore, delete, picker, recap, t.me deep link)');
})().catch((e) => { console.error('garden v5.5+v5.6 FAILED:', e.message); process.exit(1); });
