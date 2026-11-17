// Run: node lib/garden.test.js
// Tests the v5.1 daily garden store: only shareable notes enter, dedup by
// note id, and the garden resets when a new day arrives (dab, 2026-11-17:
// "let's just have the garden reset every day").
const assert = require('assert');
const { createGardenStore, getGarden, rolloverGarden, pruneGarden, addGardenNote, updateMemberPlant, serializeGardens, deserializeGardens } = require('./garden');

const store = createGardenStore();
const gid = '-100123';
const today = '2026-11-17';
const tomorrow = '2026-11-18';

// A shareable note plants; a private one doesn't; a note without id doesn't.
addGardenNote(store, gid, 111, { id: 'n-1', text: 'warm soup', time: '09:12', shareable: true, date: today });
addGardenNote(store, gid, 111, { id: 'n-2', text: 'private thing', time: '10:00', shareable: false, date: today });
addGardenNote(store, gid, 111, { text: 'no id', time: '11:00', shareable: true, date: today });
let g = getGarden(store, gid);
assert.strictEqual(g.notes.length, 1, 'only the shareable note with an id plants');
assert.strictEqual(g.notes[0].text, 'warm soup');
assert.strictEqual(g.date, today, 'the garden belongs to the day of its first note');
assert.ok(g.members.has(111), 'the sharer becomes a member');

// Re-syncing the same note never plants it twice.
addGardenNote(store, gid, 111, { id: 'n-1', text: 'warm soup', time: '09:12', shareable: true, date: today });
assert.strictEqual(getGarden(store, gid).notes.length, 1, 'dedup by note id');

// A second member's note joins the same garden.
addGardenNote(store, gid, 222, { id: 'n-3', text: 'good food', time: '12:30', shareable: true, date: today });
assert.strictEqual(getGarden(store, gid).notes.length, 2);
assert.ok(getGarden(store, gid).members.has(222));

// A note from a new day resets the garden: yesterday's plants are gone.
addGardenNote(store, gid, 111, { id: 'n-4', text: 'fresh start', time: '09:00', shareable: true, date: tomorrow });
g = getGarden(store, gid);
assert.strictEqual(g.notes.length, 1, 'a new day clears yesterday’s plants');
assert.strictEqual(g.notes[0].text, 'fresh start');
assert.strictEqual(g.date, tomorrow);

// rolloverGarden: same day is a no-op, a new day clears.
assert.strictEqual(rolloverGarden(g, tomorrow), false, 'same day does not roll');
assert.strictEqual(rolloverGarden(g, '2026-11-19'), true, 'a new day rolls');
assert.strictEqual(g.notes.length, 0, 'rolled garden is empty');
assert.strictEqual(g.date, '2026-11-19');
assert.strictEqual(rolloverGarden(g, ''), false, 'no day given does nothing');

// pruneGarden drops notes from other days (safety net).
g.notes.push({ id: 'n-x', userId: 111, text: 'stray', time: '10:00', date: '2026-11-18' });
g.notes.push({ id: 'n-y', userId: 111, text: 'today', time: '10:00', date: '2026-11-19' });
pruneGarden(g);
assert.strictEqual(g.notes.length, 1, 'only notes from the garden’s day stay');
assert.strictEqual(g.notes[0].id, 'n-y');

// v5.8: the plant is stored ON the note when it's planted, so a note's
// plant never reshuffles at read time.
const store2 = createGardenStore();
addGardenNote(store2, gid, 111, { id: 'p-1', text: 'soup', time: '09:00', shareable: true, date: today, plant: 'tulip' });
addGardenNote(store2, gid, 222, { id: 'p-2', text: 'walk', time: '10:00', shareable: true, date: today, plant: 'apple' });
let g2 = getGarden(store2, gid);
assert.strictEqual(g2.notes[0].plant, 'tulip', 'the note keeps the plant it was planted with');
assert.strictEqual(g2.notes[1].plant, 'apple', 'the second note keeps its own plant');
// A note with no plant stores an empty plant (the reader backfills it).
addGardenNote(store2, gid, 333, { id: 'p-3', text: 'sun', time: '11:00', shareable: true, date: today });
assert.strictEqual(getGarden(store2, gid).notes[2].plant, '', 'a note with no plant stores empty, not a random one');
// When a member changes plant, their notes switch to the new plant.
assert.strictEqual(updateMemberPlant(g2, 111, 'mango'), 1, 'one note updated for the member');
assert.strictEqual(g2.notes[0].plant, 'mango', 'the member’s note now shows the new plant');
assert.strictEqual(g2.notes[1].plant, 'apple', 'other members’ notes are untouched');
assert.strictEqual(updateMemberPlant(g2, 999, 'rose'), 0, 'a member with no notes updates nothing');

// v5.9: save the garden to disk — MULTIPLE gardens, one per group, all
// preserved. Serialize to JSON, deserialize back, and the gardens come
// back identical (members as a Set again, notes with their plants).
const store3 = createGardenStore();
addGardenNote(store3, '-100123', 111, { id: 'm-1', text: 'soup', time: '09:00', shareable: true, date: today, plant: 'mango' });
addGardenNote(store3, '-100123', 222, { id: 'm-2', text: 'walk', time: '10:00', shareable: true, date: today, plant: 'mushroom' });
addGardenNote(store3, '-100456', 333, { id: 'm-3', text: 'sun', time: '11:00', shareable: true, date: today, plant: 'apple' });
getGarden(store3, '-100123').title = 'Family Chat';
getGarden(store3, '-100456').title = 'Work Friends';
const json = JSON.stringify(serializeGardens(store3));
const restored = deserializeGardens(JSON.parse(json));
assert.strictEqual(restored.size, 2, 'both gardens survive a save/load round-trip');
const r1 = restored.get('-100123');
assert.strictEqual(r1.title, 'Family Chat', 'the garden title survives');
assert.ok(r1.members instanceof Set, 'members come back as a Set');
assert.ok(r1.members.has(111) && r1.members.has(222), 'both members survive');
assert.strictEqual(r1.notes.length, 2, 'both notes survive');
assert.strictEqual(r1.notes[0].plant, 'mango', 'the mango note keeps its plant');
assert.strictEqual(r1.notes[1].plant, 'mushroom', 'the mushroom note keeps its plant');
assert.strictEqual(r1.date, today, 'the garden date survives');
const r2 = restored.get('-100456');
assert.strictEqual(r2.title, 'Work Friends', 'the second garden survives too');
assert.strictEqual(r2.notes[0].plant, 'apple', 'the second garden’s note survives');
// A garden with no notes still round-trips (the group is still known).
const store4 = createGardenStore();
getGarden(store4, '-100789').title = 'Empty Group';
assert.strictEqual(deserializeGardens(JSON.parse(JSON.stringify(serializeGardens(store4)))).get('-100789').title, 'Empty Group', 'an empty garden survives');
// Garbage in, empty store out — a corrupt file must never crash startup.
assert.strictEqual(deserializeGardens(null).size, 0, 'null input gives an empty store');
assert.strictEqual(deserializeGardens('nope').size, 0, 'a non-object gives an empty store');
assert.strictEqual(deserializeGardens({}).size, 0, 'an empty object gives an empty store');

console.log('garden: all garden store tests pass (shareable only, dedup, daily reset, plant on note, save/load)');
