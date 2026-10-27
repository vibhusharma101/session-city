import { iso, unIso, esc, fmtNum, ago, span, store, mix } from './util.js';
import { CAR_MODELS, carById, dirFrom, drawVehicle } from './vehicles.js';
import { KINDS, STATUS, buildWorld, updateCars, findPath, drivable, buildingAt, drawCity, worldBounds } from './world.js';
import { createInterior, updateInterior, drawInterior, interiorBounds, pickInterior } from './interior.js';
import { renderPostcard, cityStats, openShare } from './share.js';

const canvas = document.getElementById('city');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const hud = document.getElementById('hud');
const $ = (id) => document.getElementById(id);

const state = {
  city: null,
  world: null,
  worldKey: '',
  scene: 'city',
  view: { x: 0, y: 0, s: 1 },
  fitted: false,
  range: 'all',
  hoverId: null,
  sky: store.get('sc.sky') || 'auto',
  car: { x: 0.5, y: 0.5, path: [], dir: '+y', moving: false, target: null, model: carById(store.get('sc.car')) },
  room: null,          // interior state
  roomSession: null,
  activity: [],
  fade: null,          // { start, mid: fn, done }
};
let dpr = 1;

// ---------- data ----------
const inRange = (s) => state.range === 'all' || Date.parse(s.lastActivity) >= Date.now() - Number(state.range) * 864e5;

function districts() {
  return state.city.districts.map((d) => ({ name: d.name, list: d.sessions.filter(inRange) })).filter((d) => d.list.length);
}

function findSession(id) {
  for (const d of state.city?.districts ?? []) for (const s of d.sessions) if (s.id === id) return s;
  return null;
}

function rebuild() {
  const ds = districts();
  const key = state.range + '|' + ds.map((d) => d.name + ':' + d.list.map((s) => s.id).join(',')).join('|');
  if (key === state.worldKey) {
    // same layout: just swap in fresh session data
    for (const b of state.world.buildings) b.s = findSession(b.s.id) ?? b.s;
    return;
  }
  const first = !state.world;
  state.world = buildWorld(ds, state.world);
  state.worldKey = key;
  const w = state.world;
  if (first || !drivable(w, Math.floor(state.car.x), Math.floor(state.car.y))) {
    const x = w.cell * Math.floor(w.cols / 2) + 0.5, y = w.H - 0.5;
    Object.assign(state.car, { x, y, path: [], target: null, dir: '-y' });
  }
  $('empty').hidden = w.buildings.length > 0;
}

