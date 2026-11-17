// Give Thanks — recap / share text builders (v5). Pure functions, no
// Telegram, no Express, so they can be unit-tested directly.
// Moved out of server.js so the formats are tested, not just eyeballed.
//
// formatRecap (dab, 2026-11-17):
// - Empty day: "No thanks logged today yet."
// - Day with thanks: the v1 structure (header, count, numbered notes)
//   MINUS the last line "A fresh day starts now. No backlog, no guilt."
//   That line only ever appeared when there WERE thanks, so removing it
//   "if there's a thanks in the recap" means it never appears.
// The v2 opt-in newRecapFormat flag branch is kept as-is (it never had
// the line).
const { isEnabled } = require('./features');

// displayDate: dates are stored and compared as YYYY-MM-DD (it sorts
// and compares correctly), but people read DD-MM-YYYY (dab, 2026-11-17).
// Convert an ISO date for display; anything that isn't YYYY-MM-DD is
// left alone (e.g. a test label like "Mon 17 Nov 2026").
function displayDate(label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(label || ''));
  if (!m) return String(label || '');
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function formatRecap(user, dateLabel) {
  // Notes with no text yet (a bare press — the note can be added later)
  // have nothing to list, so they are left out of the list. The count
  // still includes them: they are real presses.
  const n = ((user.today && user.today.notes) || []).filter((note) => String(note.text || '').trim().length > 0);
  const count = (user.today && user.today.count) || 0;
  const date = displayDate(dateLabel);
  if (isEnabled(user, 'newRecapFormat')) {
    const lines = [`🌱 Give Thanks — ${date}`, ``, `${count} thanks today.`, ``];
    n.forEach((note) => lines.push(`• ${note.text}`));
    return lines.join('\n');
  }
  if (!count && n.length === 0) {
    return `🌱 Give Thanks — ${date}\n\nNo thanks logged today yet.`;
  }
  const lines = [`🌱 Give Thanks — ${date}`, ``, `You said thanks ${count} time${count === 1 ? '' : 's'} today.`, ``];
  n.forEach((note, i) => lines.push(`${i + 1}. ${note.time || ''} — ${note.text}`));
  return lines.join('\n');
}

// buildShareText: the share version — ticked notes shown, unticked as
// "••• hidden •••", total count stays true. Notes with no text yet are
// left out entirely (nothing to share or hide). Same format as the app's
// buildShareText in public/app.js; keep the two in sync.
function buildShareText(today, dateLabel) {
  const notes = ((today && today.notes) || []).filter((n) => String(n.text || '').trim().length > 0);
  const count = (today && today.count) || 0;
  const lines = ['🌱 Give Thanks — ' + displayDate(dateLabel), '', 'I said thanks ' + count + ' time' + (count === 1 ? '' : 's') + ' today.', ''];
  notes.forEach((n, i) => lines.push((i + 1) + '. ' + (n.shareable ? n.text : '••• hidden •••')));
  return lines.join('\n');
}

// staleNotice: /thanks typed in the bot chat lives on the server until
// the app opens and picks it up. /recap and /share read the server's
// copy, which may be missing the app's latest presses, so when there
// are unmerged bot-logged thanks, say so: open the app first, then ask
// again (dab, 2026-11-17).
function staleNotice(command) {
  return `🌱 Heads up — you logged thanks here that the app hasn't picked up yet. Open Give Thanks first, then type /${command} again for the full list.`;
}

// notSyncedNotice: the server's copy is empty because the app hasn't
// synced today yet (not because the day is empty). Tell the user to
// open the app so it syncs, then ask again (dab, 2026-11-17). No Upstash
// or durable store needed — the server just tracks the last sync day.
function notSyncedNotice(command) {
  return `🌱 I don't have today's list yet — open Give Thanks and it'll sync, then type /${command} again.`;
}

// recapStatus: what the server knows about a user's today, for /recap
// and /share. 'has-thanks' = there is something to show. 'empty' = the
// app synced today and the day really is empty. 'not-synced' = the app
// hasn't synced today at all, so an empty server copy proves nothing —
// say so instead of claiming the day is empty.
function recapStatus(user, dayStr) {
  const today = (user && user.today) || {};
  const count = Number(today.count || 0);
  const notes = Array.isArray(today.notes) ? today.notes : [];
  if (count > 0 || notes.length > 0) return 'has-thanks';
  if (user && user.lastSyncDate === dayStr) return 'empty';
  return 'not-synced';
}

module.exports = { formatRecap, buildShareText, staleNotice, notSyncedNotice, recapStatus, displayDate };
