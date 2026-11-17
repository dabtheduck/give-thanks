// Give Thanks — announcements (v5.2).
// /send_announcement lets the bot owner update every user about new
// things. Announcements go to 1:1 chats only (dab, 2026-11-17) — people
// who use the bot in a group already have a 1:1 chat with it, so there's
// no need to post in groups.
function formatAnnouncement(text) {
  return `🌱 Give Thanks — update\n\n${String(text || '').trim()}`;
}

// Recipients: every known user's 1:1 chat id, deduped, skipping records
// with no chat id. `users` is the server's users Map (id -> user record).
function collectRecipients(users) {
  const ids = new Set();
  if (!users) return [];
  for (const u of users.values()) {
    if (u && u.chatId) ids.add(String(u.chatId));
  }
  return [...ids];
}

module.exports = { formatAnnouncement, collectRecipients };
