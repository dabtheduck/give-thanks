// Give Thanks — themes.js
// Modular themes. To add a theme in the future, add ONE entry here. No core changes.
// Each theme is just CSS variables. The app sets document.documentElement.dataset.theme.
// Default is locked to cream + forest (dab, 17 Nov 2026).
const THEMES = {
  'cream-forest': {
    name: 'Cream + Forest',
    description: 'Default. Warm cream, forest green, burnt orange, burnt sienna accent.',
    vars: { '--cream': '#FFF6E5', '--charcoal': '#2B2B2B', '--forest': '#4A7C59', '--sage': '#A8C3A0', '--orange': '#D97B29', '--sienna': '#A0522D', '--stone': '#8A8A8A', '--wood': '#7A5230' },
  },
  // Future examples — add them here when ready, they appear automatically in Settings.
  // 'forest-night': {
  //   name: 'Forest Night',
  //   description: 'Dark cozy version.',
  //   vars: { '--cream': '#1E2A22', '--charcoal': '#F2EAD8', '--forest': '#7FB069', '--sage': '#3A5A40', '--orange': '#E07A2A', '--stone': '#9AA5A0', '--wood': '#8A6A4A' },
  // },
};

function applyTheme(name) {
  const theme = THEMES[name] || THEMES['cream-forest'];
  const root = document.documentElement;
  root.dataset.theme = name in THEMES ? name : 'cream-forest';
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  try { localStorage.setItem('gt_theme', root.dataset.theme); } catch {}
  return theme;
}
function listThemes() { return Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name, description: t.description })); }

// Browser global for the Mini App, Node export for tests.
if (typeof window !== 'undefined') { window.GiveThanksThemes = { THEMES, applyTheme, listThemes }; }
if (typeof module !== 'undefined') module.exports = { THEMES, applyTheme, listThemes };