async function load() {
  try {
    const res = await fetch('/api/city', { cache: 'no-store' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.city = data;
  } catch (e) {
    $('stats').textContent = 'Could not read sessions: ' + e.message;
    return;
  }
  rebuild();
  if (!state.fitted && state.world.buildings.length) { fitCity(); state.fitted = true; }
  renderStats();
  if (state.scene === 'room') {
    state.roomSession = findSession(state.roomSession.id) ?? state.roomSession;
    renderHud();
  }
}

async function loadActivity() {
  if (state.scene !== 'room') return;
  try {
    const res = await fetch(`/api/session/${encodeURIComponent(state.roomSession.id)}/activity`, { cache: 'no-store' });
    const data = await res.json();
    state.activity = data.actions ?? [];
    renderFeed();
  } catch { /* keep the last feed */ }
}

// ---------- city chrome ----------
function renderStats() {
  const all = state.world?.buildings.map((b) => b.s) ?? [];
  const live = all.filter((s) => s.status !== 'closed').length;
  const waiting = all.filter((s) => s.status === 'waiting');
  $('stats').innerHTML = `<b>${all.length}</b> sessions · <b>${live}</b> live · <b>${state.world?.blocks.filter((b) => b.name).length ?? 0}</b> districts`;
  const needs = $('needs');
  needs.hidden = waiting.length === 0;
  needs.textContent = `${waiting.length} need${waiting.length === 1 ? 's' : ''} you`;
}

function nightAmount() {
  if (state.sky === 'day') return 0;
  if (state.sky === 'night') return 1;
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  if (h >= 7 && h < 18) return 0;
  if (h >= 19 || h < 6) return 1;
  return h < 7 ? 1 - (h - 6) : h - 18;
}

function renderSkyButton() {
  $('sky').textContent = { auto: 'Auto', day: '☀ Day', night: '☾ Night' }[state.sky];
}

// ---------- driving ----------
function drive(car, speed, dt) {
  if (!car.path.length) { car.moving = false; return true; }
  const [tx, ty] = car.path[0];
  const dx = tx - car.x, dy = ty - car.y, dist = Math.hypot(dx, dy);
  const step = speed * dt;
  car.dir = dirFrom(dx, dy, car.dir);
  if (dist <= step) { car.x = tx; car.y = ty; car.path.shift(); }
  else { car.x += (dx / dist) * step; car.y += (dy / dist) * step; }
  car.moving = true;
  return false;
}

function goTo(target) {
  const car = state.car;
  car.path = findPath(state.world, car.x, car.y, target);
  car.target = target.gx != null ? target : null;
  if (!car.path.length && car.target) { car.target = null; enterBuilding(target); }
}

function updateCity(dt) {
  const w = state.world;
  if (!w) return;
  updateCars(w, dt);
  const car = state.car;
  if (drive(car, 3.6, dt) && car.target) {
    const b = car.target;
    car.target = null;
    enterBuilding(b);
  }
  // keep the car on screen while it drives
  if (car.moving) {
    const [wx, wy] = iso(car.x, car.y);
    const sx = wx * state.view.s + state.view.x, sy = wy * state.view.s + state.view.y;
    const mx = innerWidth * 0.2, my = innerHeight * 0.2;
    if (sx < mx || sx > innerWidth - mx || sy < my + 40 || sy > innerHeight - my) {
      state.view.x += (innerWidth / 2 - sx) * Math.min(1, dt * 2.5);
      state.view.y += (innerHeight / 2 - sy) * Math.min(1, dt * 2.5);
    }
  }
}

// ---------- scenes ----------
function transition(mid) {
  state.fade = { start: performance.now(), mid, switched: false };
}

function enterBuilding(b) {
  transition(() => {
    state.scene = 'room';
    state.roomSession = b.s;
    state.room = createInterior(b.s);
    state.activity = [];
    tip.hidden = true;
    renderHud();
    hud.hidden = false;
    document.body.classList.add('in-room');
    loadActivity();
  });
}

function leaveBuilding() {
  transition(() => {
    state.scene = 'city';
    state.room = null;
    state.roomSession = null;
    hud.hidden = true;
    tip.hidden = true;
    document.body.classList.remove('in-room');
  });
}

function renderHud() {
  const s = state.roomSession;
  const k = KINDS[s.kind];
  const tools = Object.values(s.tools).reduce((a, b) => a + b, 0);
  const stat = (key, v) => `<div class="stat"><div class="k">${key}</div><div class="v">${v}</div></div>`;
  const resume = `cd "${s.cwd}"\nclaude --resume ${s.id}`;
  hud.innerHTML = `
    <button class="back" id="leave">← Back to the city</button>
    <div class="pills">
      <span class="pill" style="--c:${k.color}">${k.label}</span>
      <span class="pill status ${s.status}">${STATUS[s.status]}</span>
    </div>
    <h2>${esc(s.title || s.name || 'Untitled session')}</h2>
    <div class="sub">${esc(s.project)}${s.branch ? ' · ' + esc(s.branch) : ''} · started ${ago(s.startedAt)} · ran ${span(s.startedAt, s.lastActivity)}</div>
    <div class="grid">
      ${stat('Your prompts', s.prompts)}
      ${stat('Actions', fmtNum(tools))}
      ${stat('Failed', s.errors)}
      ${stat('Subagents', s.subagents)}
      ${s.costUSD != null ? stat('Cost', '$' + s.costUSD.toFixed(2)) : stat('Output tokens', fmtNum(s.outputTokens))}
      ${s.linesAdded != null ? stat('Lines', `+${fmtNum(s.linesAdded)} −${fmtNum(s.linesRemoved)}`) : stat('Model', esc((s.model || '').replace('claude-', '')))}
    </div>
    <h3>${s.status === 'working' ? 'Happening now' : 'Last actions'}</h3>
    <ol class="feed" id="feed"></ol>
    <a class="cta" href="/session/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Read the full story →</a>
    <h3>Pick it back up</h3>
    <pre>${esc(resume)}</pre>
    <button id="copy">Copy resume command</button>
    <p class="hint">Hover the furniture to see what each station counts. Click the green exit sign to drive on.</p>`;
  $('leave').onclick = leaveBuilding;
  $('copy').onclick = (e) => navigator.clipboard?.writeText(resume).then(() => { e.target.textContent = 'Copied'; });
  renderFeed();
}

function renderFeed() {
  const feed = $('feed');
  if (!feed) return;
  feed.innerHTML = state.activity.length
    ? state.activity.map((a) => `<li class="${a.failed ? 'bad' : ''}"><span>${esc(a.text)}</span><time>${a.at ? ago(a.at) : ''}</time></li>`).join('')
    : '<li class="muted">Loading…</li>';
}

// ---------- drawing ----------
function drawSky(n) {
  const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
  g.addColorStop(0, mix('#8fd0ee', '#0d1430', n));
  g.addColorStop(1, mix('#e6f4ea', '#25305e', n));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (n > 0.4) {
    ctx.fillStyle = `rgba(255,255,255,${(n - 0.4) * 1.2})`;
    for (let i = 0; i < 70; i++) {
      const x = (i * 9973) % innerWidth, y = (i * 7919) % (innerHeight * 0.6);
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
}

function drawLabels() {
  ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const blk of state.world.blocks) {
    if (!blk.name) continue;
    const [wx, wy] = iso(blk.bx + blk.B, blk.by + blk.B);
    const x = wx * state.view.s + state.view.x, y = wy * state.view.s + state.view.y + 16;
    const w = ctx.measureText(blk.name).width + 18;
    ctx.fillStyle = 'rgba(255,255,255,.93)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 11, w, 22, 11); ctx.fill();
    ctx.fillStyle = '#1d2333';
    ctx.fillText(blk.name, x, y);
  }
}

function roomView() {
  const b = interiorBounds();
  const side = innerWidth > 760 ? 380 : 0;
  const availW = innerWidth - side, availH = innerWidth > 760 ? innerHeight : innerHeight * 0.55;
  const s = Math.min(availW / (b.x1 - b.x0), (availH - 70) / (b.y1 - b.y0), 2.4);
  return { s, x: availW / 2 - ((b.x0 + b.x1) / 2) * s, y: 60 + (availH - 60) / 2 - ((b.y0 + b.y1) / 2) * s };
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  const n = nightAmount();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSky(n);

  if (state.scene === 'city' && state.world?.buildings.length) {
    updateCity(dt);
    const v = state.view;
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
    drawCity(ctx, state.world, { night: n, t, hover: state.hoverId, selected: state.car.target?.s.id }, state.car);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLabels();
  } else if (state.scene === 'room') {
    const s = state.roomSession;
    updateInterior(state.room, dt, s, t);
    const v = state.roomView = roomView();
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
    drawInterior(ctx, state.room, s, { night: n, t }, state.activity);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.status === 'closed') { ctx.fillStyle = 'rgba(20,26,48,.18)'; ctx.fillRect(0, 0, innerWidth, innerHeight); }
  }

  if (state.fade) {
    const p = (t - state.fade.start) / 500;
    if (p >= 0.5 && !state.fade.switched) { state.fade.switched = true; state.fade.mid(); }
    const alpha = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
    ctx.fillStyle = `rgba(12,16,32,${alpha})`;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    if (p >= 1) state.fade = null;
  }
  requestAnimationFrame(frame);
}

// ---------- view & input ----------
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}

function fitCity() {
  if (!state.world?.buildings.length) return;
  const b = worldBounds(state.world);
  const availH = innerHeight - 90;
  const s = Math.max(0.3, Math.min(2, Math.min(innerWidth / (b.x1 - b.x0), availH / (b.y1 - b.y0)) * 0.95));
  state.view = { s, x: innerWidth / 2 - ((b.x0 + b.x1) / 2) * s, y: 70 + availH / 2 - ((b.y0 + b.y1) / 2) * s };
}

function toWorld(mx, my) {
  const v = state.scene === 'room' ? state.roomView : state.view;
  return [(mx - v.x) / v.s, (my - v.y) / v.s];
}

function showTip(e, html) {
  if (!html || e.pointerType !== 'mouse') { tip.hidden = true; return; }
  tip.innerHTML = html;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 280) + 'px';
  tip.style.top = e.clientY + 14 + 'px';
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y, moved: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (drag && state.scene === 'city') {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      state.view.x = drag.vx + dx; state.view.y = drag.vy + dy;
      canvas.classList.add('dragging'); tip.hidden = true;
      return;
    }
  }
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  if (state.scene === 'city' && state.world) {
    const b = buildingAt(state.world, wx, wy);
    state.hoverId = b?.s.id ?? null;
    canvas.classList.toggle('pointing', !!b);
    showTip(e, b && `<b>${esc(b.s.title || 'Untitled session')}</b><br><span class="muted">${KINDS[b.s.kind].label} · ${STATUS[b.s.status]} · ${ago(b.s.lastActivity)}</span><br><span class="go">Click to drive over and go inside</span>`);
  } else if (state.scene === 'room') {
    const hit = pickInterior(state.room, wx, wy);
    const s = state.roomSession;
    canvas.classList.toggle('pointing', !!(hit?.station || hit?.door));
    if (hit?.station) {
      const st = hit.station, count = s.groups?.[st.id] || 0;
      showTip(e, st.id === 'chat'
        ? `<b>Coffee machine</b><br><span class="muted">Where your agent waits for your next prompt</span>`
        : `<b>${st.label}</b><br><span class="muted">${count.toLocaleString()} ${st.unit}</span>`);
    } else showTip(e, hit?.door && '<b>Exit</b><br><span class="muted">Back to the city</span>');
  }
});

canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('dragging');
  const clicked = drag && !drag.moved;
  drag = null;
  if (!clicked || state.fade) return;
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  if (state.scene === 'city' && state.world) {
    const b = buildingAt(state.world, wx, wy);
    if (b) return goTo(b);
    const [gx, gy] = unIso(wx, wy).map(Math.floor);
    if (drivable(state.world, gx, gy)) goTo([gx, gy]);
  } else if (state.scene === 'room') {
    if (pickInterior(state.room, wx, wy)?.door) leaveBuilding();
  }
});

canvas.addEventListener('pointerleave', () => { state.hoverId = null; tip.hidden = true; });

canvas.addEventListener('wheel', (e) => {
  if (state.scene !== 'city') return;
  e.preventDefault();
  const v = state.view;
  const ns = Math.max(0.3, Math.min(3, v.s * Math.exp(-e.deltaY * 0.0015)));
  v.x = e.clientX - (e.clientX - v.x) * (ns / v.s);
  v.y = e.clientY - (e.clientY - v.y) * (ns / v.s);
  v.s = ns;
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('share').hidden) return;
    if (!$('picker').hidden) return closePicker();
    if (state.scene === 'room') leaveBuilding();
  }
});

// ---------- car picker ----------
function openPicker() {
  const picker = $('picker');
  picker.querySelector('.looks').innerHTML = CAR_MODELS.map((m) => `
    <button class="look ${m.id === state.car.model.id ? 'on' : ''}" data-id="${m.id}">
      <canvas width="240" height="160"></canvas><span>${m.label}</span>
    </button>`).join('');
  picker.querySelectorAll('.look').forEach((btn) => {
    const c = btn.querySelector('canvas').getContext('2d');
    c.setTransform(3.4, 0, 0, 3.4, 120, 58);
    drawVehicle(c, 0.5, 0.5, '+x', carById(btn.dataset.id), { scale: 1 });
    btn.onclick = () => {
      state.car.model = carById(btn.dataset.id);
      store.set('sc.car', state.car.model.id);
      closePicker();
    };
  });
  picker.hidden = false;
}
function closePicker() { $('picker').hidden = true; }

