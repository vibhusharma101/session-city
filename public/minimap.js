// The map, like a racing or open-world game's: a round radar in the corner
// that turns with the camera and is centred on what you are looking at, plus a
// full-screen map (button or M) facing north. Both show every session as a dot
// coloured by status, your car as an arrow, and the patch of city on screen.
// Click either one to go there: on a building it selects it (and your car
// drives over), anywhere else the camera glides there.
import { COLONIES } from './layout.js';

const PX = 8; // pixels per tile on the cached base layer
const AREA = { uptown: '#e9d58f', midtown: '#b9d4ec', oldtown: '#cdbb98' };
const DOT = { working: '#3fbf63', waiting: '#ffb703', open: '#5aa9e6', closed: '#a59c8c', done: '#18c46a' };

export class Minimap {
  constructor(wrap, city, { select }) {
    this.wrap = wrap;
    this.city = city;
    this.select = select;
    this.canvas = wrap.querySelector('canvas');
    this.big = false;
    this.base = null;
    this.canvas.addEventListener('click', (e) => this.click(e));
    // every frame's view, kept so a click can be turned back into a tile
    this.view = null;
  }

  // Paints the parts that only change with the layout: colonies, roads, lots.
  build() {
    const L = this.city.L;
    const c = document.createElement('canvas');
    c.width = L.W * PX; c.height = L.H * PX;
    const g = c.getContext('2d');
    g.fillStyle = '#9fd27a';
    g.fillRect(0, 0, c.width, c.height);
    for (const col of L.colonies) {
      g.fillStyle = AREA[col.id];
      g.beginPath();
      g.roundRect((col.ox - 0.6) * PX, -0.6 * PX, (col.w + 1.2) * PX, (col.h + 1.2) * PX, PX);
      g.fill();
    }
    g.fillStyle = '#6d7586';
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (L.tiles[y * L.W + x] === 1) g.fillRect(x * PX, y * PX, PX, PX);
    g.fillStyle = 'rgba(255,255,255,.35)';
    for (const b of L.blocks) g.fillRect(b.bx * PX + 1, b.by * PX + 1, b.B * PX - 2, b.B * PX - 2);
    this.base = c;
  }

  toggleBig(on = !this.big) {
    this.big = on;
    this.wrap.classList.toggle('big', on);
    this.wrap.querySelector('.expand').textContent = on ? '✕' : '⤢';
    this.wrap.querySelector('.expand').title = on ? 'Close the map (M)' : 'Open the big map (M)';
  }

  update(t) {
    const { city, canvas } = this, L = city.L;
    if (!L || !this.base) return;
    const size = canvas.clientWidth, dpr = Math.min(2, devicePixelRatio);
    if (canvas.width !== Math.round(size * dpr)) { canvas.width = canvas.height = Math.round(size * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);

    // what the view is centred on, its scale (px per tile) and its turn
    const r = city.rig;
    const [cx, cy] = this.big ? [L.W / 2, L.H / 2] : city.toTile(r.target);
    const scale = this.big ? Math.min((size - 40) / L.W, (size - 40) / L.H) : clampScale(size / Math.max(14, r.dist * 0.9));
    let turn = 0;
    if (!this.big) {
      // the camera looks along (-sin yaw, -cos yaw); that direction is "up" on the radar
      turn = -Math.PI / 2 - Math.atan2(-Math.cos(r.yaw), -Math.sin(r.yaw));
    }
    this.view = { cx, cy, scale, turn, size };

    g.save();
    if (!this.big) { g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); g.clip(); }
    g.fillStyle = '#86c463';
    g.fillRect(0, 0, size, size);
    g.translate(size / 2, size / 2);
    g.rotate(turn);
    g.scale(scale, scale);
    g.translate(-cx, -cy);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0, L.W, L.H);

    // the patch of ground on screen
    const rect = city.renderer.domElement.getBoundingClientRect();
    const corners = [[0, 0], [rect.width, 0], [rect.width, rect.height], [0, rect.height]].map(([x, y]) => city.groundAt(rect.left + x, rect.top + y));
    if (corners.every(Boolean)) {
      g.beginPath();
      corners.forEach((p, i) => { const [tx, ty] = city.toTile(p); i ? g.lineTo(tx, ty) : g.moveTo(tx, ty); });
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fill();
      g.lineWidth = 1.5 / scale;
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.stroke();
    }

