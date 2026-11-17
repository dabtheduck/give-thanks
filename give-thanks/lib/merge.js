// Give Thanks — merge the app's snapshot with bot-logged thanks (v5).
// Pure function, unit-tested in lib/merge.test.js.
//
// The app is the source of truth for its own presses, but /thanks typed
// in the bot chat lives on the server until the app opens and picks it
// up (dab confirmed the merge, 2026-11-17). Merge rules:
// - The app snapshot (count + notes) is authoritative for app presses.
// - pendingBot entries the app has already adopted (their id is in
//   mergedBotIds, sent by the app after merging) are dropped — the app's
//   snapshot already contains them.
// - Remaining pendingBot entries are added on top: +1 count each, and
//   note entries join the notes list (origin 'bot').
// - Deleting a note in the app never resurrects it: an adopted-then-
//   deleted bot note is in mergedBotIds (dropped here) and absent from
//   the snapshot (not re-added).
function mergeSync(appToday, pendingBot, mergedBotIds) {
  const adopted = new Set(Array.isArray(mergedBotIds) ? mergedBotIds.map(String) : []);
  const remaining = (Array.isArray(pendingBot) ? pendingBot : []).filter((e) => e && e.id && !adopted.has(String(e.id)));
  const notes = Array.isArray(appToday.notes) ? appToday.notes.slice() : [];
  for (const e of remaining) {
    if (e.text) notes.push({ text: String(e.text).slice(0, 140), time: String(e.time || ''), shareable: false, id: String(e.id), origin: 'bot' });
  }
  return {
    today: {
      version: 5,
      date: String(appToday.date || ''),
      count: Number(appToday.count || 0) + remaining.length,
      notes,
    },
    remainingPending: remaining,
  };
}

module.exports = { mergeSync };