// ---------- wire up ----------
$('range').onchange = (e) => { state.range = e.target.value; rebuild(); fitCity(); renderStats(); };
$('fit').onclick = () => { if (state.scene === 'city') fitCity(); };
$('sky').onclick = () => {
  state.sky = { auto: 'day', day: 'night', night: 'auto' }[state.sky];
  store.set('sc.sky', state.sky);
  renderSkyButton();
};
$('me').onclick = openPicker;
$('needs').onclick = () => {
  const b = state.world.buildings.find((x) => x.s.status === 'waiting');
  if (!b) return;
  if (state.scene === 'room') leaveBuilding();
  goTo(b);
};
$('share-btn').onclick = () => {
  if (!state.world?.buildings.length) return;
  openShare($('share'), (showNames) => ({
    canvas: renderPostcard(state.world, cityStats(state.world), {
      night: nightAmount(), showNames, t: performance.now(),
      player: { ...state.car, moving: false },
    }),
    stats: cityStats(state.world),
  }));
};

$('legend').innerHTML = Object.values(KINDS)
  .map((k) => `<div><span class="sw" style="background:${k.color}"></span>${k.label}</div><div class="muted">${k.desc}</div>`)
  .join('');

addEventListener('resize', resize);
resize();
renderSkyButton();
if (!store.get('sc.car')) openPicker();
load();
setInterval(load, 4000);
setInterval(loadActivity, 3000);
requestAnimationFrame(frame);
