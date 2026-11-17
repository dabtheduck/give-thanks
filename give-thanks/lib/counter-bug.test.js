// Give Thanks — counter-bug test (v5.4, dab 2026-11-17).
// The counter kept reverting to 75 after an undo, and /thanks made the
// app's own numbers disappear on reopen. The fix lives in public/app.js
// (queued saves, savedAt fresher-wins load, stale chunks cleared/trimmed),
// so this test loads the REAL app.js in a vm with stubbed Telegram
// CloudStorage / localStorage / DOM and drives press() / undoLastPress()
// / loadToday() against it — no jsdom needed.
//
// Run: node --test lib/counter-bug.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeElement() {
  return {
    textContent: '', innerHTML: '', value: '', checked: false,
    disabled: false, style: {}, dataset: {}, offsetWidth: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, appendChild() {}, setAttribute() {},
    focus() {}, setSelectionRange() {}, click() {},
  };
}

function bootApp(cloudDelayMs = 0) {
  const local = new Map();
  const cloud = new Map();
  let cloudDelay = cloudDelayMs;
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const context = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController,
    location: { search: '' },
    navigator: {},
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    localStorage: {
      getItem: (k) => (local.has(k) ? local.get(k) : null),
      setItem: (k, v) => { local.set(k, String(v)); },
      removeItem: (k) => { local.delete(k); },
    },
    document: {
      getElementById: el,
      createElement: () => makeElement(),
      addEventListener() {},
      querySelectorAll() { return []; },
      hidden: false,
    },
  };
  context.window = context;
  context.Telegram = {
    WebApp: {
      ready() {}, expand() {},
      initData: '',
      HapticFeedback: { impactOccurred() {} },
      CloudStorage: {
        getItem: (k, cb) => setTimeout(() => cb(null, cloud.has(k) ? cloud.get(k) : null), cloudDelay),
        setItem: (k, v, cb) => setTimeout(() => { cloud.set(k, String(v)); cb(null, true); }, cloudDelay),
      },
    },
  };
  context.addEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(APP_SRC, context, { filename: 'app.js' });
  const api = {
    context, local, cloud, elements,
    setCloudDelay: (ms) => { cloudDelay = ms; },
    count: () => Number(el('count').textContent || 0),
    noteItems: () => (el('notesList').innerHTML.match(/<li/g) || []).length,
    // Wait for the boot init + any queued saves (incl. slow-cloud writes).
    settle: async (ms = 700) => { await sleep(ms); },
  };
  return api;
}

function seedToday(api, { count, notes, savedAt, inCloud = true, inLocal = true }) {
  const date = api.context.todayKey();
  const meta = JSON.stringify({
    version: 5, date, count, pressHistory: notes.map(() => true),
    adoptedBotIds: [], chunkCount: 1, savedAt,
  });
  const chunk = JSON.stringify(notes.map((n, i) => ({
    text: n, time: '12:0' + i, shareable: false, id: 'seed-' + i, origin: 'app',
  })));
  if (inLocal) { api.local.set('gt_today_meta', meta); api.local.set('gt_today_notes_1', chunk); }
  if (inCloud) { api.cloud.set('gt_today_meta', meta); api.cloud.set('gt_today_notes_1', chunk); }
  return date;
}

test('counter-bug: rapid press + undo sticks across a reload', async () => {
  const app = bootApp();
  await app.settle();
  assert.equal(app.count(), 0);
  app.context.press('first thanks');
  app.context.press('second thanks');
  app.context.press('third thanks');
  assert.equal(app.count(), 3);
  app.context.undoLastPress();
  assert.equal(app.count(), 2);
  await app.settle(); // let the queued saves (incl. CloudStorage) land
  await app.context.loadToday(); // simulate reopening the app
  assert.equal(app.count(), 2, 'undo must survive a reload, not bounce back to 3');
  assert.equal(app.noteItems(), 2);
});

test('counter-bug: fresh local beats stale Cloud (the stuck-at-75 case)', async () => {
  const app = bootApp();
  await app.settle();
  const now = Date.now();
  // CloudStorage holds the old 75 (saved earlier); localStorage holds the
  // newer 74 after the undo. The load must pick 74, not 75.
  seedToday(app, { count: 75, notes: Array.from({ length: 75 }, (_, i) => 'n' + i), savedAt: now - 10000, inLocal: false });
  seedToday(app, { count: 74, notes: Array.from({ length: 74 }, (_, i) => 'n' + i), savedAt: now, inCloud: false });
  await app.context.loadToday();
  assert.equal(app.count(), 74);
});

test('counter-bug: CloudStorage empty + local has data does not reset to 0', async () => {
  const app = bootApp();
  await app.settle();
  // A CloudStorage write that timed out can leave the key unset there
  // while localStorage has the day — that used to look like "previous
  // numbers are gone" (/thanks then showed only its own +1).
  seedToday(app, { count: 12, notes: ['a', 'b'], savedAt: Date.now(), inCloud: false });
  await app.context.loadToday();
  assert.equal(app.count(), 12);
  assert.equal(app.noteItems(), 2);
});

test('counter-bug: stale note chunks are trimmed to the count', async () => {
  const app = bootApp();
  await app.settle();
  // Meta says 1 (after a delete/undo) but the old chunk still holds 2 notes.
  const date = app.context.todayKey();
  const meta = JSON.stringify({ version: 5, date, count: 1, pressHistory: [true], adoptedBotIds: [], chunkCount: 1, savedAt: Date.now() });
  const chunk = JSON.stringify([
    { text: 'kept', time: '12:00', shareable: false, id: 'k1', origin: 'app' },
    { text: 'deleted', time: '12:01', shareable: false, id: 'd1', origin: 'app' },
  ]);
  app.local.set('gt_today_meta', meta);
  app.local.set('gt_today_notes_1', chunk);
  app.cloud.set('gt_today_meta', meta);
  app.cloud.set('gt_today_notes_1', chunk);
  await app.context.loadToday();
  assert.equal(app.count(), 1);
  assert.equal(app.noteItems(), 1);
  assert.match(app.elements.get('notesList').innerHTML, /kept/);
  assert.doesNotMatch(app.elements.get('notesList').innerHTML, /deleted/);
});

test('counter-bug: presses made while a reload is running land on top of the stored count', async () => {
  const app = bootApp();
  await app.settle();
  // Stored day: 75 thanks. Reload with a slow CloudStorage, and press
  // twice while the load is still waiting — those presses must add to 75
  // (77), not be wiped when the stored count lands, and not replace it (2).
  seedToday(app, { count: 75, notes: Array.from({ length: 75 }, (_, i) => 'n' + i), savedAt: Date.now() });
  app.setCloudDelay(800);
  const loading = app.context.loadToday();
  await sleep(100);
  app.context.press('during load one');
  app.context.press('during load two');
  await loading;
  await app.settle(1500);
  assert.equal(app.count(), 77, 'presses during a load add to the stored count');
  assert.equal(app.noteItems(), 77);
  // And they stick on the next reload too.
  app.setCloudDelay(0);
  await app.context.loadToday();
  assert.equal(app.count(), 77);
});

test('counter-bug: a slow CloudStorage write landing late cannot resurrect the old count', async () => {
  const app = bootApp(800); // cloud slower than the 500ms timeout
  await app.settle();
  app.context.press('one');
  app.context.press('two');
  assert.equal(app.count(), 2);
  app.context.undoLastPress();
  assert.equal(app.count(), 1);
  await app.settle(2500); // let every late cloud write land
  await app.context.loadToday();
  assert.equal(app.count(), 1, 'late cloud write of 2 must not beat the newer local 1');
});