    // sessions
    const pulse = 0.5 + 0.5 * Math.sin(t / 220);
    for (const rec of city.recs.values()) {
      const x = rec.b.gx + 0.5, y = rec.b.gy + 0.5, s = rec.s;
      const sel = rec === city.selected;
      const loud = s.status === 'waiting' || rec.done;
      const rad = (sel ? 5 : loud ? 4.5 : 3.4) / scale;
      if (loud) {
        g.beginPath(); g.arc(x, y, rad * (1.6 + pulse), 0, Math.PI * 2);
        g.fillStyle = rec.done ? `rgba(63,224,138,${0.4 * (1 - pulse * 0.6)})` : `rgba(255,183,3,${0.35 * (1 - pulse * 0.6)})`; g.fill();
      }
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
      g.fillStyle = rec.done ? DOT.done : DOT[s.status] ?? DOT.closed; g.fill();
      g.lineWidth = (sel ? 2 : 1.2) / scale; g.strokeStyle = sel ? '#ffb703' : '#ffffff'; g.stroke();
    }

    // colony names on the big map
    if (this.big) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${14 / scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      for (const col of L.colonies) {
        const x = col.ox + col.w / 2, y = col.h + 1.4;
        g.lineWidth = 4 / scale; g.strokeStyle = 'rgba(255,255,255,.9)';
        g.strokeText(COLONIES[col.id].name.toUpperCase(), x, y);
        g.fillStyle = '#3b2f22'; g.fillText(COLONIES[col.id].name.toUpperCase(), x, y);
      }
    }

    // your car: an arrow (kept on the rim of the radar when out of range)
    const car = city.car;
    if (car.obj) {
      let px = car.x, py = car.y;
      if (!this.big) {
        const lim = (size / 2 - 10) / scale, dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy);
        if (d > lim) { px = cx + dx / d * lim; py = cy + dy / d * lim; }
      }
      g.save();
      g.translate(px, py);
      g.rotate(-car.heading);
      g.scale(1 / scale, 1 / scale);
      g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 6); g.lineTo(-3, 0); g.lineTo(-6, -6); g.closePath();
      g.fillStyle = '#ff5b3a'; g.fill();
      g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.stroke();
      g.restore();
    }
    g.restore();

    // north marker on the radar's rim
    if (!this.big) {
      const a = turn - Math.PI / 2, rr = size / 2 - 11;
      const nx = size / 2 + Math.cos(a) * rr, ny = size / 2 + Math.sin(a) * rr;
      g.beginPath(); g.arc(nx, ny, 8, 0, Math.PI * 2); g.fillStyle = '#3b2f22'; g.fill();
      g.fillStyle = '#fff'; g.font = '900 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', nx, ny + 0.5);
    }
  }

  // Screen point on the map → tile.
  tileAt(clientX, clientY) {
    const v = this.view;
    if (!v) return null;
    const r = this.canvas.getBoundingClientRect();
    let x = clientX - r.left - v.size / 2, y = clientY - r.top - v.size / 2;
    const c = Math.cos(-v.turn), s = Math.sin(-v.turn);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [v.cx + x / v.scale, v.cy + y / v.scale];
  }

  click(e) {
    const p = this.tileAt(e.clientX, e.clientY);
    if (!p) return;
    const { city } = this, v = this.view;
    // the nearest building within a few pixels counts as clicking it
    let best = null, bd = 9 / v.scale;
    for (const rec of city.recs.values()) {
      const d = Math.hypot(rec.b.gx + 0.5 - p[0], rec.b.gy + 0.5 - p[1]);
      if (d < bd) { bd = d; best = rec; }
    }
    if (best) {
      city.focus(best, 26);
      this.select(best);
    } else {
      const r = city.rig;
      r.goal.copy(city.toWorld(p[0], p[1]));
      r.follow = false;
      r.intro = false;
    }
    if (this.big) this.toggleBig(false);
  }
}

const clampScale = (s) => Math.max(2.2, Math.min(9, s));
