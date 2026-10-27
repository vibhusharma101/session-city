import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout, colonyOf, drivable, findPath } from '../public/layout.js';

const DAY = 864e5;
let n = 0;
const session = (ageDays, status = 'closed') => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  status,
  lastActivity: new Date(Date.now() - ageDays * DAY).toISOString(),
});

test('colonyOf: live or today is Uptown, this week Midtown, older Old Town', () => {
  assert.equal(colonyOf(session(30, 'working')), 'uptown');
  assert.equal(colonyOf(session(0.5)), 'uptown');
  assert.equal(colonyOf(session(3)), 'midtown');
  assert.equal(colonyOf(session(8)), 'oldtown');
});

test('buildLayout puts every session on its own lot, inside its colony', () => {
  const districts = [
    { name: 'api', list: [session(0, 'working'), session(2), session(20), session(21), session(22)] },
    { name: 'web', list: [session(0.2), session(9)] },
  ];
  const L = buildLayout(districts);
  assert.equal(L.buildings.length, 7);
  const lots = new Set(L.buildings.map((b) => `${b.gx},${b.gy}`));
  assert.equal(lots.size, 7, 'no two buildings share a lot');
  for (const b of L.buildings) {
    assert.equal(L.tiles[b.gy * L.W + b.gx], 2);
    assert.equal(b.colony, colonyOf(b.s));
    const c = L.colonies.find((x) => x.id === b.colony);
    assert.ok(b.gx > c.ox && b.gx < c.ox + c.w, 'building sits inside its colony walls');
  }
  assert.deepEqual(L.colonies.map((c) => c.id), ['uptown', 'midtown', 'oldtown']);
  assert.equal(L.gates.length, 3);
});

test('neighbouring buildings never touch (a garden tile between them)', () => {
  const L = buildLayout([{ name: 'big', list: Array.from({ length: 9 }, () => session(10)) }]);
  for (const a of L.buildings) for (const b of L.buildings) {
    if (a === b) continue;
    assert.ok(Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) >= 2);
  }
});

test('the car can reach every building from the avenue', () => {
  const L = buildLayout([
    { name: 'a', list: [session(0, 'waiting'), session(1)] },
    { name: 'b', list: [session(4), session(5), session(6)] },
    { name: 'c', list: Array.from({ length: 9 }, () => session(40)) },
  ]);
  const start = [L.colonies[0].gateX + 0.5, L.avenue + 0.5];
  assert.ok(drivable(L, Math.floor(start[0]), Math.floor(start[1])));
  for (const b of L.buildings) {
    const path = findPath(L, ...start, b);
    const [x, y] = path.at(-1) ?? start;
    // parks on the road tile nearest the lot (lots in big blocks can be 3 tiles in)
    assert.ok(Math.abs(Math.floor(x) - b.gx) + Math.abs(Math.floor(y) - b.gy) <= 3, `reach ${b.gx},${b.gy}`);
    for (const [px, py] of path) assert.ok(drivable(L, Math.floor(px), Math.floor(py)), 'path stays on roads');
  }
});

test('an empty city still has an avenue to drive on', () => {
  const L = buildLayout([]);
  assert.equal(L.buildings.length, 0);
  assert.ok(drivable(L, 1, L.avenue));
});
