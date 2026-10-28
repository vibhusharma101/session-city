import * as THREE from './three.js';
import { City } from './city3d.js';
import { Room } from './room3d.js';
import { buildLayout, colonyOf, COLONIES } from './layout.js';
import { KINDS, STATUS, CAR_MODELS, carById, makeCar, dispose } from './models.js';
import { createGame, pending, collect, levelOf, quests, progress, claim, visited, actionsOf } from './game.js';
import { sfx } from './sfx.js';
import { renderPostcard, cityStats, openShare } from './share.js';
import { esc, fmtNum, ago, span, store } from './util.js';
import { demoCity, demoActivity } from './demo.js';

// ?demo shows a made-up city instead of this machine's sessions.
const DEMO = new URLSearchParams(location.search).has('demo');
if (DEMO) store.ns = 'demo:';

const $ = (id) => document.getElementById(id);
const canvas = $('city'), tip = $('tip'), hud = $('hud'), card = $('card'), bubble = $('bubble');

const game = createGame();
const state = {
  data: null,
  range: 'all',
  layoutKey: '',
  scene: 'city',
  room: null,
  roomSession: null,
  activity: [],
  sky: 'auto', // follows the local clock on every load; the button overrides it until reload
  car: carById(store.get('sc.car')),
  seen: new Set(store.json('sc.seen', [])),
  loaded: false,
  enterOnArrive: null,
  hoverId: null,
};

const city = new City(canvas, {
  hover(rec, e, coin) {
    if ((rec?.s.id ?? null) !== state.hoverId) { state.hoverId = rec?.s.id ?? null; if (rec) sfx.hover(); }
    if (!rec || e.pointerType !== 'mouse') { tip.hidden = true; return; }
    const s = rec.s, p = pending(game, s);
    tip.innerHTML = coin
      ? `<b>Collect ${fmtNum(p)} coins</b><span class="muted">one for every action in this session</span>`
      : `<b>${esc(s.title || 'Untitled session')}</b><span class="muted">${KINDS[s.kind].label} · ${STATUS[s.status]} · ${COLONIES[rec.colony].name}</span>`
        + (p ? `<br><span style="color:#c8961d;font-weight:800">🪙 ${fmtNum(p)} coins ready</span>` : '');
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 16, innerWidth - 290) + 'px';
    tip.style.top = e.clientY + 16 + 'px';
  },
  select: (rec) => selectBuilding(rec),
  coin: (rec) => collectFrom(rec),
  arrive(rec) {
    sfx.honk();
    city.bounce(rec);
    city.focus(rec, 26);
    if (state.enterOnArrive === rec.s.id) { state.enterOnArrive = null; enter(rec); }
    else if (city.selected === rec) renderCard();
  },
  drove: (n) => questsDone(progress(game, 'drive', n)),
  ground() { sfx.click(); closeCard(); },
});
city.active = true;
if (new URLSearchParams(location.search).has('debug')) window.sc = { city, game, state }; // for poking at it from devtools

// ---------- data ----------
const inRange = (s) => state.range === 'all' || Date.parse(s.lastActivity) >= Date.now() - Number(state.range) * 864e5;
const allSessions = () => state.data?.districts.flatMap((d) => d.sessions) ?? [];
const findSession = (id) => allSessions().find((s) => s.id === id) ?? null;

function rebuild() {
  const ds = state.data.districts.map((d) => ({ name: d.name, list: d.sessions.filter(inRange) })).filter((d) => d.list.length);
  const key = state.range + '|' + ds.map((d) => d.name + ':' + d.list.map((s) => s.id + colonyOf(s)).join(',')).join('|');
  if (key !== state.layoutKey) {
    state.layoutKey = key;
    const first = !state.loaded;
    const fresh = [];
    city.setLayout(buildLayout(ds), state.car, (s) => {
      const isNew = !state.seen.has(s.id);
      if (isNew && !first) fresh.push(s);
      return first || isNew;
    });
    for (const s of fresh) { toast(`🏗️ New building: ${s.title || 'a new session'}`); sfx.build(); }
    for (const d of ds) for (const s of d.list) state.seen.add(s.id);
    store.setJson('sc.seen', [...state.seen]);
  } else {
    for (const rec of city.recs.values()) rec.s = rec.b.s = findSession(rec.s.id) ?? rec.s;
  }
  for (const rec of city.recs.values()) city.setPending(rec.s.id, pending(game, rec.s));
  $('empty').hidden = city.recs.size > 0;
}

