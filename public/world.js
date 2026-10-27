// The city: layout, pathfinding and drawing of streets, parks, cars and buildings.
import { iso, hash, rng, mix, shade, poly, ellipse, box, inPoly, outline } from './util.js';
import { drawVehicle, drawPlayerMarker, CAR_MODELS } from './vehicles.js';

export const KINDS = {
  build:    { color: '#f2b880', label: 'Workshop',    desc: 'editing code' },
  research: { color: '#9cc3e6', label: 'Library',     desc: 'reading & searching' },
  shell:    { color: '#d9a08c', label: 'Factory',     desc: 'running commands' },
  web:      { color: '#8fd3c3', label: 'Observatory', desc: 'web & browser' },
  agents:   { color: '#b9a3e3', label: 'HQ',          desc: 'dispatching subagents' },
  mcp:      { color: '#e8d48a', label: 'Exchange',    desc: 'MCP tools' },
  chat:     { color: '#f2a7bd', label: 'Café',        desc: 'just talking' },
};
export const STATUS = { working: 'Working', waiting: 'Needs you', open: 'Open · idle', closed: 'Closed' };
const LIT = { working: 0.85, waiting: 0.65, open: 0.5, closed: 0.05 };

const C = {
  grass: '#95d46a', grassDark: '#7fbf55', road: '#7c8494', dash: '#fff6dc', curb: '#efe2c4',
  plaza: '#f3ead6', night: '#1a2246', trunk: '#9a6440', leaf: ['#58b64f', '#47a043', '#6fcb5c'],
};

// Darkens colors toward a night blue as `night` goes from 0 to 1.
const tint = (hex, night) => (night ? mix(hex, C.night, night * 0.55) : hex);

// ---------- layout ----------
export function buildWorld(districts, prev) {
  const B = Math.max(2, ...districts.map((d) => Math.ceil(Math.sqrt(d.list.length))));
  const cell = B + 1;
  const cols = Math.max(1, Math.ceil(Math.sqrt(districts.length)));
  const rows = Math.max(1, Math.ceil(districts.length / cols));
  const W = cols * cell + 1, H = rows * cell + 1;
  const tiles = new Uint8Array(W * H); // 0 park, 1 road, 2 building
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles[y * W + x] = x % cell === 0 || y % cell === 0 ? 1 : 0;

  const buildings = [];
  const blocks = [];
  for (let i = 0; i < cols * rows; i++) {
    const bx = (i % cols) * cell + 1, by = Math.floor(i / cols) * cell + 1;
    const d = districts[i];
    blocks.push({ bx, by, B, name: d?.name ?? null, count: d?.list.length ?? 0 });
    if (!d) continue;
    const n = Math.ceil(Math.sqrt(d.list.length));
    const m = Math.ceil(d.list.length / n);
    const ox = bx + Math.floor((B - n) / 2), oy = by + Math.floor((B - m) / 2);
    d.list.forEach((s, j) => {
      const gx = ox + (j % n), gy = oy + Math.floor(j / n);
      tiles[gy * W + gx] = 2;
      buildings.push(makeBuilding(s, gx, gy));
    });
  }
  for (const b of buildings) {
    b.door = tiles[(b.gy + 1) * W + b.gx] !== 2 ? 'left' : tiles[b.gy * W + b.gx + 1] !== 2 ? 'right' : 'left';
  }

  // decoration, seeded by position so it doesn't move between refreshes
  const trees = [];
  const lamps = [];
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
    const border = x < 0 || y < 0 || x >= W || y >= H;
    const t = border ? 0 : tiles[y * W + x];
    if (!border && t === 1 && x % cell === 0 && y % cell === 0) lamps.push({ x: x + 0.12, y: y + 0.12 });
    if (t !== 0) continue;
    const r = rng(hash(`${x},${y}`));
    if (r() < (border ? 0.5 : 0.38)) {
      trees.push({ x: x + 0.25 + r() * 0.5, y: y + 0.25 + r() * 0.5, size: 0.8 + r() * 0.45, pine: r() < 0.3 });
    }
  }

  for (const blk of blocks) for (const [dx, dy] of [[0.3, 0.3], [blk.B - 0.3, 0.3], [0.3, blk.B - 0.3], [blk.B - 0.3, blk.B - 0.3]]) {
    const x = blk.bx + dx, y = blk.by + dy;
    if (tiles[Math.floor(y) * W + Math.floor(x)] !== 2) trees.push({ x, y, size: 0.8, bush: true });
  }

  const cars = (prev?.W === W && prev?.H === H) ? prev.cars : makeCars(W, H, cols, rows, cell);
  return { W, H, B, cell, cols, rows, tiles, buildings, blocks, trees, lamps, cars };
}

