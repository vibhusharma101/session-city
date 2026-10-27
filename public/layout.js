// City layout in tile space. Sessions are grouped into walled colonies by how
// recently they were used, and into project districts inside each colony.
// Tiles: 0 grass, 1 road, 2 building lot.
import { hash, rng } from './util.js';

export const COLONIES = {
  uptown:  { id: 'uptown',  name: 'Uptown',   desc: 'live or used today' },
  midtown: { id: 'midtown', name: 'Midtown',  desc: 'used this week' },
  oldtown: { id: 'oldtown', name: 'Old Town', desc: 'abandoned for a week or more' },
};
const ORDER = ['uptown', 'midtown', 'oldtown'];
const DAY = 864e5;

export function colonyOf(s, now = Date.now()) {
  const age = now - Date.parse(s.lastActivity);
  if (s.status !== 'closed' || age < DAY) return 'uptown';
  if (age < 7 * DAY) return 'midtown';
  return 'oldtown';
}

// districts: [{ name, list: sessions }]
export function buildLayout(districts) {
  const now = Date.now();
  const colonies = [];
  for (const id of ORDER) {
    const ds = districts
      .map((d) => ({ name: d.name, list: d.list.filter((s) => colonyOf(s, now) === id) }))
      .filter((d) => d.list.length)
      .sort((a, b) => b.list.length - a.list.length);
    if (!ds.length) continue;
    const B = Math.max(3, ...ds.map((d) => 2 * Math.ceil(Math.sqrt(d.list.length)) - 1));
    const cell = B + 1;
    const cols = Math.ceil(Math.sqrt(ds.length));
    const rows = Math.ceil(ds.length / cols);
    colonies.push({ id, ds, B, cell, cols, rows, w: cols * cell + 1, h: rows * cell + 1 });
  }

  // colonies side by side, an avenue along the front connecting their gates
  const GAP = 3;
  let x = 2;
  for (const c of colonies) { c.ox = x; x += c.w + GAP; }
  const W = Math.max(8, x - GAP + 2);
  const hMax = Math.max(4, ...colonies.map((c) => c.h));
  const avenue = hMax + 2;
  const H = avenue + 1;
  const tiles = new Uint8Array(W * H);
  const colonyAt = new Int8Array(W * H).fill(-1);
  const set = (tx, ty, v) => { if (tx >= 0 && ty >= 0 && tx < W && ty < H) tiles[ty * W + tx] = v; };

  for (let tx = 0; tx < W; tx++) set(tx, avenue, 1);

  const buildings = [], blocks = [], gates = [], fences = [];
  colonies.forEach((c, ci) => {
    for (let ty = 0; ty < c.h; ty++) for (let tx = 0; tx < c.w; tx++) {
      if (tx % c.cell === 0 || ty % c.cell === 0) set(c.ox + tx, ty, 1);
    }
    for (let ty = -1; ty <= c.h; ty++) for (let tx = c.ox - 1; tx <= c.ox + c.w; tx++) {
      if (tx >= 0 && ty >= 0 && tx < W && ty < H) colonyAt[ty * W + tx] = ci;
    }
    // a road from the colony's front gate down to the avenue
    c.gateX = c.ox + c.cell * Math.floor(c.cols / 2);
    for (let ty = c.h; ty < avenue; ty++) set(c.gateX, ty, 1);
    gates.push({ colony: c.id, x: c.gateX + 0.5, y: c.h + 0.5 });
    // the wall, with an opening for the gate road
    const x0 = c.ox - 0.5, x1 = c.ox + c.w + 0.5, y0 = -0.5, y1 = c.h + 0.5;
    fences.push(
      { colony: c.id, a: [x0, y0], b: [x1, y0] },
      { colony: c.id, a: [x0, y0], b: [x0, y1] },
      { colony: c.id, a: [x1, y0], b: [x1, y1] },
      { colony: c.id, a: [x0, y1], b: [c.gateX - 0.2, y1] },
      { colony: c.id, a: [c.gateX + 1.2, y1], b: [x1, y1] },
    );

    c.ds.forEach((d, i) => {
      const bx = c.ox + (i % c.cols) * c.cell + 1, by = Math.floor(i / c.cols) * c.cell + 1;
      blocks.push({ bx, by, B: c.B, name: d.name, colony: c.id });
      const n = Math.ceil(Math.sqrt(d.list.length));
      const m = Math.ceil(d.list.length / n);
      // every building gets its own lot, with a garden tile between neighbours
      const ox = bx + Math.floor((c.B - (2 * n - 1)) / 2), oy = by + Math.floor((c.B - (2 * m - 1)) / 2);
      d.list.forEach((s, j) => {
        const gx = ox + 2 * (j % n), gy = oy + 2 * Math.floor(j / n);
        set(gx, gy, 2);
        buildings.push({ s, gx, gy, colony: c.id, district: d.name });
      });
    });
  });

  // decoration, seeded by position so it stays put between refreshes
  const nearLot = (tx, ty) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && tiles[ny * W + nx] === 2) return true;
    }
    return false;
  };
  const onWall = (tx, ty) => colonies.some((c) =>
    ((tx === c.ox - 1 || tx === c.ox + c.w) && ty >= -1 && ty <= c.h) ||
    ((ty === -1 || ty === c.h) && tx >= c.ox - 1 && tx <= c.ox + c.w));
  const trees = [];
  const R = 7;
  for (let ty = -R; ty < H + R; ty++) for (let tx = -R; tx < W + R; tx++) {
    const inside = tx >= 0 && ty >= 0 && tx < W && ty < H;
    if (inside && (tiles[ty * W + tx] !== 0 || nearLot(tx, ty))) continue;
    if (onWall(tx, ty) || (ty >= avenue - 1 && ty <= avenue + 1)) continue;
    const ci = inside ? colonyAt[ty * W + tx] : -1;
    const colony = ci >= 0 ? colonies[ci].id : null;
    const r = rng(hash(`${tx},${ty}`));
    const p = colony === 'uptown' ? 0.22 : colony ? 0.3 : 0.4;
    if (r() > p) continue;
    const kind = colony === 'oldtown' ? (r() < 0.6 ? 'dead' : 'round')
      : colony === 'uptown' ? (r() < 0.5 ? 'round' : 'cone')
      : r() < 0.3 ? 'pine' : 'round';
    trees.push({ x: tx + 0.1 + r() * 0.8, y: ty + 0.1 + r() * 0.8, size: 0.8 + r() * 0.5, kind, colony });
  }

  const lamps = [];
  for (const c of colonies) {
    for (let ty = 0; ty < c.h; ty += c.cell) for (let tx = 0; tx < c.w; tx += c.cell) {
      lamps.push({ x: c.ox + tx + 0.15, y: ty + 0.15, colony: c.id });
    }
  }
  for (let tx = 2; tx < W; tx += 4) lamps.push({ x: tx + 0.5, y: avenue - 0.1, colony: null });

  return {
    W, H, avenue, tiles, colonyAt, buildings, blocks, gates, fences, trees, lamps,
    colonies: colonies.map(({ id, ox, w, h, cell, gateX }) => ({ id, ox, w, h, cell, gateX })),
  };
}

