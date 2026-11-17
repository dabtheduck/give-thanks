// Run: node lib/plants.test.js
// Tests the v5 garden plant species (dab, 2026-11-17): 10 designs, one
// per member per group garden; a member who hasn't picked gets a
// deterministic default from their user id.
const assert = require('assert');
const { PLANTS, plantById, defaultPlantFor } = require('./plants');

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

// Default plant is deterministic: same user, same plant, every time.
const a = defaultPlantFor(123456789);
const b = defaultPlantFor(123456789);
assert.strictEqual(a.id, b.id);
assert.ok(plantById(a.id), 'default plant must be one of the 10');
// Different users get a spread of plants, not all the same one.
const spread = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((id) => defaultPlantFor(id).id));
assert.ok(spread.size > 1, 'defaults should vary across users');

console.log('plants: all plant tests pass (10 designs, deterministic defaults)');
