// Run: node lib/garden.test.js
// Tests the v5.1 daily garden store: only shareable notes enter, dedup by
// note id, and the garden resets when a new day arrives (dab, 2026-11-17:
// "let's just have the garden reset every day").
const assert = require('assert');
const { createGardenStore, getGarden, rolloverGarden, pruneGarden, addGardenNote, updateMemberPlant } = require('./garden');

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

console.log('garden: all garden store tests pass (shareable only, dedup, daily reset, plant on note)');
