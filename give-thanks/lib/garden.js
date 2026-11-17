// Give Thanks — group garden store (v5.1).
// The garden is a DAILY garden (dab, 2026-11-17): it grows during the
// day and resets at 03:00 with the counter. One plant per shared note,
// no names, only shareable notes. In-memory only — a restart/redeploy
// empties it and it rebuilds from syncs, but since it resets every day
// anyway, a redeploy just resets it early (no lost week of plants).
// A garden record carries the day it belongs to (date, YYYY-MM-DD, the
// sharer's app-day). When a note (or a reader) from a different day
// arrives, the garden rolls over to that day first.
function createGardenStore() {
  return new Map(); // groupId -> { title, members:Set<userId>, notes:[{id,userId,text,time,date}], date:'' }
}

function getGarden(store, groupId) {
  const gid = String(groupId);
  if (!store.has(gid)) store.set(gid, { title: '', members: new Set(), notes: [], date: '' });
  return store.get(gid);
}

// Roll the garden to a new day: if it belongs to a different day, clear
// it and start the new day. Returns true if it rolled.
function rolloverGarden(g, dayStr) {
  const day = String(dayStr || '');
  if (!day) return false;
  if (g.date && g.date !== day) { g.notes = []; g.date = day; return true; }
  if (!g.date) g.date = day;
  return false;
}

// Safety net: drop notes whose date isn't the garden's current day.
function pruneGarden(g) {
  if (!g.date) return;
  g.notes = g.notes.filter((n) => String(n.date || '') === g.date);
}

function addGardenNote(store, gardenId, userId, note) {
  const g = getGarden(store, gardenId);
  g.members.add(userId);
  if (!note || !note.shareable || !note.id) return;
  if (note.date) rolloverGarden(g, String(note.date));
  if (g.notes.some((n) => n.id === note.id)) return; // dedup by note id
  // v5.8: the plant is stored ON the note when it's planted, so a note's
  // plant never reshuffles at read time. `note.plant` is the author's
  // plant id at sync time (the server passes it in); if it's missing or
  // invalid, the reader resolves it via plantFor and the GET handler
  // backfills it. When the author changes plant, updateMemberPlant
  // rewrites their notes so the plant still represents them.
  g.notes.push({ id: String(note.id), userId, plant: String(note.plant || ''), text: String(note.text || '').slice(0, 140), time: String(note.time || ''), date: String(note.date || g.date || '') });
  if (g.notes.length > 200) g.notes = g.notes.slice(-200);
  pruneGarden(g);
}

// v5.8: when a member changes their plant, rewrite their notes in this
// garden to the new plant, so the plant still represents them. Returns
// how many notes were updated.
function updateMemberPlant(g, userId, plantId) {
  let n = 0;
  for (const note of g.notes) {
    if (String(note.userId) === String(userId)) { note.plant = String(plantId); n += 1; }
  }
  return n;
}

module.exports = { createGardenStore, getGarden, rolloverGarden, pruneGarden, addGardenNote, updateMemberPlant };