async function load() {
  try {
    const data = DEMO ? demoCity() : await (await fetch('/api/city', { cache: 'no-store' })).json();
    if (data.error) throw new Error(data.error);
    state.data = data;
  } catch (e) {
    $('stats').textContent = 'Could not read sessions: ' + e.message;
    return;
  }
  rebuild();
  quests(game, allSessions());
  renderTop();
  if (city.selected && !card.hidden) renderCard();
  if (state.scene === 'room') {
    state.roomSession = findSession(state.roomSession.id) ?? state.roomSession;
    renderHud();
  }
  if (!state.loaded) {
    state.loaded = true;
    $('loading').style.opacity = 0;
    setTimeout(() => $('loading').remove(), 500);
    if (!store.get('sc.car') && !DEMO) setTimeout(openPicker, 1400);
  }
}

async function loadActivity() {
  if (state.scene !== 'room') return;
  try {
    const data = DEMO ? { actions: demoActivity(state.roomSession) }
      : await (await fetch(`/api/session/${encodeURIComponent(state.roomSession.id)}/activity`, { cache: 'no-store' })).json();
    state.activity = data.actions ?? [];
    renderFeed();
  } catch { /* keep the last feed */ }
}

// ---------- top bar ----------
function renderTop() {
  const recs = [...city.recs.values()];
  const live = recs.filter((r) => r.s.status !== 'closed').length;
  const waiting = recs.filter((r) => r.s.status === 'waiting');
  const byCol = (id) => recs.filter((r) => r.colony === id).length;
  $('stats').innerHTML = `<b>${recs.length}</b> sessions · <b>${live}</b> live · <b>${byCol('oldtown')}</b> abandoned`;
  const needs = $('needs');
  needs.hidden = !waiting.length;
  needs.textContent = `❗ ${waiting.length} need${waiting.length === 1 ? 's' : ''} you`;
  const lv = levelOf(game.xp);
  $('lvl').textContent = lv.level;
  $('xp').style.width = Math.round(lv.progress * 100) + '%';
  $('xp-wrap').title = `${fmtNum(lv.toNext)} XP to level ${lv.level + 1}`;
  $('coin-n').textContent = fmtNum(game.coins);
  const ready = quests(game, allSessions()).filter((q) => q.done && !q.claimed).length;
  $('quest-badge').hidden = !ready;
  $('quest-badge').textContent = ready;
  if (!$('quests').hidden) renderQuests();
}

function toast(text, big = false) {
  const el = document.createElement('div');
  el.className = 'toast panel' + (big ? ' big' : '');
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 2700);
}

// ---------- the building card ----------
function selectBuilding(rec) {
  sfx.click();
  city.bounce(rec);
  city.selected = rec;
  state.enterOnArrive = null;
  city.driveTo(rec);
  renderCard();
}

function carAt(rec) {
  const c = city.car;
  return !c.path.length && Math.abs(c.x - (rec.b.gx + 0.5)) + Math.abs(c.y - (rec.b.gy + 0.5)) <= 2.5;
}

