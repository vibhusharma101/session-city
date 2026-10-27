import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, pending, collect, levelOf, quests, progress, claim, visited } from '../public/game.js';

// Node has no localStorage, so the game state simply isn't persisted here.
const session = (id, tools, status = 'closed') => ({ id, status, tools, lastActivity: new Date().toISOString() });

test('levelOf: thresholds at 0, 120, 360, 720 xp', () => {
  assert.equal(levelOf(0).level, 1);
  assert.equal(levelOf(119).level, 1);
  assert.equal(levelOf(120).level, 2);
  assert.equal(levelOf(359).level, 2);
  assert.equal(levelOf(360).level, 3);
  assert.equal(levelOf(720).level, 4);
  assert.equal(levelOf(240).progress, 0.5);
  assert.equal(levelOf(240).toNext, 120);
});

test('every action is a coin, collected once', () => {
  const g = createGame();
  const s = session('a', { Edit: 30, Read: 20 });
  assert.equal(pending(g, s), 50);
  const first = collect(g, s);
  assert.equal(first.amount, 50);
  assert.equal(g.coins, 50);
  assert.equal(g.xp, 10, 'one XP per five actions');
  assert.equal(pending(g, s), 0);
  assert.equal(collect(g, s).amount, 0);
  s.tools.Bash = 7; // the session kept working
  assert.equal(pending(g, s), 7);
});

test('collecting enough coins levels up', () => {
  const g = createGame();
  const res = collect(g, session('big', { Edit: 600 }));
  assert.equal(g.xp, 120);
  assert.equal(res.levelUp, 2);
});

test('quests: progress, completion and a one-time claim', () => {
  const g = createGame();
  const sessions = [session('w', {}, 'waiting')];
  const list = quests(g, sessions);
  assert.deepEqual(list.map((q) => q.id), ['collect', 'visit', 'drive', 'needs']);
  assert.equal(progress(g, 'drive', 39).length, 0);
  const done = progress(g, 'drive', 5);
  assert.equal(done.length, 1);
  assert.equal(done[0].id, 'drive');
  assert.equal(quests(g, sessions).find((q) => q.id === 'drive').have, 40, 'capped at the goal');
  const reward = claim(g, 'drive');
  assert.equal(reward.reward, 30);
  assert.equal(g.coins, 30);
  assert.equal(claim(g, 'drive'), null, 'cannot claim twice');
  assert.equal(claim(g, 'visit'), null, 'cannot claim unfinished');
});

test('visiting a waiting session finishes the "needs you" quest', () => {
  const g = createGame();
  quests(g, [session('w', {}, 'waiting')]);
  const done = visited(g, session('w', {}, 'waiting'), 'uptown');
  assert.ok(done.some((q) => q.id === 'needs'));
});
