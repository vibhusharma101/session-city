// Map-style labels, drawn in HTML over the 3D city so they stay crisp and
// readable at any zoom. Every frame each candidate label is projected to the
// screen, ranked, and placed greedily: a label that would overlap a
// higher-ranked one fades out instead of piling on top of it. What is shown
// depends on the zoom, like a map: colony names from far away, project names
// in between, session titles up close. Sessions that need you are always
// shown, and point to themselves from the screen edge when they are off-screen.
import * as THREE from './three.js';
import { COLONIES } from './layout.js';
import { STATUS } from './models.js';
import { esc, fmtNum } from './util.js';

const PAD = 6;            // breathing room between labels, in px
const EDGE = { top: 76, side: 18, bottom: 64 };
const titleOf = (s) => s.title || 'Untitled session';
const short = (t, n = 28) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

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
      item.el = el;
      item.key = '';
      item.shown = false;
      this.items.push(item);
      return item;
    };
    for (const c of L.colonies) {
      add({
        type: 'colony', cls: 'lb-colony ' + c.id,
        world: city.toWorld(c.ox + c.w / 2, c.h / 2, 0.5),
        html: () => `${COLONIES[c.id].name}<small>${COLONIES[c.id].desc}</small>`,
        content: () => c.id,
      });
    }
    for (const blk of L.blocks) {
      const recs = L.buildings.filter((b) => b.gx >= blk.bx && b.gx < blk.bx + blk.B && b.gy >= blk.by && b.gy < blk.by + blk.B).map((b) => city.recs.get(b.s.id)).filter(Boolean);
      add({
        type: 'district', cls: 'lb-district', recs,
        world: city.toWorld(blk.bx + blk.B / 2, blk.by + blk.B / 2, 0.4),
        content: () => {
          const live = recs.filter((r) => r.s.status !== 'closed').length;
          const need = recs.filter((r) => r.s.status === 'waiting').length;
          return `${blk.name}|${recs.length}|${live}|${need}`;
        },
        html: () => {
          const live = recs.filter((r) => r.s.status !== 'closed').length;
          const need = recs.filter((r) => r.s.status === 'waiting').length;
          return `${esc(blk.name)}<small>${recs.length} session${recs.length === 1 ? '' : 's'}${live ? ` · <i class="live">${live} live</i>` : ''}${need ? ` · <i class="need">${need} need you</i>` : ''}</small>`;
        },
        click: () => { const r = recs.find((x) => x.s.status === 'waiting') ?? recs[0]; if (r) { city.focus(r, 30); } },
      });
    }
    for (const rec of city.recs.values()) {
      const item = add({ type: 'pin', cls: 'lb-pin', rec, click: () => this.select(rec) });
      item.el.addEventListener('pointerenter', () => { this.hoverPin = rec; });
      item.el.addEventListener('pointerleave', () => { if (this.hoverPin === rec) this.hoverPin = null; });
      // the off-screen arrow, used while the session needs you
      item.edge = document.createElement('div');
      item.edge.className = 'lb lb-edge';
      item.edge.addEventListener('click', () => { city.focus(rec, 26); this.select(rec); });
      this.root.append(item.edge);
    }
    for (const it of this.items) {
      if (it.click) it.el.addEventListener('click', (e) => { e.stopPropagation(); it.click(); });
      // let the wheel keep zooming the map when the cursor is over a label
      it.el.addEventListener('wheel', (e) => { e.preventDefault(); city.renderer.domElement.dispatchEvent(new WheelEvent('wheel', e)); }, { passive: false });
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
    if (!full && !need && !(s.status === 'working') && !coins && !mid) return null;
    if (!full && !live && !coins) return null;
    let pri = need ? 900 : s.status === 'working' ? 500 : s.status === 'open' ? 300 : 100;
    pri += Math.min(150, Math.log2(1 + coins) * 15);
    if (hov) pri = 2000;
    if (sel) pri = 3000;
    return { full, coins, need, sel, hov, pri, force: sel || need };
  }

  pinHtml(rec, st) {
    const s = rec.s;
    const coin = st.coins ? `<span class="coin">🪙 ${fmtNum(st.coins)}</span>` : '';
    if (!st.full) return `<span class="dot ${s.status}">${st.need ? '!' : ''}</span>${coin}`;
    return `<span class="dot ${s.status}">${st.need ? '!' : ''}</span><span class="t">${esc(short(titleOf(s)))}</span>${coin}`;
  }

  update() {
    const { city, v } = this, cam = city.camera;
    if (!city.L) return;
    const W = innerWidth, H = innerHeight;
    const dist = city.rig.dist;
    const cands = [];
    for (const it of this.items) {
      let html, key, pri, force = false;
      if (it.type === 'colony') {
        if (dist < 60) { this.hide(it); continue; }
        v.copy(it.world);
        key = it.content(); html = it.html; pri = 1200;
      } else if (it.type === 'district') {
        if (dist < 26 || dist > 150) { this.hide(it); continue; }
        v.copy(it.world);
        key = it.content(); html = it.html; pri = dist > 60 ? 1100 : 700;
      } else {
        const st = this.pinState(it.rec, dist);
        this.edge(it, st);
        if (!st) { this.hide(it); continue; }
        city.labelAnchor(it.rec, v);
        key = `${it.rec.s.status}|${st.full}|${st.coins}|${it.rec.s.title}`;
        html = () => this.pinHtml(it.rec, st);
        pri = st.pri; force = st.force;
        it.el.classList.toggle('sel', st.sel);
        it.el.classList.toggle('compact', !st.full);
        it.el.classList.toggle('need', st.need);
      }
      v.project(cam);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { this.hide(it); continue; }
      if (key !== it.key) { it.key = key; it.el.innerHTML = html(); it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      // pins hang above their anchor; area labels centre on theirs
      const box = it.type === 'pin'
        ? { l: x - it.w / 2, r: x + it.w / 2, t: y - it.h - 8, b: y }
        : { l: x - it.w / 2, r: x + it.w / 2, t: y - it.h / 2, b: y + it.h / 2 };
      // a little stickiness stops labels flickering as the camera moves
      cands.push({ it, x, y, box, pri: pri + (it.shown ? 60 : 0), force });
    }
    cands.sort((a, b) => (b.force - a.force) || (b.pri - a.pri)); // must-shows claim their space first
    const placed = [{ l: 0, r: W, t: 0, b: EDGE.top - 8 }]; // keep clear of the top bar
    for (const c of cands) {
      const { box } = c;
      const clash = placed.some((p) => box.l < p.r + PAD && box.r > p.l - PAD && box.t < p.b + PAD && box.b > p.t - PAD);
      if (clash && !c.force) { this.hide(c.it); continue; }
      placed.push(box);
      this.show(c.it, c.x, c.y);
    }
  }

  show(it, x, y) {
    if (!it.shown) { it.shown = true; it.el.classList.add('on'); }
    const px = Math.round(x), py = Math.round(y);
    if (px !== it.px || py !== it.py) { it.px = px; it.py = py; it.el.style.transform = `translate3d(${px}px,${py}px,0)`; }
  }

  hide(it) {
    if (it.shown) { it.shown = false; it.el.classList.remove('on'); }
  }

  // Sessions that need you, when they are off-screen, get an arrow on the
  // screen edge pointing at them.
  edge(it, st) {
    const el = it.edge;
    if (!el) return;
    if (!st?.need) { el.classList.remove('on'); return; }
    const v = this.city.labelAnchor(it.rec, this.v.clone()).project(this.city.camera);
    const behind = v.z > 1;
    const nx = behind ? -v.x : v.x, ny = behind ? -v.y : v.y;
    const W = innerWidth, H = innerHeight;
    const on = !behind && nx > -1 && nx < 1 && ny > -1 && ny < 1;
    if (on) { el.classList.remove('on'); return; }
    // clamp the direction onto the screen rectangle (minus the HUD)
    const cx = W / 2, cy = H / 2;
    const dx = nx * cx, dy = -ny * cy;
    const sx = (cx - EDGE.side - 70) / Math.max(1e-6, Math.abs(dx));
    const sy = ((dy < 0 ? cy - EDGE.top : cy - EDGE.bottom) - 20) / Math.max(1e-6, Math.abs(dy));
    const k = Math.min(sx, sy);
    const x = cx + dx * k, y = cy + dy * k;
    const key = it.rec.s.title + '|edge';
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = `<span class="arrow"></span><span class="dot waiting">!</span><span class="t">${esc(short(titleOf(it.rec.s), 22))}</span>`;
      el.title = `${titleOf(it.rec.s)} · ${STATUS.waiting}`;
      el.classList.add('on');
      el.style.setProperty('--reach', el.offsetWidth / 2 + 2 + 'px');
    }
    el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
    el.querySelector('.arrow').style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    el.classList.add('on');
  }

  // District names as drawn on screen right now, for the share postcard.
  snapshot() {
    return this.items.filter((it) => it.shown && it.type === 'district').map((it) => ({ text: it.el.firstChild?.textContent ?? '', x: it.px, y: it.py }));
  }

  setVisible(on) { this.root.hidden = !on; }
}
