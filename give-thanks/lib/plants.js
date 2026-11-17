// Give Thanks — garden plant species (v5).
// 10 designs. Each member picks one per group garden to represent
// themselves. No names in the garden — the plant IS the identity
// (somewhat anonymous, but not entirely). A member who hasn't picked
// yet gets a deterministic default from their user id, so the garden
// is varied from the first shared thanks.
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

// FNV-1a, tiny and deterministic — the same input always gives the same
// number. Used for default plants and for stable note ids. The Mini App
// duplicates this function (it can't require server code); keep them in sync.
function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function defaultPlantFor(userId) {
  return PLANTS[hashStr(String(userId)) % PLANTS.length];
}

module.exports = { PLANTS, plantById, defaultPlantFor, hashStr };