export const drivable = (L, x, y) => x >= 0 && y >= 0 && x < L.W && y < L.H && L.tiles[y * L.W + x] === 1;

// Breadth-first search over road tiles. Target is a building (stop on the
// nearest road tile) or a tile. Returns tile-centre waypoints, [] if already there.
export function findPath(L, sx, sy, target) {
  const { W, H } = L;
  const start = [Math.min(W - 1, Math.max(0, Math.floor(sx))), Math.min(H - 1, Math.max(0, Math.floor(sy)))];
  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const si = start[1] * W + start[0];
  dist[si] = 0;
  const queue = [si];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, ni = ny * W + nx;
      if (!drivable(L, nx, ny) || dist[ni] >= 0) continue;
      dist[ni] = dist[i] + 1;
      prev[ni] = i;
      queue.push(ni);
    }
  }
  const [tx, ty] = target.gx != null ? [target.gx, target.gy] : target;
  let best = si, bestScore = Infinity;
  for (const i of queue) {
    const x = i % W, y = (i / W) | 0;
    const score = (Math.abs(x - tx) + Math.abs(y - ty)) * 1000 + dist[i];
    if (score < bestScore) { bestScore = score; best = i; }
  }
  const path = [];
  for (let i = best; i >= 0 && i !== si; i = prev[i]) path.unshift([(i % W) + 0.5, ((i / W) | 0) + 0.5]);
  return path;
}