function renderCard() {
  const rec = city.selected;
  if (!rec) return;
  const s = rec.s, k = KINDS[s.kind], p = pending(game, s);
  const here = carAt(rec);
  card.innerHTML = `
    <button class="x" id="card-x" aria-label="Close">✕</button>
    <div class="kind"><span class="sw" style="background:${k.color}"></span>${k.label}</div>
    <h2>${esc(s.title || 'Untitled session')}</h2>
    <div class="row">
      <span class="chip ${rec.colony}">${COLONIES[rec.colony].name}</span>
      <span class="chip status-${s.status}">${STATUS[s.status]}</span>
      <span class="chip">${esc(rec.b.district)}</span>
      <span class="chip">${ago(s.lastActivity)}</span>
    </div>
    <div class="nums">
      <div class="num"><b>${s.prompts}</b><span>prompts</span></div>
      <div class="num"><b>${fmtNum(actionsOf(s))}</b><span>actions</span></div>
      <div class="num"><b>${s.errors}</b><span>failed</span></div>
    </div>
    <div class="actions">
      ${p ? `<button class="btn-gold" id="card-collect">🪙 Collect ${fmtNum(p)}</button>` : ''}
      <button class="btn-go" id="card-enter">${here ? '🚪 Go inside' : state.enterOnArrive === s.id ? '🚗 Driving…' : '🚗 Drive & go in'}</button>
      ${DEMO ? '' : `<a class="btn" id="card-story" href="/session/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">📖 Story</a>`}
    </div>`;
  card.hidden = false;
  $('card-x').onclick = closeCard;
  $('card-collect')?.addEventListener('click', () => collectFrom(rec));
  $('card-enter').onclick = () => {
    sfx.click();
    if (carAt(rec)) return enter(rec);
    state.enterOnArrive = s.id;
    city.driveTo(rec);
    renderCard();
  };
  $('card-story')?.addEventListener('click', () => questsDone(progress(game, 'story', 1)));
}

function closeCard() {
  card.hidden = true;
  city.selected = null;
  state.enterOnArrive = null;
}

// ---------- coins, levels, quests ----------
function collectFrom(rec) {
  const res = collect(game, rec.s);
  if (!res.amount) return;
  const from = city.collectFx(rec) ?? { x: innerWidth / 2, y: innerHeight / 2 };
  city.setPending(rec.s.id, 0);
  flyCoins(from, res.amount, () => {
    renderTop();
    toast(`+${fmtNum(res.amount)} coins`);
    if (res.levelUp) levelUp(res.levelUp);
    questsDone(res.done);
  });
  if (city.selected === rec) renderCard();
}

function flyCoins(from, amount, done) {
  const target = $('coins').getBoundingClientRect();
  const n = Math.min(10, 3 + Math.floor(Math.log2(1 + amount)));
  let shown = game.coins - amount;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'fly coin-icon';
    el.textContent = '$';
    const jx = (Math.random() - 0.5) * 60, jy = (Math.random() - 0.5) * 40;
    el.style.transform = `translate(${from.x + jx - 13}px, ${from.y + jy - 13}px)`;
    document.body.append(el);
    setTimeout(() => {
      el.style.transform = `translate(${target.left + 8}px, ${target.top + 8}px) scale(.8)`;
    }, 30 + i * 55);
    setTimeout(() => {
      el.remove();
      sfx.coin(i);
      shown += amount / n;
      $('coin-n').textContent = fmtNum(Math.round(i === n - 1 ? game.coins : shown));
      $('coins').classList.remove('pop'); void $('coins').offsetWidth; $('coins').classList.add('pop');
      if (i === n - 1) done();
    }, 800 + i * 55);
  }
}

function levelUp(level) {
  sfx.levelUp();
  city.confetti(null);
  toast(`⭐ Level ${level}! Your city is growing`, true);
  $('lvl').classList.remove('pop'); void $('lvl').offsetWidth; $('lvl').classList.add('pop');
  const car = CAR_MODELS.find((m) => m.level === level);
  if (car) setTimeout(() => toast(`🚗 New car unlocked: ${car.label}`), 900);
}

function questsDone(list) {
  for (const q of list ?? []) {
    sfx.quest();
    toast(`📜 Quest complete: ${q.text}. Claim ${q.reward} coins!`);
  }
  if (list?.length) renderTop();
}

function renderQuests() {
  const list = quests(game, allSessions());
  $('quests').innerHTML = `<h3>📜 Today's quests</h3>` + list.map((q) => `
    <div class="quest ${q.claimed ? 'claimed' : ''}">
      <div class="qi">${q.icon}</div>
      <div><div>${esc(q.text)}</div><div class="bar"><i style="width:${Math.round(q.have / q.goal * 100)}%"></i></div></div>
      <div>${q.claimed ? '✓' : q.done ? `<button class="btn-go" data-claim="${q.id}">Claim</button>` : `<span class="reward">🪙 ${q.reward}</span>`}</div>
    </div>`).join('') + `<p class="hint">New quests every day.</p>`;
  $('quests').querySelectorAll('[data-claim]').forEach((b) => b.onclick = (e) => {
    const res = claim(game, b.dataset.claim);
    if (!res) return;
    const r = e.target.getBoundingClientRect();
    flyCoins({ x: r.left + r.width / 2, y: r.top }, res.reward, () => {
      renderTop();
      if (res.levelUp) levelUp(res.levelUp);
    });
    sfx.quest();
    renderQuests();
  });
}