function makeBuilding(s, gx, gy) {
  const h = s.kind === 'chat' ? 26 : Math.min(200, 30 + 14 * Math.log2(1 + s.turns));
  const floors = Math.max(1, Math.floor((h - 6) / 13));
  const r = rng(hash(s.id));
  const [cx, cy] = iso(gx + 0.5, gy + 0.5);
  const w2 = 0.36 * 64, d2 = 0.36 * 32, top = cy - 3 - h;
  return {
    s, gx, gy, h, floors, cx, cy,
    rnd: Array.from({ length: floors * 6 }, r),
    phase: r() * Math.PI * 2,
    hit: [[cx - w2, cy], [cx - w2, top], [cx, top - d2], [cx + w2, top], [cx + w2, cy], [cx, cy + d2]],
  };
}

function makeCars(W, H, cols, rows, cell) {
  const r = rng(W * 131 + H);
  const cars = [];
  const model = () => CAR_MODELS[Math.floor(r() * CAR_MODELS.length)];
  for (let i = 0; i <= rows; i++) cars.push({ axis: 'x', line: i * cell, pos: r() * W, speed: 0.8 + r() * 0.6, model: model() });
  for (let i = 0; i <= cols; i++) cars.push({ axis: 'y', line: i * cell, pos: r() * H, speed: 0.8 + r() * 0.6, model: model() });
  return cars.slice(0, 7);
}

export function updateCars(world, dt) {
  for (const c of world.cars) {
    const len = c.axis === 'x' ? world.W : world.H;
    c.pos = (c.pos + c.speed * dt) % len;
  }
}

// ---------- walking ----------
export const drivable = (w, x, y) => x >= 0 && y >= 0 && x < w.W && y < w.H && w.tiles[y * w.W + x] === 1;

// Breadth-first search over tiles that `pass` allows. Target is a building
// (get as close to it as possible) or a tile. Returns tile-centre waypoints,
// or [] if already there.
export function findPath(w, sx, sy, target, pass = drivable) {
  const { W, H } = w;
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
      if (!pass(w, nx, ny) || dist[ni] >= 0) continue;
      dist[ni] = dist[i] + 1;
      prev[ni] = i;
      queue.push(ni);
    }
  }
  const [tx, ty] = target.gx != null ? [target.gx, target.gy] : target;
  let best = -1, bestScore = Infinity;
  for (const i of queue) {
    const x = i % W, y = (i / W) | 0;
    const md = Math.abs(x - tx) + Math.abs(y - ty);
    const want = target.gx != null ? md === 1 : md === 0;
    const score = (want ? 0 : 1e6 + md * 1000) + dist[i];
    if (score < bestScore) { bestScore = score; best = i; }
  }
  const path = [];
  for (let i = best; i >= 0 && i !== si; i = prev[i]) path.unshift([(i % W) + 0.5, ((i / W) | 0) + 0.5]);
  return path;
}

export function buildingAt(world, wx, wy) {
  for (let i = world.buildings.length - 1; i >= 0; i--) if (inPoly([wx, wy], world.buildings[i].hit)) return world.buildings[i];
  return null;
}

// ---------- drawing ----------
function diamond(x0, y0, x1, y1) {
  return [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)];
}

