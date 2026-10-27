// Inside a building: a room whose furniture is the kinds of work Claude does,
// with the main agent walking to whatever the session is doing right now.
import { iso, mix, shade, poly, ellipse, box, inPoly } from './util.js';
import { drawAgent, bubble } from './agents.js';
import { KINDS } from './world.js';

export const ROOM = 7;
const WALL = 96;
const MAIN_COLOR = '#e8825e', SUB_COLOR = '#a58be0';

// Each station stands for one kind of work; `spot` is where an agent stands to use it.
const STATIONS = [
  { id: 'research', label: 'Bookshelf', unit: 'reads & searches', gx: 0.1, gy: 1.1, w: 0.6, d: 1.7, h: 50, color: '#8a5a3b', spot: [1.15, 2.0] },
  { id: 'build', label: 'Workbench', unit: 'file edits', gx: 1.9, gy: 0.15, w: 1.7, d: 0.75, h: 20, color: '#c9a27a', spot: [2.75, 1.35] },
  { id: 'chat', label: 'Coffee machine', unit: '', gx: 3.95, gy: 0.15, w: 0.55, d: 0.55, h: 28, color: '#dcd6cc', spot: [4.2, 1.1] },
  { id: 'shell', label: 'Terminal', unit: 'commands run', gx: 4.8, gy: 0.15, w: 0.85, d: 0.7, h: 54, color: '#3b4256', spot: [5.2, 1.3] },
  { id: 'web', label: 'Globe', unit: 'web & browser actions', gx: 5.6, gy: 3.6, w: 0.8, d: 0.8, h: 16, color: '#6b7280', spot: [5.3, 4.9] },
  { id: 'mcp', label: 'Switchboard', unit: 'MCP tool calls', gx: 0.1, gy: 4.4, w: 0.6, d: 1.3, h: 36, color: '#5b6478', spot: [1.2, 5.05] },
];
const DESKS = [[2.0, 2.9], [3.3, 2.9], [2.0, 4.1], [3.3, 4.1], [4.6, 2.9], [4.6, 4.1]];
const DOOR = { u0: 6.05, u1: 6.75 }; // on the back-right wall, in tiles

export function createInterior(session) {
  return {
    id: session.id,
    agent: { x: 2.75, y: 1.35, path: null, state: 'idle', flip: false },
    hits: [],
    lastGroup: null,
    wanderAt: 0,
  };
}

const stationFor = (id) => STATIONS.find((st) => st.id === id);

function moveToward(p, [tx, ty], speed, dt) {
  const dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy);
  if (dist < 0.05) return true;
  const step = Math.min(dist, speed * dt);
  p.x += (dx / dist) * step;
  p.y += (dy / dist) * step;
  // screen-space facing: +x+y is down the screen, +x-y is to the right
  p.front = dx + dy >= 0;
  p.flip = dx - dy < 0;
  return false;
}

export function updateInterior(st, dt, s, t) {
  const a = st.agent;
  let goal;
  if (s.status === 'waiting') { goal = [3.6, 5.3]; a.mode = 'wait'; }
  else if (s.status === 'open') { goal = stationFor('chat').spot; a.mode = 'idle'; }
  else if (s.status === 'closed') { goal = stationFor('build').spot; a.mode = 'sleep'; }
  else {
    // working: follow the latest tool; between updates, drift to other busy stations
    a.mode = 'work';
    if (s.lastGroup !== st.lastGroup) { st.lastGroup = s.lastGroup; st.wanderAt = t + 7000; a.goalId = s.lastGroup; }
    if (t > st.wanderAt) {
      const busy = STATIONS.filter((x) => (s.groups?.[x.id] || 0) > 0);
      a.goalId = busy.length ? busy[Math.floor(Math.random() * busy.length)].id : 'build';
      st.wanderAt = t + 5000 + Math.random() * 4000;
    }
    goal = (stationFor(a.goalId) ?? stationFor('build')).spot;
  }
  const arrived = moveToward(a, goal, 1.8, dt);
  a.state = arrived ? (a.mode === 'wait' ? 'wait' : a.mode) : 'walk';
  if (arrived) a.front = true;
}

// ---------- drawing ----------
const up = ([x, y], dz) => [x, y - dz];

function wallA(u0, u1, v0, v1) { // back-right wall (gy = 0), u in tiles along gx
  return [up(iso(u0, 0), v0), up(iso(u1, 0), v0), up(iso(u1, 0), v1), up(iso(u0, 0), v1)];
}
function wallB(u0, u1, v0, v1) { // back-left wall (gx = 0), u in tiles along gy
  return [up(iso(0, u0), v0), up(iso(0, u1), v0), up(iso(0, u1), v1), up(iso(0, u0), v1)];
}

