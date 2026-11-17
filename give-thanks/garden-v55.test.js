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
        // v5.8: the tulip is taken by another member, so picking it warns.
        takenPlants: ['tulip'],
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
  const roseBtn = document.getElementById('plantPicker').querySelector('[data-plant="rose"]');
  assert.ok(roseBtn, 'picker must have a rose button');
  click(window, roseBtn);
  await sleep(300);
  const plantCall = fetchCalls.find((c) => c.url === '/api/garden/plant');
  assert.ok(plantCall && JSON.parse(plantCall.opts.body).plant === 'rose', 'tapping a flower must POST the pick');
  assert.ok(document.getElementById('plantStatus').textContent.includes('Rose'), 'status must confirm the pick, got: ' + document.getElementById('plantStatus').textContent);
  const recap = document.getElementById('gardenRecapList');
  assert.ok(recap.textContent.includes('good food') && recap.textContent.includes('🌷'),
    'recap list must show the shared notes with their plants, got: ' + recap.textContent);

  // 8. Deep link: a garden opened from a t.me link (start_param, no
  //    ?startapp= in the URL) must open that garden, not the setup line.
  const b2 = boot('garden_' + GARDEN_ID);
  await sleep(600);
  // v5.8: a garden opened via start_param must land ON the garden page
  // (the Garden tab), not the Counter tab — /seegardens buttons used to
  // open the counter even though the garden had loaded.
  assert.ok(b2.document.getElementById('groupGarden').style.display !== 'none' || b2.document.getElementById('gardenList').style.display !== 'none',
    'a garden opened via start_param must show the garden');
  assert.ok(b2.document.getElementById('groupGardenTitle').textContent.includes('Family Chat'),
    'the start_param garden must load, got: ' + b2.document.getElementById('groupGardenTitle').textContent);
  assert.strictEqual(b2.document.getElementById('tab-garden').classList.contains('active'), true,
    'a garden opened via start_param must land on the Garden tab, not the Counter tab');
  assert.strictEqual(b2.document.getElementById('tab-counter').classList.contains('active'), false,
    'the Counter tab must not be active when opening into a garden');

  // v5.8: the plant choice sticks in the app (CloudStorage) and is
  // re-sent to the server. Pick a free plant (rose) — it saves to
  // settings.plantChoices and the /api/garden request carries myPlant.
  const b3 = boot();
  const { window: w3, document: d3, cloud: c3, fetchCalls: f3 } = b3;
  await sleep(300);
  w3.fetchServerState();
  await sleep(300);
  w3.switchTab('garden');
  await sleep(300);
  // Open the single garden from the list (two gardens -> list view).
  const rowBtn = d3.querySelector('#gardenList [data-action="open"][data-garden="' + GARDEN_ID + '"]');
  if (rowBtn) { click(w3, rowBtn); await sleep(300); }
  const roseBtn3 = d3.querySelector('#plantPicker [data-plant="rose"]');
  assert.ok(roseBtn3, 'the rose picker button must exist');
  click(w3, roseBtn3);
  await sleep(300);
  const settings3 = settingsOf(c3);
  assert.strictEqual(settings3.plantChoices && settings3.plantChoices[GARDEN_ID], 'rose',
    'picking a plant must save it to settings.plantChoices (CloudStorage), got ' + JSON.stringify(settings3.plantChoices));
  // The next garden load re-sends the stored choice as myPlant.
  f3.length = 0;
  w3.switchTab('counter'); await sleep(100);
  w3.switchTab('garden'); await sleep(300);
  const gardenCall = f3.find((c) => String(c.url).startsWith('/api/garden?'));
  assert.ok(gardenCall && String(gardenCall.url).includes('myPlant=rose'),
    'the garden load must re-send the stored plant choice as myPlant, got ' + (gardenCall ? gardenCall.url : 'no call'));

  // v5.8: warn on duplicates. The tulip is taken (takenPlants in the
  // stub). First tap warns and does NOT save; second tap saves anyway.
  const tulipBtn2 = d3.querySelector('#plantPicker [data-plant="tulip"]');
  assert.ok(tulipBtn2, 'the tulip picker button must exist');
  click(w3, tulipBtn2);
  await sleep(200);
  const status1 = d3.getElementById('plantStatus').textContent;
  assert.ok(/already has/i.test(status1), 'first tap on a taken plant must warn, got: ' + status1);
  assert.strictEqual(settingsOf(c3).plantChoices[GARDEN_ID], 'rose',
    'the warning tap must not change the saved plant');
  click(w3, tulipBtn2);
  await sleep(300);
  assert.strictEqual(settingsOf(c3).plantChoices[GARDEN_ID], 'tulip',
    'the second tap on a taken plant must save it anyway');

  console.log('garden v5.5+v5.6+v5.8: all tests pass (names, toggle, reorder, archive/restore, delete, picker, recap, t.me deep link, plant sticks, duplicate warning, garden tab on open)');
})().catch((e) => { console.error('garden v5.5+v5.6 FAILED:', e.message); process.exit(1); });