function drawGround(ctx, w, n) {
  const { W, H, cell } = w;
  poly(ctx, diamond(-1.6, -1.6, W + 1.6, H + 1.6), tint(C.grassDark, n));
  poly(ctx, diamond(-1.2, -1.2, W + 1.2, H + 1.2), tint(C.grass, n));
  poly(ctx, diamond(0, 0, W, H), tint(C.road, n));

  for (const b of w.blocks) {
    poly(ctx, diamond(b.bx - 0.06, b.by - 0.06, b.bx + b.B + 0.06, b.by + b.B + 0.06), tint(C.curb, n));
    poly(ctx, diamond(b.bx + 0.12, b.by + 0.12, b.bx + b.B - 0.12, b.by + b.B - 0.12), tint(C.grass, n));
  }
  for (const b of w.buildings) poly(ctx, diamond(b.gx + 0.04, b.gy + 0.04, b.gx + 0.96, b.gy + 0.96), tint(C.plaza, n));

  // flowers in the parks
  for (const blk of w.blocks) {
    const r = rng(hash(`f${blk.bx},${blk.by}`));
    for (let i = 0; i < blk.B * 3; i++) {
      const x = blk.bx + 0.25 + r() * (blk.B - 0.5), y = blk.by + 0.25 + r() * (blk.B - 0.5);
      if (w.tiles[Math.floor(y) * W + Math.floor(x)] === 2) continue;
      const [px, py] = iso(x, y);
      ellipse(ctx, px, py, 1.6, 1, tint(['#ffffff', '#ffd166', '#ef798a', '#c3a6ff'][i % 4], n));
    }
  }

  // lane markings
  ctx.strokeStyle = tint(C.dash, n);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hRoad = y % cell === 0, vRoad = x % cell === 0;
    if (hRoad && !vRoad) { ctx.moveTo(...iso(x + 0.3, y + 0.5)); ctx.lineTo(...iso(x + 0.7, y + 0.5)); }
    if (vRoad && !hRoad) { ctx.moveTo(...iso(x + 0.5, y + 0.3)); ctx.lineTo(...iso(x + 0.5, y + 0.7)); }
  }
  ctx.stroke();
}

function drawTree(ctx, tr, n) {
  const [x, y] = iso(tr.x, tr.y);
  const s = tr.size;
  if (tr.bush) {
    ellipse(ctx, x, y, 8 * s, 3.5 * s, 'rgba(40,60,20,.18)');
    ellipse(ctx, x - 3 * s, y - 4 * s, 5 * s, 4.2 * s, tint(C.leaf[1], n));
    ellipse(ctx, x + 3 * s, y - 4 * s, 5 * s, 4.2 * s, tint(C.leaf[0], n));
    ellipse(ctx, x, y - 6.5 * s, 5 * s, 4.2 * s, tint(C.leaf[2], n));
    ellipse(ctx, x + 2 * s, y - 7 * s, 1.2 * s, 1.2 * s, tint('#ff8fa3', n));
    return;
  }
  ellipse(ctx, x, y, 9 * s, 4 * s, 'rgba(0,0,0,.14)');
  ctx.fillStyle = tint(C.trunk, n);
  ctx.fillRect(x - 1.5 * s, y - 9 * s, 3 * s, 9 * s);
  if (tr.pine) {
    for (let i = 0; i < 3; i++) {
      const by = y - 6 * s - i * 7 * s, hw = (9 - i * 2.2) * s;
      poly(ctx, [[x - hw, by], [x + hw, by], [x, by - 11 * s]], tint(C.leaf[i % 3], n));
    }
  } else {
    ellipse(ctx, x, y - 13 * s, 9.5 * s, 8.5 * s, 'rgba(60,40,30,.22)');
    ellipse(ctx, x - 4 * s, y - 14 * s, 6.5 * s, 6 * s, tint(C.leaf[1], n));
    ellipse(ctx, x + 4 * s, y - 15 * s, 6.5 * s, 6 * s, tint(C.leaf[0], n));
    ellipse(ctx, x, y - 20 * s, 7 * s, 6.5 * s, tint(C.leaf[2], n));
    ellipse(ctx, x - 2 * s, y - 22 * s, 2.5 * s, 2 * s, tint('#9ad68a', n));
  }
}

function drawLamp(ctx, l, n) {
  const [x, y] = iso(l.x, l.y);
  if (n > 0.3) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 30);
    g.addColorStop(0, `rgba(255,214,140,${0.35 * n})`);
    g.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, 30, 15, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = tint('#4a5160', n);
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 28); ctx.lineTo(x + 5, y - 30); ctx.stroke();
  ellipse(ctx, x + 6, y - 29, 3, 2, n > 0.3 ? '#ffe6a8' : tint('#dfe3ea', n));
}