function drawRoom(ctx, s, env) {
  const n = env.night;
  const kind = KINDS[s.kind].color;
  const wall = mix('#f4efe6', kind, 0.18);

  // floor planks
  for (let y = 0; y < ROOM; y++) for (let x = 0; x < ROOM; x++) {
    poly(ctx, [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], (x + y) % 2 ? '#d7b48c' : '#cfab82');
  }
  // rug under the desks
  poly(ctx, [iso(1.7, 2.5), iso(5.6, 2.5), iso(5.6, 5.0), iso(1.7, 5.0)], mix(kind, '#ffffff', 0.25));
  poly(ctx, [iso(1.9, 2.7), iso(5.4, 2.7), iso(5.4, 4.8), iso(1.9, 4.8)], null, shade(kind, -0.15));

  poly(ctx, wallB(0, ROOM, 0, WALL), shade(wall, -0.08));
  poly(ctx, wallA(0, ROOM, 0, WALL), wall);
  poly(ctx, wallB(0, ROOM, 0, 5), shade(wall, -0.3));
  poly(ctx, wallA(0, ROOM, 0, 5), shade(wall, -0.22));

  // window on the left wall showing the sky outside
  const sky = n > 0.5 ? '#1d2a55' : mix('#9fd3f0', '#1d2a55', n);
  poly(ctx, wallB(2.9, 4.6, 46, 84), '#ffffff');
  poly(ctx, wallB(3.0, 4.5, 49, 81), sky);
  if (n > 0.5) for (let i = 0; i < 4; i++) {
    const [sx, sy] = up(iso(0, 3.2 + i * 0.35), 60 + ((i * 7) % 18));
    ellipse(ctx, sx, sy, 0.8, 0.8, '#ffffff');
  } else {
    const [sx, sy] = up(iso(0, 4.0), 70);
    ellipse(ctx, sx, sy, 5, 2.5, '#ffffff');
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(...up(iso(0, 3.75), 49)); ctx.lineTo(...up(iso(0, 3.75), 81)); ctx.stroke();

  // whiteboard on the right wall, text skewed onto the wall
  poly(ctx, wallA(1.6, 4.4, 50, 88), '#ffffff', '#b8bcc8');
  ctx.save();
  const [ox, oy] = up(iso(1.75, 0), 84);
  ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([1, 0.5, 0, 1, ox, oy])));
  // the board is 2.8 tiles wide: 2.8 * 32px along the wall, minus padding
  const fit = (text, max = 68) => {
    let t = text;
    while (ctx.measureText(t).width > max && t.length > 3) t = t.slice(0, -2);
    return t === text ? t : t.trimEnd() + '…';
  };
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2b3245';
  ctx.font = '700 8px system-ui, sans-serif';
  ctx.fillText(fit(s.title || 'Untitled session'), 0, 0);
  ctx.font = '500 6.5px system-ui, sans-serif';
  ctx.fillStyle = '#4a5370';
  const tools = Object.values(s.tools || {}).reduce((x, y) => x + y, 0);
  ctx.fillText(fit(`${s.prompts} prompts · ${tools} actions`), 0, 12);
  ctx.fillText(fit(`${s.errors} failed · ${s.subagents} subagents`), 0, 21);
  ctx.fillStyle = shade(kind, -0.35);
  ctx.font = '600 6.5px system-ui, sans-serif';
  ctx.fillText(fit(KINDS[s.kind].label), 0, 30);
  ctx.restore();

  // exit door
  poly(ctx, wallA(DOOR.u0, DOOR.u1, 0, 40), '#8a6446');
  poly(ctx, wallA(DOOR.u0 + 0.05, DOOR.u1 - 0.05, 0, 37), '#a77a55');
  const [kx, ky] = up(iso(DOOR.u1 - 0.14, 0), 18);
  ellipse(ctx, kx, ky, 1.4, 1.4, '#f2d48a');
  poly(ctx, wallA(DOOR.u0 + 0.06, DOOR.u1 - 0.06, 44, 51), '#3fae6a');
  ctx.save();
  const [ex, ey] = up(iso(DOOR.u0 + 0.14, 0), 50);
  ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([1, 0.5, 0, 1, ex, ey])));
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 6px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('EXIT', 0, 0);
  ctx.restore();
}