// ---------- inside a building ----------
const fade = document.createElement('div');
Object.assign(fade.style, { position: 'fixed', inset: 0, background: '#1b1510', opacity: 0, pointerEvents: 'none', transition: 'opacity .25s', zIndex: 15 });
document.body.append(fade);
function transition(mid) {
  fade.style.opacity = 1;
  setTimeout(() => { mid(); fade.style.opacity = 0; }, 260);
}

function enter(rec) {
  sfx.door();
  questsDone(visited(game, rec.s, rec.colony));
  transition(() => {
    state.scene = 'room';
    city.active = false;
    state.roomSession = rec.s;
    state.roomColony = rec.colony;
    state.room = new Room(rec.s);
    sizeRoom();
    state.activity = [];
    tip.hidden = true;
    card.hidden = true;
    $('quests').hidden = true;
    document.body.classList.add('in-room');
    renderHud();
    hud.hidden = false;
    bubble.hidden = false;
    loadActivity();
  });
}

function leave() {
  sfx.door();
  transition(() => {
    state.scene = 'city';
    city.active = true;
    dispose(state.room.scene);
    state.room = null;
    hud.hidden = true;
    bubble.hidden = true;
    tip.hidden = true;
    document.body.classList.remove('in-room');
    if (city.selected) renderCard();
  });
}

function renderHud() {
  const s = state.roomSession;
  const k = KINDS[s.kind];
  const resume = `cd "${s.cwd}"\nclaude --resume ${s.id}`;
  const model = (s.model || '').replace('claude-', '');
  hud.innerHTML = `
    <button class="back" id="leave">← Back to the city</button>
    <div class="kind" style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)"><span class="sw" style="background:${k.color}"></span> ${k.label}</div>
    <h2>${esc(s.title || 'Untitled session')}</h2>
    <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px">
      <span class="chip ${state.roomColony}">${COLONIES[state.roomColony].name}</span>
      <span class="chip status-${s.status}">${STATUS[s.status]}</span>
      <span class="chip">${esc(s.project)}${s.branch ? ' · ' + esc(s.branch) : ''}</span>
    </div>
    <div class="nums" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
      <div class="num"><b>${s.prompts}</b><span>prompts</span></div>
      <div class="num"><b>${fmtNum(actionsOf(s))}</b><span>actions</span></div>
      <div class="num"><b>${s.errors}</b><span>failed</span></div>
      <div class="num"><b style="font-size:14px">${span(s.startedAt, s.lastActivity)}</b><span>ran for</span></div>
    </div>
    <h3>${s.status === 'working' ? 'Happening now' : 'Last actions'}</h3>
    <ol class="feed" id="feed"></ol>
    ${DEMO ? '' : `<a class="btn btn-accent cta" id="hud-story" href="/session/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">📖 Read the full story</a>`}
    <details class="more">
      <summary>More</summary>
      <p class="muted">${s.subagents} subagents · ${fmtNum(s.outputTokens)} output tokens${model ? ' · ' + esc(model) : ''}</p>
      <pre>${esc(resume)}</pre>
      <button id="copy">Copy resume command</button>
    </details>`;
  $('leave').onclick = leave;
  $('hud-story')?.addEventListener('click', () => questsDone(progress(game, 'story', 1)));
  $('copy').onclick = (e) => navigator.clipboard?.writeText(resume).then(() => { e.target.textContent = 'Copied'; });
  renderFeed();
}

function renderFeed() {
  const feed = $('feed');
  if (!feed) return;
  feed.innerHTML = state.activity.length
    ? state.activity.slice(0, 6).map((a) => `<li class="${a.failed ? 'bad' : ''}"><span title="${esc(a.text)}">${esc(a.text)}</span><time>${a.at ? ago(a.at) : ''}</time></li>`).join('')
    : '<li class="muted">Loading…</li>';
}