function drawTraffic(ctx, c, n) {
  const [gx, gy] = c.axis === 'x' ? [c.pos, c.line + 0.68] : [c.line + 0.68, c.pos];
  drawVehicle(ctx, gx, gy, '+' + c.axis, c.model, { tint: (h) => tint(h, n), night: n, scale: 0.85 });
}

function drawWindows(ctx, b, p0, p1, z, env, doorFace) {
  const at = (u, v) => [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u - v];
  const { night: n, t } = env;
  const live = b.s.status !== 'closed';
  for (let f = 0; f < b.floors; f++) {
    const v0 = z + 5 + f * 13, v1 = v0 + 7;
    if (v1 > z + b.h - 4) break;
    if (f === 0 && doorFace) continue;
    for (let c = 0; c < 2; c++) {
      const u0 = 0.14 + c * 0.44, u1 = u0 + 0.28;
      const r = b.rnd[(f * 6 + c * 3 + (p0[0] < b.cx ? 0 : 1)) % b.rnd.length];
      const lit = r < LIT[b.s.status] * (n > 0.3 ? 1 : 0.45) && (live || n > 0.3);
      const flicker = b.s.status === 'working' && Math.sin(t / 700 + r * 40) > 0.96;
      const color = lit && !flicker
        ? (n > 0.3 ? '#ffd98a' : '#fff1c4')
        : tint('#b7d7ee', n);
      poly(ctx, [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], color);
      if (!lit) poly(ctx, [at(u0, v1 - 2.2), at(u1, v1 - 2.2), at(u1, v1), at(u0, v1)], tint('#e2f0fa', n));
    }
  }
}

