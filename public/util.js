// Shared helpers for drawing an isometric world on a 2D canvas.
export const TW = 64, TH = 32; // iso tile size in world pixels

export const iso = (gx, gy) => [(gx - gy) * TW / 2, (gx + gy) * TH / 2];

// inverse of iso(): world pixels back to (fractional) tile coordinates
export const unIso = (x, y) => [y / TH + x / TW, y / TH - x / TW];

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mix(a, b, p) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((x >> s) & 255) * (1 - p) + ((y >> s) & 255) * p));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
export const shade = (hex, f) => mix(hex, f < 0 ? '#000000' : '#ffffff', Math.abs(f));

export function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

export function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function inPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// An iso box: footprint (gx, gy, w, d) in tiles, height h in pixels.
// Returns the three visible faces so callers can add detail on top.
export function box(ctx, gx, gy, w, d, h, color, z = 0) {
  const up = ([x, y], dz) => [x, y - dz];
  const T = iso(gx, gy), R = iso(gx + w, gy), B = iso(gx + w, gy + d), L = iso(gx, gy + d);
  const left = [up(L, z), up(B, z), up(B, z + h), up(L, z + h)];
  const right = [up(B, z), up(R, z), up(R, z + h), up(B, z + h)];
  const top = [up(T, z + h), up(R, z + h), up(B, z + h), up(L, z + h)];
  poly(ctx, left, shade(color, -0.12));
  poly(ctx, right, shade(color, -0.28));
  poly(ctx, top, shade(color, 0.12));
  outline(ctx, [left[0], left[3], top[0], top[1], right[1], left[1]]);
  return { left, right, top };
}

// Soft cartoon outline, the way farm-sim games draw their objects.
export function outline(ctx, pts, alpha = 0.28) {
  ctx.save();
  ctx.strokeStyle = `rgba(60,40,30,${alpha})`;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n ?? 0);

export function ago(when) {
  const s = (Date.now() - Date.parse(when)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function span(a, b) {
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

// localStorage can throw (private mode, blocked storage); treat it as optional.
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* not persisted */ } },
};