function bubbleText(s) {
  if (s.status === 'waiting') return 'I need you! Check your terminal.';
  if (s.status === 'open') return 'Coffee break. Ready for your next prompt.';
  if (s.status === 'closed') return 'Zzz… this session is closed.';
  return state.activity[0]?.text || 'Working…';
}

function sizeRoom() {
  if (!state.room) return;
  const side = innerWidth > 760 ? 380 : 0;
  const cam = state.room.camera;
  state.room.resize(innerWidth - side, innerWidth > 760 ? innerHeight : innerHeight * 0.55);
  cam.aspect = innerWidth / innerHeight;
  // shift the picture so the room sits in the space left of the panel (or above the sheet on phones)
  if (side) cam.setViewOffset(innerWidth, innerHeight, side / 2, 0, innerWidth, innerHeight);
  else cam.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.22, innerWidth, innerHeight);
  cam.updateProjectionMatrix();
}

// room input: drag to look around, hover furniture, click the exit
const ray = new THREE.Raycaster();
function roomPick(e) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), state.room.camera);
  return state.room.pick(ray);
}
let roomDrag = null;
canvas.addEventListener('pointerdown', (e) => { if (state.scene === 'room') roomDrag = { x: e.clientX, sx: e.clientX, moved: false }; });
canvas.addEventListener('pointermove', (e) => {
  if (state.scene !== 'room' || !state.room) return;
  if (roomDrag && Math.abs(e.clientX - roomDrag.sx) > 5) {
    roomDrag.moved = true;
    state.room.rotate(e.clientX - roomDrag.x);
    roomDrag.x = e.clientX;
    return;
  }
  const hit = roomPick(e);
  canvas.classList.toggle('pointing', !!hit);
  if (!hit || e.pointerType !== 'mouse') { tip.hidden = true; return; }
  const s = state.roomSession;
  tip.innerHTML = hit.door ? '<b>Exit</b><span class="muted">Back to the city</span>'
    : hit.station.id === 'chat' ? '<b>Coffee machine</b><span class="muted">Where your agent waits for your next prompt</span>'
    : `<b>${hit.station.label}</b><span class="muted">${(s.groups?.[hit.station.id] || 0).toLocaleString()} ${hit.station.unit}</span>`;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 16, innerWidth - 290) + 'px';
  tip.style.top = e.clientY + 16 + 'px';
});
canvas.addEventListener('pointerup', (e) => {
  if (state.scene !== 'room' || !state.room) return;
  const d = roomDrag;
  roomDrag = null;
  if (d && !d.moved && roomPick(e)?.door) leave();
});

// ---------- sky ----------
function nightAmount() {
  if (state.sky === 'day') return 0;
  if (state.sky === 'night') return 1;
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  if (h >= 7 && h < 18) return 0;
  if (h >= 19 || h < 6) return 1;
  return h < 7 ? 1 - (h - 6) : h - 18;
}
function renderSkyButton() {
  $('sky').textContent = { auto: '◐', day: '☀', night: '☾' }[state.sky];
  $('sky').title = { auto: 'Sky follows your clock', day: 'Always day', night: 'Always night' }[state.sky];
}

// ---------- loop ----------
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  const n = nightAmount();
  if (state.scene === 'room' && state.room) {
    const s = state.roomSession;
    state.room.update(dt, t, s, n);
    const u = city.post.uniforms;
    u.uBlur.value = 0.45; u.uBand.value = 0.3; u.uFocus.value = 0.5;
    city.post.render(state.room.scene, state.room.camera);
    const p = state.room.headPosition().project(state.room.camera);
    const r = canvas.getBoundingClientRect();
    bubble.style.left = (p.x + 1) / 2 * r.width + 'px';
    bubble.style.top = (1 - p.y) / 2 * r.height + 'px';
    const text = bubbleText(s);
    if (bubble.textContent !== text) bubble.textContent = text;
    bubble.classList.toggle('waiting', s.status === 'waiting');
  } else {
    city.setNight(n);
    city.update(dt, t);
    city.render();
  }
  requestAnimationFrame(frame);
}

function resize() {
  city.resize(innerWidth, innerHeight);
  sizeRoom();
}