function drawStation(ctx, st, s, env) {
  const live = s.status === 'working';
  const active = live && s.lastGroup === st.id;
  const t = env.t;
  const faces = box(ctx, st.gx, st.gy, st.w, st.d, st.h, st.color);
  const onLeft = (u0, u1, v0, v1) => { // a patch on the box's left (front-facing) side
    const [a, b] = [iso(st.gx + st.w * u0, st.gy + st.d), iso(st.gx + st.w * u1, st.gy + st.d)];
    return [up(a, v0), up(b, v0), up(b, v1), up(a, v1)];
  };
  const onRight = (u0, u1, v0, v1) => { // a patch on the box's right side
    const [a, b] = [iso(st.gx + st.w, st.gy + st.d * u0), iso(st.gx + st.w, st.gy + st.d * u1)];
    return [up(a, v0), up(b, v0), up(b, v1), up(a, v1)];
  };

  switch (st.id) {
    case 'research': // shelves and books on the side facing the room
      for (let shelf = 0; shelf < 4; shelf++) {
        const v = 6 + shelf * 11;
        for (let i = 0; i < 7; i++) {
          const col = ['#c0392b', '#2e86de', '#f6b93b', '#38ada9', '#8e44ad', '#e17055', '#27ae60'][(i + shelf * 3) % 7];
          poly(ctx, onRight(0.06 + i * 0.13, 0.15 + i * 0.13, v, v + 8 + ((i * shelf) % 3)), col);
        }
        poly(ctx, onRight(0, 1, v - 1, v), shade(st.color, -0.35));
      }
      break;
    case 'build': { // desk with a monitor showing code
      const m = { gx: st.gx + 0.55, gy: st.gy + 0.12, w: 0.6, d: 0.08 };
      box(ctx, m.gx + 0.26, m.gy, 0.08, 0.08, 6, '#555c6e', st.h);
      box(ctx, m.gx, m.gy, m.w, m.d, 18, '#2b3040', st.h + 6);
      const a = iso(m.gx + 0.04, m.gy + m.d), b = iso(m.gx + m.w - 0.04, m.gy + m.d);
      const at = (u, v) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - v];
      poly(ctx, [at(0, st.h + 8), at(1, st.h + 8), at(1, st.h + 22), at(0, st.h + 22)], '#1b2233');
      const scroll = active ? Math.floor(t / 250) : 0;
      for (let i = 0; i < 5; i++) {
        const len = 0.25 + (((i + scroll) * 37) % 50) / 100;
        const v = st.h + 20 - i * 2.6;
        ctx.strokeStyle = ['#7cf2c8', '#ffd27a', '#9cc3e6', '#f2a7bd'][(i + scroll) % 4];
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(...at(0.08 + (i % 2) * 0.08, v)); ctx.lineTo(...at(Math.min(0.92, 0.08 + len), v)); ctx.stroke();
      }
      box(ctx, st.gx + 0.2, st.gy + 0.45, 0.45, 0.15, 2, '#e8e8ec', st.h); // keyboard
      break;
    }
    case 'shell': // server rack with blinking lights
      for (let r = 0; r < 6; r++) {
        poly(ctx, onLeft(0.08, 0.92, 6 + r * 8, 11 + r * 8), '#262b39');
        for (let i = 0; i < 4; i++) {
          const on = live ? Math.sin(t / (90 + i * 37) + r * 2 + i) > 0 : (r + i) % 3 === 0;
          const p = onLeft(0.15 + i * 0.1, 0.2 + i * 0.1, 8 + r * 8, 9.5 + r * 8);
          poly(ctx, p, on ? (i % 2 ? '#7cf2c8' : '#ffd27a') : '#3f4658');
        }
      }
      break;
    case 'web': { // globe on a stand
      const [gx, gy] = iso(st.gx + st.w / 2, st.gy + st.d / 2);
      const cy = gy - st.h - 14;
      ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, gy - st.h); ctx.lineTo(gx, cy + 10); ctx.stroke();
      ellipse(ctx, gx, cy, 12, 12, '#4fa3e0');
      const spin = (live ? t / 1500 : 0) % (Math.PI * 2);
      ctx.save();
      ctx.beginPath(); ctx.arc(gx, cy, 12, 0, Math.PI * 2); ctx.clip();
      for (let i = 0; i < 3; i++) {
        const x = gx - 18 + (((spin * 8 + i * 13) % 36) + 36) % 36;
        ellipse(ctx, x, cy - 3 + i * 3, 4.5, 3, '#6cbf5f');
      }
      ctx.restore();
      ctx.strokeStyle = '#b08d57'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gx, cy, 14, Math.PI * 0.7, Math.PI * 2.3); ctx.stroke();
      break;
    }
    case 'mcp': // plugboard with cables
      for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) {
        const p = onRight(0.12 + i * 0.2, 0.2 + i * 0.2, 10 + r * 6, 13 + r * 6);
        poly(ctx, p, ['#ef6f8e', '#ffd27a', '#7cf2c8', '#9cc3e6'][(r + i) % 4]);
      }
      break;
    case 'chat': { // coffee machine, steaming when the agent is on a break
      const [cx, cy] = iso(st.gx + st.w / 2, st.gy + st.d);
      poly(ctx, faces.left.map(([x, y]) => [x, y]), null, 'rgba(0,0,0,.08)');
      ellipse(ctx, cx, cy - 8, 3, 1.5, '#ffffff');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 3, cy - 14, 6, 6);
      if (s.status === 'open') for (let i = 0; i < 2; i++) {
        const p = (t / 1400 + i / 2) % 1;
        ellipse(ctx, cx + Math.sin(p * 6) * 2, cy - 18 - p * 14, 1.5 + p * 2, 1.5 + p * 2, `rgba(255,255,255,${0.7 * (1 - p)})`);
      }
      break;
    }
  }
  if (active) {
    const [x, y] = iso(st.gx + st.w / 2, st.gy + st.d / 2);
    const p = (t / 900) % 1;
    ctx.strokeStyle = `rgba(76,201,120,${1 - p})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, 24 + p * 12, 12 + p * 6, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

export function drawInterior(ctx, st, s, env, activity) {
  drawRoom(ctx, s, env);

  const items = [];
  st.hits = [];
  for (const station of STATIONS) {
    const d = station.gx + station.w / 2 + station.gy + station.d / 2;
    items.push({ d, f: () => drawStation(ctx, station, s, env) });
    const T = iso(station.gx, station.gy), R = iso(station.gx + station.w, station.gy);
    const B = iso(station.gx + station.w, station.gy + station.d), L = iso(station.gx, station.gy + station.d);
    st.hits.push({ station, poly: [L, up(L, station.h + 10), up(T, station.h + 10), up(R, station.h + 10), R, B] });
  }

  const subs = Math.min(s.subagents || 0, DESKS.length);
  for (let i = 0; i < Math.max(subs, 2); i++) {
    const [dx, dy] = DESKS[i];
    items.push({ d: dx + dy + 0.6, f: () => {
      box(ctx, dx, dy, 0.85, 0.45, 15, '#b98c62');
      box(ctx, dx + 0.25, dy + 0.05, 0.35, 0.06, 10, '#2b3040', 15);
    } });
    if (i < subs) {
      const [ax, ay] = iso(dx + 0.42, dy - 0.05);
      const state = s.status === 'working' ? 'work' : s.status === 'closed' ? 'sleep' : 'idle';
      items.push({ d: dx + dy + 0.3, f: () => drawAgent(ctx, ax, ay, { color: SUB_COLOR, t: env.t, state, phase: i * 1.7 }) });
    }
  }

  const a = st.agent;
  const [ax, ay] = iso(a.x, a.y);
  items.push({ d: a.x + a.y, f: () => drawAgent(ctx, ax, ay, { color: MAIN_COLOR, t: env.t, state: a.state, flip: a.flip, scale: 1.15 }) });

  items.sort((x, y) => x.d - y.d);
  for (const it of items) it.f();

  // what the agent is up to
  const text = s.status === 'waiting' ? 'I need you! Check your terminal.'
    : s.status === 'open' ? 'Coffee break. Ready for your next prompt.'
    : s.status === 'closed' ? 'Zzz… this session is closed.'
    : activity?.[0]?.text || 'Working…';
  bubble(ctx, ax, ay - 42, text, s.status === 'waiting' ? { bg: '#ffd166', fg: '#4a3300' } : {});
}

export function interiorBounds() {
  const [l] = iso(0, ROOM), [r] = iso(ROOM, 0), [, b] = iso(ROOM, ROOM), [, t] = iso(0, 0);
  return { x0: l - 20, x1: r + 20, y0: t - WALL - 30, y1: b + 20 };
}

// What's under the pointer: a station or the exit door.
export function pickInterior(st, wx, wy) {
  for (const h of st.hits) if (inPoly([wx, wy], h.poly)) return { station: h.station };
  if (inPoly([wx, wy], wallA(DOOR.u0, DOOR.u1, 0, 52))) return { door: true };
  return null;
}
