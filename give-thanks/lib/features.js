// Give Thanks — lib/features.js
// Feature flags + registry. New features register here, core never imports them directly.
// A flag off must behave exactly like v1.0.
const FEATURES = {
  gardenWeeklyShare: { default: false, description: 'Weekly anonymous garden share' },
  newRecapFormat: { default: false, description: 'New recap format (opt-in, v2)' },
  shareOutsideTelegram: { default: true, description: 'Share today outside Telegram as text or pixel-art image, per-note blur' },
  // Add v2 features here, e.g.:
  // photoNotes: { default: false, description: 'Photo notes' },
};

function isEnabled(user, name) {
  const def = FEATURES[name];
  if (!def) return false; // unknown features are off, never crash
  const flags = user?.features || user?.settings?.features || {};
  if (typeof flags[name] === 'boolean') return flags[name];
  return def.default;
}

function registerFeature(name, def) {
  if (FEATURES[name]) throw new Error(`feature already registered: ${name}`);
  FEATURES[name] = def;
}

function listFeatures() { return Object.keys(FEATURES); }

module.exports = { FEATURES, isEnabled, registerFeature, listFeatures };
