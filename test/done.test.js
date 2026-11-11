import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finished, justFinished, pruneSeen, DONE_WINDOW } from '../public/done.js';

const now = Date.parse('2026-11-11T12:00:00Z');
const ago = (min) => new Date(now - min * 60e3).toISOString();
const s = (id, status, min) => ({ id, status, lastActivity: ago(min) });

test('recently finished open sessions, newest first, at most two', () => {
  const list = [s('a', 'open', 30), s('b', 'open', 2), s('c', 'open', 10), s('d', 'working', 1), s('e', 'waiting', 1), s('f', 'closed', 1)];
  assert.deepEqual(finished(list, {}, now).map((x) => x.id), ['b', 'c']);
});

test('old ones are not news', () => {
  assert.deepEqual(finished([s('a', 'open', DONE_WINDOW / 60e3 + 1)], {}, now), []);
});

test('a session you have looked at stays quiet until it finishes again', () => {
  const a = s('a', 'open', 5);
  assert.deepEqual(finished([a], { a: a.lastActivity }, now), []);
  const later = { ...a, lastActivity: ago(1) }; // you prompted it again and it finished again
  assert.deepEqual(finished([later], { a: a.lastActivity }, now).map((x) => x.id), ['a']);
});

test('justFinished catches working → open between polls', () => {
  const before = new Map([['a', 'working'], ['b', 'open'], ['c', 'working']]);
  const after = [s('a', 'open', 0), s('b', 'open', 0), s('c', 'waiting', 0)];
  assert.deepEqual(justFinished(before, after).map((x) => x.id), ['a']);
});

test('pruneSeen forgets sessions too old to highlight', () => {
  const seen = { a: 'x', b: 'y', gone: 'z' };
  assert.deepEqual(Object.keys(pruneSeen(seen, [s('a', 'open', 5), s('b', 'closed', 500)], now)), ['a']);
});
