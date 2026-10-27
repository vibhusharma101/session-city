// The farm-sim layer: every action an agent takes earns a coin you collect from
// its building; coins give XP, XP gives levels, levels unlock cars. Daily quests
// nudge you around the city. All of it lives in this browser's localStorage.
import { store } from './util.js';

const KEY = 'sc.game';
const today = () => new Date().toISOString().slice(0, 10);

export const actionsOf = (s) => Object.values(s.tools || {}).reduce((a, b) => a + b, 0);

export function createGame() {
  const g = store.json(KEY, null) ?? { coins: 0, xp: 0, collected: {}, quests: null, visited: [] };
  g.collected ??= {};
  return g;
}
const save = (g) => store.setJson(KEY, g);

// ---------- coins & levels ----------
export const pending = (g, s) => Math.max(0, actionsOf(s) - (g.collected[s.id] ?? 0));

export function levelOf(xp) {
  // level n needs 60·n·(n−1) xp in total: 0, 120, 360, 720, …
  let n = 1;
  while (60 * (n + 1) * n <= xp) n++;
  const lo = 60 * n * (n - 1), hi = 60 * (n + 1) * n;
  return { level: n, progress: (xp - lo) / (hi - lo), toNext: hi - xp };
}

export function collect(g, s) {
  const amount = pending(g, s);
  if (!amount) return { amount: 0 };
  const before = levelOf(g.xp).level;
  g.collected[s.id] = actionsOf(s);
  g.coins += amount;
  g.xp += Math.ceil(amount / 5); // one XP per five actions, so levels stay earned
  const done = progress(g, 'collect', 1);
  save(g);
  return { amount, done, levelUp: levelOf(g.xp).level > before ? levelOf(g.xp).level : 0 };
}

// ---------- daily quests ----------
const QUESTS = {
  collect: { text: 'Collect coins from 3 buildings', goal: 3, reward: 50, icon: '🪙' },
  visit:   { text: 'Go inside 2 buildings', goal: 2, reward: 40, icon: '🚪' },
  drive:   { text: 'Drive 40 blocks', goal: 40, reward: 30, icon: '🚗' },
  needs:   { text: 'Answer a session that needs you', goal: 1, reward: 80, icon: '❗' },
  live:    { text: 'Check on a live session', goal: 1, reward: 40, icon: '⚡' },
  story:   { text: 'Read the story of a session', goal: 1, reward: 30, icon: '📖' },
  oldtown: { text: 'Explore a building in Old Town', goal: 1, reward: 35, icon: '🏚️' },
};

export function quests(g, sessions) {
  if (g.quests?.day !== today()) {
    const pick = ['collect', 'visit', 'drive'];
    // a session that needs you always wins; otherwise rotate the fourth quest by day
    const extra = ['story'];
    if (sessions.some((s) => s.status !== 'closed')) extra.push('live');
    if (sessions.some((s) => Date.now() - Date.parse(s.lastActivity) >= 7 * 864e5)) extra.push('oldtown');
    const dayNumber = Math.floor(Date.now() / 864e5);
    pick.push(sessions.some((s) => s.status === 'waiting') ? 'needs' : extra[dayNumber % extra.length]);
    g.quests = { day: today(), list: pick.map((id) => ({ id, have: 0, claimed: false })) };
    save(g);
  }
  return g.quests.list.map((q) => ({ ...q, ...QUESTS[q.id], done: q.have >= QUESTS[q.id].goal }));
}

// Returns the quests that just became complete.
export function progress(g, id, amount = 1) {
  const q = g.quests?.list.find((x) => x.id === id);
  if (!q || q.claimed) return [];
  const was = q.have >= QUESTS[id].goal;
  q.have = Math.min(QUESTS[id].goal, q.have + amount);
  save(g);
  return !was && q.have >= QUESTS[id].goal ? [{ ...q, ...QUESTS[id] }] : [];
}

export function claim(g, id) {
  const q = g.quests?.list.find((x) => x.id === id);
  if (!q || q.claimed || q.have < QUESTS[id].goal) return null;
  const before = levelOf(g.xp).level;
  q.claimed = true;
  g.coins += QUESTS[id].reward;
  g.xp += QUESTS[id].reward;
  save(g);
  return { reward: QUESTS[id].reward, levelUp: levelOf(g.xp).level > before ? levelOf(g.xp).level : 0 };
}

export function visited(g, s, colony) {
  const done = [...progress(g, 'visit', 1)];
  if (s.status === 'waiting') done.push(...progress(g, 'needs', 1));
  if (s.status !== 'closed') done.push(...progress(g, 'live', 1));
  if (colony === 'oldtown') done.push(...progress(g, 'oldtown', 1));
  return done;
}

