// Run: node lib/plants.test.js
// Tests the v5 garden plant species (dab, 2026-11-17): 10 designs, one
// per member per group garden; a member who hasn't picked gets a random
// fallback plant (v5.3 — was a deterministic default from their user id).
const assert = require('assert');
const { PLANTS, plantById, randomPlant } = require('./plants');

assert.strictEqual(PLANTS.length, 10, 'exactly 10 plant designs');
const ids = new Set(PLANTS.map((p) => p.id));
assert.strictEqual(ids.size, 10, 'plant ids must be unique');
const emojis = new Set(PLANTS.map((p) => p.emoji));
assert.strictEqual(emojis.size, 10, 'plant emojis must be unique');
for (const p of PLANTS) {
  assert.ok(p.id && p.emoji && p.name, 'every plant needs id, emoji and name');
}

assert.strictEqual(plantById('sunflower').emoji, '🌻');
assert.strictEqual(plantById('nope'), null);

// Random fallback: always one of the 10, and varied across calls
// (not the same plant for everyone).
assert.ok(plantById(randomPlant().id), 'random plant must be one of the 10');
const spread = new Set(Array.from({ length: 30 }, () => randomPlant().id));
assert.ok(spread.size > 1, 'random fallback should vary, not give everyone the same plant');

console.log('plants: all plant tests pass (10 designs, random fallback)');