// ---------- car garage ----------
let previews = null;
function carPreviews() {
  if (previews) return previews;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(280, 180);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b0a080', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 280 / 180, 0.1, 50);
  cam.position.set(2.1, 1.5, 2.4);
  cam.lookAt(0, 0.25, 0);
  previews = {};
  for (const m of CAR_MODELS) {
    const car = makeCar(m);
    car.rotation.y = 0.2;
    scene.add(car);
    r.render(scene, cam);
    previews[m.id] = r.domElement.toDataURL();
    scene.remove(car);
  }
  r.dispose();
  return previews;
}

function openPicker() {
  const level = levelOf(game.xp).level;
  const imgs = carPreviews();
  const looks = $('picker').querySelector('.looks');
  looks.innerHTML = CAR_MODELS.map((m) => `
    <button class="look ${m.id === state.car.id ? 'on' : ''} ${level < m.level ? 'locked' : ''}" data-id="${m.id}" ${level < m.level ? 'aria-disabled="true"' : ''}>
      <img src="${imgs[m.id]}" alt=""><span>${m.label}</span>${level < m.level ? `<span class="lock">🔒 Level ${m.level}</span>` : ''}
    </button>`).join('');
  looks.querySelectorAll('.look').forEach((btn) => {
    btn.onclick = () => {
      const m = carById(btn.dataset.id);
      if (level < m.level) { toast(`🔒 Reach level ${m.level} to unlock the ${m.label}`); return; }
      sfx.honk();
      state.car = m;
      store.set('sc.car', m.id);
      city.setCar(m);
      closePicker();
    };
  });
  $('picker').hidden = false;
}
function closePicker() { $('picker').hidden = true; if (!store.get('sc.car')) store.set('sc.car', state.car.id); }

// ---------- wire up ----------
$('range').onchange = (e) => { state.range = e.target.value; rebuild(); city.fit(); renderTop(); };
$('fit').onclick = () => { sfx.whoosh(); city.fit(); };
$('rot-l').onclick = () => { sfx.whoosh(); city.rotate(-1); };
$('rot-r').onclick = () => { sfx.whoosh(); city.rotate(1); };
$('sky').onclick = () => {
  state.sky = { auto: 'day', day: 'night', night: 'auto' }[state.sky];
  renderSkyButton();
};
$('me').onclick = openPicker;
$('picker-x').onclick = closePicker;
$('picker').onclick = (e) => { if (e.target === $('picker')) closePicker(); };
$('mute').onclick = () => { $('mute').textContent = sfx.toggle() ? '🔇' : '🔊'; sfx.click(); };
$('mute').textContent = sfx.muted ? '🔇' : '🔊';
$('quests-btn').onclick = () => { sfx.click(); $('quests').hidden = !$('quests').hidden; if (!$('quests').hidden) renderQuests(); };
$('needs').onclick = () => {
  const rec = [...city.recs.values()].find((r) => r.s.status === 'waiting');
  if (!rec) return;
  if (state.scene === 'room') leave();
  city.focus(rec);
  selectBuilding(rec);
};
$('share-btn').onclick = () => {
  if (!city.recs.size) return;
  openShare($('share'), (showNames) => {
    const vis = city.labels.map((l) => l.visible);
    city.labels.forEach((l) => { l.visible = showNames; });
    city.render();
    const out = renderPostcard(city.renderer.domElement, cityStats(city.L), { night: nightAmount() });
    city.labels.forEach((l, i) => { l.visible = vis[i]; });
    return { canvas: out, stats: cityStats(city.L) };
  });
};

$('legend').innerHTML = Object.values(KINDS)
  .map((k) => `<div><span class="sw" style="background:${k.color}"></span> ${k.label}</div><div class="muted">${k.desc}</div>`)
  .join('');

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('share').hidden) return;
  if (!$('picker').hidden) return closePicker();
  if (state.scene === 'room') return leave();
  if (!$('quests').hidden) { $('quests').hidden = true; return; }
  closeCard();
});

addEventListener('resize', resize);
resize();
renderSkyButton();
load();
setInterval(load, 4000);
setInterval(loadActivity, 3000);
requestAnimationFrame(frame);
