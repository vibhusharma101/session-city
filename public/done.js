// "Just finished": a session whose Claude Code is still open but has stopped
// working, recently, and that you haven't looked at since. These are the ones
// whose terminal tab you probably want to check next. Kept free of the DOM so
// it can be tested.

export const DONE_WINDOW = 2 * 3600e3; // older than this isn't news any more
export const DONE_MAX = 2;             // highlight at most this many

// `seen` maps session id → the lastActivity you had seen it at.
export function finished(sessions, seen, now = Date.now()) {
  return sessions
    .filter((s) => s.status === 'open' && now - Date.parse(s.lastActivity) < DONE_WINDOW && seen[s.id] !== s.lastActivity)
    .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity))
    .slice(0, DONE_MAX);
}

// Sessions that went from working to open between two polls: they finished
// while you were watching.
export function justFinished(before, sessions) {
  return sessions.filter((s) => s.status === 'open' && before.get(s.id) === 'working');
}

// Drops remembered sessions that can't be highlighted any more, so the store stays small.
export function pruneSeen(seen, sessions, now = Date.now()) {
  const recent = new Set(sessions.filter((s) => now - Date.parse(s.lastActivity) < DONE_WINDOW).map((s) => s.id));
  return Object.fromEntries(Object.entries(seen).filter(([id]) => recent.has(id)));
}