function drawBuilding(ctx, b, env) {
  const { s } = b;
  const { night: n, t } = env;
  const live = s.status !== 'closed';
  const base = tint(KINDS[s.kind].color, n);
  const x0 = b.gx + 0.14, y0 = b.gy + 0.14, w = 0.72, z = 3, h = b.h;
  const up = (p, dz) => [p[0], p[1] - dz];
  const T = iso(x0, y0), R = iso(x0 + w, y0), Bt = iso(x0 + w, y0 + w), L = iso(x0, y0 + w);
  const cx = b.cx, top = b.cy - z - h;

  if (s.status === 'working') {
    ellipse(ctx, b.cx, b.cy, 34, 17, `rgba(255,214,120,${0.18 + 0.1 * Math.sin(t / 400 + b.phase)})`);
  }
  box(ctx, b.gx + 0.08, b.gy + 0.08, 0.84, 0.84, z, tint('#cbc3b2', n));

  poly(ctx, [up(L, z), up(Bt, z), up(Bt, z + h), up(L, z + h)], shade(base, -0.05));
  poly(ctx, [up(Bt, z), up(R, z), up(R, z + h), up(Bt, z + h)], shade(base, -0.22));

  // floor bands
  ctx.strokeStyle = 'rgba(0,0,0,.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let f = 1; f < b.floors; f++) {
    const v = z + 2 + f * 13;
    if (v > z + h - 3) break;
    ctx.moveTo(...up(L, v)); ctx.lineTo(...up(Bt, v)); ctx.lineTo(...up(R, v));
  }
  ctx.stroke();

  drawWindows(ctx, b, L, Bt, z, env, b.door === 'left');
  drawWindows(ctx, b, Bt, R, z, env, b.door === 'right');

  // door with an awning in the building's colour
  const [p0, p1] = b.door === 'left' ? [L, Bt] : [Bt, R];
  const at = (u, v) => [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u - v];
  poly(ctx, [at(0.38, z), at(0.62, z), at(0.62, z + 11), at(0.38, z + 11)], live && n > 0.3 ? '#ffd98a' : tint('#6b4a33', n));
  poly(ctx, [at(0.32, z + 12), at(0.68, z + 12), at(0.68, z + 15), at(0.32, z + 15)], shade(base, -0.4));

  // roof with a parapet
  poly(ctx, [up(T, z + h), up(R, z + h), up(Bt, z + h), up(L, z + h)], shade(base, 0.22));
  const ins = 0.07;
  poly(ctx, [iso(x0 + ins, y0 + ins), iso(x0 + w - ins, y0 + ins), iso(x0 + w - ins, y0 + w - ins), iso(x0 + ins, y0 + w - ins)].map((p) => up(p, z + h)), shade(base, 0.08));

  outline(ctx, [up(L, z), up(L, z + h), up(T, z + h), up(R, z + h), up(R, z), up(Bt, z)], 0.35);
  drawRoof(ctx, b, { cx, top, T, R, Bt, L, up, z, base, live, n, t, x0, y0, w });

  // subagents orbit as drones while the session runs
  const drones = Math.min(s.subagents || 0, 6);
  if (live) for (let i = 0; i < drones; i++) {
    const a = t / 1400 + b.phase + (i * Math.PI * 2) / drones;
    const dx = cx + Math.cos(a) * 30, dy = top - 24 + Math.sin(a) * 10;
    ctx.fillStyle = tint('#5b5f73', n);
    ctx.fillRect(dx - 4, dy - 1, 8, 2);
    ellipse(ctx, dx, dy + 1.5, 2.2, 2, '#b9a3e3');
  }

  // a live session hitting lots of tool errors is on fire
  if (live && s.turns && s.errors / s.turns > 0.03) {
    for (let i = 0; i < 3; i++) {
      const f = 0.7 + 0.3 * Math.sin(t / 90 + i * 2 + b.phase);
      poly(ctx, [[cx - 14 + i * 7, top + 2], [cx - 10 + i * 7, top - 12 * f], [cx - 6 + i * 7, top + 2]], i % 2 ? '#ffb347' : '#ff6b3d');
    }
  }

  if (s.status === 'working') {
    const p = (t / 1200 + b.phase) % 1;
    ctx.strokeStyle = `rgba(76,201,120,${1 - p})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, top, 6 + p * 14, (6 + p * 14) / 2, 0, 0, Math.PI * 2); ctx.stroke();
  }
  if (s.status === 'waiting') {
    const y = top - 42 + Math.sin(t / 300) * 3;
    ellipse(ctx, cx, y, 10, 10, '#ffd166');
    ctx.fillStyle = '#5a3d00';
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', cx, y + 0.5);
  }

  if (env.hover === s.id || env.selected === s.id) {
    ctx.lineWidth = 2;
    poly(ctx, b.hit, null, env.selected === s.id ? '#ffffff' : 'rgba(255,255,255,.7)');
  }
}

function drawRoof(ctx, b, g) {
  const { cx, top, T, R, Bt, L, up, z, base, live, n, t, x0, y0, w } = g;
  const h = b.h;
  ctx.lineWidth = 2;
  switch (b.s.kind) {
    case 'build': { // construction crane
      const sway = live ? 3 * Math.sin(t / 600 + b.phase) : 0;
      ctx.strokeStyle = tint('#f4b400', n);
      ctx.beginPath();
      ctx.moveTo(cx + 6, top - 2); ctx.lineTo(cx + 6, top - 34);
      ctx.moveTo(cx - 12, top - 32); ctx.lineTo(cx + 30, top - 32);
      ctx.moveTo(cx + 24, top - 32); ctx.lineTo(cx + 24, top - 16 + sway);
      ctx.stroke();
      ctx.fillStyle = tint('#59606e', n);
      ctx.fillRect(cx - 14, top - 34, 6, 5);
      ctx.fillStyle = tint('#d95d39', n);
      ctx.fillRect(cx + 21, top - 16 + sway, 6, 5);
      break;
    }
    case 'research': // pitched roof
      poly(ctx, [up(L, z + h), up(T, z + h), up(R, z + h), [cx, top - 18]], tint('#5f7ea6', n));
      poly(ctx, [up(L, z + h), [cx, top - 18], up(R, z + h), up(Bt, z + h)], tint('#7895bd', n));
      break;
    case 'shell': { // chimney with smoke
      box(ctx, x0 + w * 0.55, y0 + w * 0.12, 0.13, 0.13, 20, tint('#a65a46', n), z + h);
      if (live) for (let i = 0; i < 3; i++) {
        const p = (t / 1800 + i / 3 + b.phase) % 1;
        ellipse(ctx, cx + 12 + p * 12, top - 34 - p * 30, 3 + p * 6, 3 + p * 6, `rgba(205,210,220,${(1 - p) * 0.6})`);
      }
      break;
    }
    case 'web': // observatory dome
      ctx.fillStyle = tint('#f2f5f9', n);
      ctx.beginPath(); ctx.ellipse(cx, top, 15, 7.5, 0, Math.PI, 0); ctx.arc(cx, top, 15, 0, Math.PI, true); ctx.fill();
      ctx.strokeStyle = tint('#5b6478', n);
      ctx.beginPath(); ctx.moveTo(cx, top - 2); ctx.lineTo(cx + 12 * Math.cos(t / 3000 + b.phase), top - 18); ctx.stroke();
      break;
    case 'agents': // antenna and dish
      ctx.strokeStyle = tint('#7c8499', n);
      ctx.beginPath(); ctx.moveTo(cx - 4, top); ctx.lineTo(cx - 4, top - 36); ctx.stroke();
      ellipse(ctx, cx - 4, top - 37, 2.6, 2.6, live && Math.sin(t / 300) > 0 ? '#ff5d5d' : tint('#8a3b3b', n));
      ctx.fillStyle = tint('#e6e9f0', n);
      ctx.beginPath(); ctx.ellipse(cx + 9, top - 8, 7, 4, -0.6, 0, Math.PI); ctx.fill();
      break;
    case 'mcp': // spire
      poly(ctx, [[cx - 7, top], [cx + 7, top], [cx, top - 30]], tint('#d4a72c', n));
      poly(ctx, [[cx, top], [cx + 7, top], [cx, top - 30]], tint('#b88f1f', n));
      break;
    case 'chat': { // café umbrella
      ctx.strokeStyle = tint('#6b6f7a', n);
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, top - 16); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a0 = Math.PI + (i * Math.PI) / 6, a1 = a0 + Math.PI / 6;
        ctx.fillStyle = tint(i % 2 ? '#ffffff' : '#ef6f8e', n);
        ctx.beginPath(); ctx.moveTo(cx, top - 22);
        ctx.ellipse(cx, top - 14, 15, 8, 0, a0, a1);
        ctx.fill();
      }
      if (live && n > 0.3) { ctx.shadowColor = '#ff7aa8'; ctx.shadowBlur = 12; ellipse(ctx, cx, top - 23, 2, 2, '#ff7aa8'); ctx.shadowBlur = 0; }
      break;
    }
  }
}

// Draws the whole city in world coordinates (the caller sets the transform).
// `player` is the car you drive: { x, y, dir, model, moving }.
export function drawCity(ctx, world, env, player = null) {
  const n = env.night;
  drawGround(ctx, world, n);
  const items = [];
  for (const b of world.buildings) items.push({ d: b.gx + b.gy + 1, f: () => drawBuilding(ctx, b, env) });
  for (const tr of world.trees) items.push({ d: tr.x + tr.y, f: () => drawTree(ctx, tr, n) });
  for (const l of world.lamps) items.push({ d: l.x + l.y, f: () => drawLamp(ctx, l, n) });
  for (const c of world.cars) {
    const [gx, gy] = c.axis === 'x' ? [c.pos, c.line + 0.68] : [c.line + 0.68, c.pos];
    items.push({ d: gx + gy, f: () => drawTraffic(ctx, c, n) });
  }
  if (player) {
    const bump = player.moving ? Math.abs(Math.sin(env.t / 90)) * 0.8 : 0;
    items.push({ d: player.x + player.y + 0.01, f: () => {
      drawVehicle(ctx, player.x, player.y, player.dir, player.model, { tint: (h) => tint(h, n), night: n, bump });
      if (env.marker !== false) drawPlayerMarker(ctx, player.x, player.y, env.t, player.model.color);
    } });
  }
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.f();
}

export function worldBounds(world) {
  const tallest = Math.max(60, ...world.buildings.map((b) => b.h + 50));
  const [l] = iso(-1.6, world.H + 1.6), [r] = iso(world.W + 1.6, -1.6);
  const [, t] = iso(-1.6, -1.6), [, b] = iso(world.W + 1.6, world.H + 1.6);
  return { x0: l, x1: r, y0: t - tallest, y1: b };
}
