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

// v5.9: persist the garden to disk (dab, 2026-11-17 — "save the garden
// to disk"). The garden used to live only in memory, so a server restart
// (Render free tier sleeps after 15 min idle) emptied it and a plant only
// came back when its owner re-opened the app. Now the whole store —
// EVERY garden, one per group — is written to a file on every change and
// reloaded on startup, so a restart keeps the garden. A redeploy still
// wipes the file (Render resets the filesystem), and then the garden
// rebuilds from syncs as people open the app again.
// A garden record is { title, members:Set, notes:[{id,userId,plant,text,
// time,date}], date }. Sets don't survive JSON, so serializeGardens turns
// members into an array; deserializeGardens turns it back into a Set.
// Gardens from a previous day are dropped on load — the garden is daily,
// so yesterday's plants never come back after a restart.
function serializeGardens(store) {
  const out = {};
  for (const [gid, g] of store) {
    out[String(gid)] = {
      title: g.title || '',
      members: Array.from(g.members || []),
      notes: (g.notes || []).map((n) => ({ id: String(n.id), userId: n.userId, plant: String(n.plant || ''), text: String(n.text || ''), time: String(n.time || ''), date: String(n.date || '') })),
      date: String(g.date || ''),
    };
  }
  return out;
}

function deserializeGardens(raw) {
  const store = createGardenStore();
  if (!raw || typeof raw !== 'object') return store;
  for (const [gid, g] of Object.entries(raw)) {
    if (!g || typeof g !== 'object') continue;
    const garden = getGarden(store, gid);
    garden.title = String(g.title || '');
    garden.members = new Set(Array.isArray(g.members) ? g.members : []);
    garden.notes = (Array.isArray(g.notes) ? g.notes : []).map((n) => ({ id: String(n.id), userId: n.userId, plant: String(n.plant || ''), text: String(n.text || ''), time: String(n.time || ''), date: String(n.date || '') }));
    garden.date = String(g.date || '');
    // Prune notes whose date isn't the garden's own day (self-consistent,
    // timezone-independent). The day boundary itself is handled by the
    // readers: GET /api/garden and /sharerecap roll the garden to the
    // reader's/asker's day before returning it, so a garden loaded from
    // yesterday is cleared on first read today, not served stale.
    pruneGarden(garden);
  }
  return store;
}

module.exports = { createGardenStore, getGarden, rolloverGarden, pruneGarden, addGardenNote, updateMemberPlant, serializeGardens, deserializeGardens };
