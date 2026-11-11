import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place, overlaps } from '../public/place.js';

const box = (l, t, w = 100, h = 20) => ({ l, r: l + w, t, b: t + h });
const ids = (shown) => shown.map((s) => s.c.id);

test('higher priority wins a clash; the loser is dropped', () => {
  const shown = place([
    { id: 'low', box: box(0, 100), pri: 1 },
    { id: 'high', box: box(50, 105), pri: 9 },
  ]);
  assert.deepEqual(ids(shown), ['high']);
});

test('labels that do not touch are all shown', () => {
  const shown = place([
    { id: 'a', box: box(0, 100), pri: 1 },
    { id: 'b', box: box(300, 100), pri: 1 },
  ]);
  assert.deepEqual(ids(shown).sort(), ['a', 'b']);
});

test('a forced label beats a higher-ranked ordinary one', () => {
  const shown = place([
    { id: 'district', box: box(0, 100), pri: 1100 },
    { id: 'needs-you', box: box(10, 100), pri: 900, force: true },
  ]);
  assert.deepEqual(ids(shown), ['needs-you']);
});

test('forced labels stack instead of overlapping', () => {
  const shown = place([
    { id: 'a', box: box(0, 100), pri: 900, force: true },
    { id: 'b', box: box(10, 102), pri: 900, force: true },
    { id: 'c', box: box(20, 104), pri: 900, force: true },
  ]);
  assert.equal(shown.length, 3);
  const boxes = shown.map(({ c, dy }) => ({ ...c.box, t: c.box.t + dy, b: c.box.b + dy }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    assert.equal(overlaps(boxes[i], boxes[j]), false, `${i} and ${j} overlap`);
  }
  assert.ok(shown.slice(1).every((s) => s.dy < 0), 'later ones climb upwards');
});

test('dir: 1 stacks downwards', () => {
  const shown = place([
    { id: 'a', box: box(0, 100), pri: 950, force: true, dir: 1 },
    { id: 'b', box: box(0, 100), pri: 950, force: true, dir: 1 },
  ]);
  assert.ok(shown[1].dy > 0);
});

test('reserved areas keep ordinary labels out but not forced ones', () => {
  const bar = [box(0, 0, 1000, 60)];
  const shown = place([
    { id: 'ordinary', box: box(0, 40), pri: 5000 },
    { id: 'forced', box: box(300, 40), pri: 1, force: true },
  ], bar);
  assert.deepEqual(ids(shown), ['forced']);
});

// which sessions get a tag, and how much it says
const { Labels } = await import('../public/labels.js');
const pinFor = (status, { coins = 0, dist = 100, selected = false } = {}) => {
  const rec = { s: { status, title: 'A session' } };
  const city = { selected: selected ? rec : null, hover: null };
  return new Labels(null, city, { select() {}, coins: () => coins }).pinState(rec, dist);
};

test('zoomed out, quiet closed sessions get no tag; ones that need you always do', () => {
  assert.equal(pinFor('closed'), null);
  assert.equal(pinFor('open'), null);
  assert.ok(pinFor('waiting').force);
  assert.ok(pinFor('working'));
  assert.ok(pinFor('closed', { coins: 40 }), 'uncollected coins earn a tag');
});

test('up close every session gets its title', () => {
  for (const s of ['closed', 'open', 'working', 'waiting']) assert.equal(pinFor(s, { dist: 20 }).full, true);
  assert.equal(pinFor('working', { dist: 100 }).full, false);
});

test('the selected session outranks everything and always shows', () => {
  const sel = pinFor('closed', { selected: true });
  assert.ok(sel.force && sel.full && sel.pri > pinFor('waiting').pri);
});
