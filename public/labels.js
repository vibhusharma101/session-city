// Map-style labels, drawn in HTML over the 3D city so they stay crisp and
// readable at any zoom. Every frame each candidate label is projected to the
// screen, ranked, and placed (see place.js): a label that would overlap a
// higher-ranked one fades out instead of piling on top of it. What is shown
// depends on the zoom, like a map: colony names from far away, project names
// in between, session titles up close. Sessions that need you are always
// shown, and point to themselves from the screen edge when they are off-screen.
import * as THREE from './three.js';
import { COLONIES } from './layout.js';
import { STATUS } from './models.js';
import { place } from './place.js';
import { esc, fmtNum } from './util.js';

const EDGE = { top: 76, side: 18, bottom: 64 };
const titleOf = (s) => s.title || 'Untitled session';
const short = (t, n = 28) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
const statusOf = (s) => (STATUS[s.status] ? s.status : 'closed'); // only known values reach the markup

export class Labels {
  constructor(root, city, { select, coins }) {
    this.root = root;
    this.city = city;
    this.select = select;
    this.coins = coins;
    this.items = [];
    this.v = new THREE.Vector3();
  }

  // Rebuilds the label set for a new layout.
  build() {
    const { city } = this, L = city.L;
    this.root.textContent = '';
    this.items = [];
    const add = (item) => {
      const el = document.createElement('div');
      el.className = 'lb ' + item.cls;
      this.root.append(el);
      Object.assign(item, { el, key: '', shown: false });
      this.items.push(item);
      if (item.click) {
        // tags are buttons: clickable, and reachable from the keyboard
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.addEventListener('click', (e) => { e.stopPropagation(); item.click(); });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); } });
      }
      // let the wheel keep zooming the map when the cursor is over a label
      el.addEventListener('wheel', (e) => { e.preventDefault(); city.renderer.domElement.dispatchEvent(new WheelEvent('wheel', e)); }, { passive: false });
      return item;
    };
    for (const c of L.colonies) {
      add({
        type: 'colony', cls: 'lb-colony ' + c.id,
        world: city.toWorld(c.ox + c.w / 2, c.h / 2, 0.5),
        content: () => c.id,
        html: () => `${COLONIES[c.id].name}<small>${COLONIES[c.id].desc}</small>`,
      });
    }
    for (const blk of L.blocks) {
      const recs = L.buildings.filter((b) => b.gx >= blk.bx && b.gx < blk.bx + blk.B && b.gy >= blk.by && b.gy < blk.by + blk.B).map((b) => city.recs.get(b.s.id)).filter(Boolean);
      const counts = () => ({ live: recs.filter((r) => r.s.status !== 'closed').length, need: recs.filter((r) => r.s.status === 'waiting').length });
      add({
        type: 'district', cls: 'lb-district',
        world: city.toWorld(blk.bx + blk.B / 2, blk.by + blk.B / 2, 0.4),
        content: () => { const { live, need } = counts(); return `${recs.length}|${live}|${need}`; },
        html: () => {
          const { live, need } = counts();
          return `${esc(blk.name)}<small>${recs.length} session${recs.length === 1 ? '' : 's'}${live ? ` · <i class="live">${live} live</i>` : ''}${need ? ` · <i class="need">${need} need you</i>` : ''}</small>`;
        },
        click: () => { const r = recs.find((x) => x.s.status === 'waiting') ?? recs[0]; if (r) city.focus(r, 30); },
      });
    }
    for (const rec of city.recs.values()) {
      const pin = add({ type: 'pin', cls: 'lb-pin', rec, click: () => this.select(rec) });
      pin.el.addEventListener('pointerenter', () => { this.hoverPin = rec; });
      pin.el.addEventListener('pointerleave', () => { if (this.hoverPin === rec) this.hoverPin = null; });
      // the off-screen arrow, used while the session needs you
      add({ type: 'edge', cls: 'lb-edge', rec, click: () => { city.focus(rec, 26); this.select(rec); } });
    }
  }

  // How much a session's pin says, and how much it matters (higher wins a collision).
  pinState(rec, dist) {
    const s = rec.s, coins = this.coins(rec);
    const sel = rec === this.city.selected, hov = rec === this.city.hover || rec === this.hoverPin;
    const need = s.status === 'waiting', live = s.status !== 'closed';
    const close = dist < 34, mid = dist < 70;
    // up close everything gets a title; further out, only what is worth your attention
    const full = sel || hov || close || (mid && need);
    if (!full && !need && s.status !== 'working' && !coins && !mid) return null;
    if (!full && !live && !coins) return null;
    let pri = need ? 900 : s.status === 'working' ? 500 : s.status === 'open' ? 300 : 100;
    pri += Math.min(150, Math.log2(1 + coins) * 15);
    if (hov) pri = 2000;
    if (sel) pri = 3000;
    return { full, coins, need, sel, hov, pri, force: sel || need };
  }

  pinHtml(rec, st) {
    const coin = st.coins ? `<span class="coin">🪙 ${fmtNum(st.coins)}</span>` : '';
    const dot = `<span class="dot ${statusOf(rec.s)}">${st.need ? '!' : ''}</span>`;
    return st.full ? `${dot}<span class="t">${esc(short(titleOf(rec.s)))}</span>${coin}` : dot + coin;
  }

  update() {
    const { city, v } = this, cam = city.camera;
    if (!city.L) return;
    const W = innerWidth, H = innerHeight;
    const dist = city.rig.dist;
    const states = new Map();
    for (const it of this.items) if (it.type === 'pin') states.set(it.rec, this.pinState(it.rec, dist));
    const cands = [];
    for (const it of this.items) {
      let key, html, pri, force = false, x, y, dir;
      if (it.type === 'edge') {
        const at = states.get(it.rec)?.need && this.edgeSpot(it.rec, W, H);
        if (!at) { this.hide(it); continue; }
        ({ x, y } = at);
        it.angle = at.angle;
        key = it.rec.s.title;
        html = () => `<span class="arrow"></span><span class="dot waiting">!</span><span class="t">${esc(short(titleOf(it.rec.s), 22))}</span>`;
        pri = 950; force = true;
        dir = y < H / 2 ? 1 : -1; // arrows along the top stack downwards, away from the bar
      } else {
        const st = it.type === 'pin' ? states.get(it.rec) : null;
        if (it.type === 'colony') {
          if (dist < 60) { this.hide(it); continue; }
          v.copy(it.world);
          pri = 1200;
        } else if (it.type === 'district') {
          if (dist < 26 || dist > 150) { this.hide(it); continue; }
          v.copy(it.world);
          pri = dist > 60 ? 1100 : 700;
        } else {
          if (!st) { this.hide(it); continue; }
          city.labelAnchor(it.rec, v);
          pri = st.pri; force = st.force;
        }
        v.project(cam);
        // a waiting session whose anchor is off-screen is shown by its edge arrow instead
        const out = st?.need ? 1 : 1.2;
        if (v.z > 1 || Math.abs(v.x) > out || Math.abs(v.y) > out) { this.hide(it); continue; }
        x = (v.x + 1) / 2 * W; y = (1 - v.y) / 2 * H;
        if (st) {
          key = `${statusOf(it.rec.s)}|${st.full}|${st.coins}|${it.rec.s.title}`;
          html = () => this.pinHtml(it.rec, st);
          it.el.classList.toggle('sel', st.sel);
          it.el.classList.toggle('compact', !st.full);
          it.el.classList.toggle('need', st.need);
        } else { key = it.content(); html = it.html; }
      }
      if (key !== it.key) { it.key = key; it.el.innerHTML = html(); it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
      // pins hang above their anchor; everything else centres on its spot
      const box = it.type === 'pin'
        ? { l: x - it.w / 2, r: x + it.w / 2, t: y - it.h - 8, b: y }
        : { l: x - it.w / 2, r: x + it.w / 2, t: y - it.h / 2, b: y + it.h / 2 };
      // a little stickiness stops labels flickering as the camera moves
      cands.push({ it, x, y, box, pri: pri + (it.shown ? 60 : 0), force, dir });
    }
    const shown = place(cands, [{ l: 0, r: W, t: 0, b: EDGE.top - 8 }]); // keep clear of the top bar
    const on = new Set();
    for (const { c, dy } of shown) { on.add(c.it); this.show(c.it, c.x, c.y + dy); }
    for (const c of cands) if (!on.has(c.it)) this.hide(c.it);
  }

  show(it, x, y) {
    if (!it.shown) { it.shown = true; it.el.classList.add('on'); }
    const px = Math.round(x), py = Math.round(y);
    if (px !== it.px || py !== it.py) { it.px = px; it.py = py; it.el.style.transform = `translate3d(${px}px,${py}px,0)`; }
    if (it.type === 'edge') {
      it.el.style.setProperty('--reach', it.w / 2 + 2 + 'px');
      it.el.firstChild.style.transform = `rotate(${it.angle}rad)`;
    }
  }

  hide(it) {
    if (it.shown) { it.shown = false; it.el.classList.remove('on'); }
  }

  // Where on the screen edge to point at an off-screen session, or null while
  // it is on screen.
  edgeSpot(rec, W, H) {
    const v = this.city.labelAnchor(rec, this.v).project(this.city.camera);
    const behind = v.z > 1;
    const nx = behind ? -v.x : v.x, ny = behind ? -v.y : v.y;
    if (!behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) return null;
    // clamp the direction onto the screen rectangle, inside the top and bottom bars
    const cx = W / 2, cy = H / 2;
    const dx = nx * cx, dy = -ny * cy;
    const sx = (cx - EDGE.side - 70) / Math.max(1e-6, Math.abs(dx));
    const sy = ((dy < 0 ? cy - EDGE.top : cy - EDGE.bottom) - 20) / Math.max(1e-6, Math.abs(dy));
    const k = Math.min(sx, sy);
    return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
  }

  // District names as drawn on screen right now, for the share postcard.
  snapshot() {
    return this.items.filter((it) => it.shown && it.type === 'district').map((it) => ({ text: it.el.firstChild?.textContent ?? '', x: it.px, y: it.py }));
  }

  setVisible(on) { this.root.hidden = !on; }
}
