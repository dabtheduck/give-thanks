// Run: node lib/plants.test.js
// Tests the v5 garden plant species (dab, 2026-11-17): 20 designs (v5.8
// added 10 fruits — no eggplant), one per member per group garden; a
// member who hasn't picked gets a random fallback plant (v5.3 — was a
// deterministic default from their user id). v5.8: the fallback is unique
// — it avoids plants already taken in the garden.
const assert = require('assert');
const { PLANTS, plantById, randomPlant, randomPlantExcluding } = require('./plants');

assert.strictEqual(PLANTS.length, 20, 'exactly 20 plant designs');
const ids = new Set(PLANTS.map((p) => p.id));
assert.strictEqual(ids.size, 20, 'plant ids must be unique');
const emojis = new Set(PLANTS.map((p) => p.emoji));
assert.strictEqual(emojis.size, 20, 'plant emojis must be unique');
for (const p of PLANTS) {
  assert.ok(p.id && p.emoji && p.name, 'every plant needs id, emoji and name');
}
// No eggplant, ever (dab, 2026-11-17).
assert.ok(!PLANTS.some((p) => p.id === 'eggplant' || p.emoji === '🍆'), 'no eggplant');

assert.strictEqual(plantById('sunflower').emoji, '🌻');
assert.strictEqual(plantById('apple').emoji, '🍎');
assert.strictEqual(plantById('nope'), null);

// Random fallback: always one of the 20, and varied across calls
// (not the same plant for everyone).
assert.ok(plantById(randomPlant().id), 'random plant must be one of the 20');
const spread = new Set(Array.from({ length: 30 }, () => randomPlant().id));
assert.ok(spread.size > 1, 'random fallback should vary, not give everyone the same plant');

// Unique fallback: never returns a taken plant while a free one exists.
const taken = new Set(['sunflower', 'tulip', 'rose', 'apple', 'mango']);
for (let i = 0; i < 50; i++) {
  const p = randomPlantExcluding(taken);
  assert.ok(!taken.has(p.id), 'unique fallback must avoid taken plants');
  assert.ok(plantById(p.id), 'unique fallback must be a real plant');
}
// When every plant is taken, it falls back to any plant (duplicates
// unavoidable) rather than crashing.
const allTaken = new Set(PLANTS.map((p) => p.id));
assert.ok(plantById(randomPlantExcluding(allTaken).id), 'all-taken fallback still returns a plant');
// An empty / missing taken set behaves like plain random.
assert.ok(plantById(randomPlantExcluding().id), 'no taken set is fine');
assert.ok(plantById(randomPlantExcluding([]).id), 'empty taken array is fine');

console.log('plants: all plant tests pass (20 designs, no eggplant, unique random fallback)');
