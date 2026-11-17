// Give Thanks — garden plant species (v5, random fallback in v5.3).
// 10 designs. Each member picks one per group garden to represent
// themselves. No names in the garden — the plant IS the identity
// (somewhat anonymous, but not entirely). A member who hasn't picked
// yet gets a random plant (dab, 2026-11-17), assigned once and saved,
// so it sticks instead of changing on every load.
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

module.exports = { PLANTS, plantById, randomPlant };
