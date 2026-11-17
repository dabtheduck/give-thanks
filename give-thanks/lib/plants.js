// Give Thanks — garden plant species (v5, random fallback in v5.3).
// 20 designs (v5.8: 10 fruits added, dab 2026-11-17 — "add some fruits/
// other plants (just no eggplants)"). Each member picks one per group
// garden to represent themselves. No names in the garden — the plant IS
// the identity (somewhat anonymous, but not entirely). A member who hasn't
// picked yet gets a random plant (dab, 2026-11-17), assigned once and
// saved, so it sticks instead of changing on every load.
const PLANTS = [
  { id: 'sunflower', emoji: '🌻', name: 'Sunflower' },
  { id: 'tulip', emoji: '🌷', name: 'Tulip' },
  { id: 'rose', emoji: '🌹', name: 'Rose' },
  { id: 'daisy', emoji: '🌼', name: 'Daisy' },
  { id: 'cactus', emoji: '🌵', name: 'Cactus' },
  { id: 'fern', emoji: '🌿', name: 'Fern' },
  { id: 'mushroom', emoji: '🍄', name: 'Mushroom' },
  { id: 'clover', emoji: '🍀', name: 'Clover' },
  { id: 'bamboo', emoji: '🎋', name: 'Bamboo' },
  { id: 'hyacinth', emoji: '🪻', name: 'Hyacinth' },
  // v5.8 fruits — no eggplant (dab, 2026-11-17).
  { id: 'apple', emoji: '🍎', name: 'Apple' },
  { id: 'strawberry', emoji: '🍓', name: 'Strawberry' },
  { id: 'cherry', emoji: '🍒', name: 'Cherry' },
  { id: 'peach', emoji: '🍑', name: 'Peach' },
  { id: 'grapes', emoji: '🍇', name: 'Grapes' },
  { id: 'lemon', emoji: '🍋', name: 'Lemon' },
  { id: 'orange', emoji: '🍊', name: 'Orange' },
  { id: 'pineapple', emoji: '🍍', name: 'Pineapple' },
  { id: 'mango', emoji: '🥭', name: 'Mango' },
  { id: 'watermelon', emoji: '🍉', name: 'Watermelon' },
];

function plantById(id) {
  return PLANTS.find((p) => p.id === id) || null;
}

// A random plant, for the fallback when a member hasn't picked one yet.
// The server saves the pick the first time it resolves it, so the random
// plant sticks (a fresh random pick on every read would reshuffle the
// garden each time it loads).
function randomPlant() {
  return PLANTS[Math.floor(Math.random() * PLANTS.length)];
}

// v5.8: a random plant that isn't already taken in this garden (unique
// fallback, dab 2026-11-17). `taken` is a Set (or array) of plant ids
// already used in the garden. If every plant is taken, fall back to any
// random plant — duplicates are unavoidable then.
function randomPlantExcluding(taken) {
  const takenSet = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : []);
  const free = PLANTS.filter((p) => !takenSet.has(p.id));
  if (!free.length) return randomPlant();
  return free[Math.floor(Math.random() * free.length)];
}

module.exports = { PLANTS, plantById, randomPlant, randomPlantExcluding };
