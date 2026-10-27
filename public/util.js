// Small shared helpers.

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

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// frame-rate independent smoothing towards a target
export const damp = (k, dt) => 1 - Math.exp(-k * dt);

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

// A tiny tween manager, updated with the frame delta.
export class Tweens {
  constructor() { this.list = []; }
  add(duration, onUpdate, easing = easeOutCubic, onDone) {
    this.list.push({ t: 0, duration, onUpdate, easing, onDone });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.duration);
      tw.onUpdate(tw.easing(k), k);
      if (k >= 1) { this.list.splice(i, 1); tw.onDone?.(); }
    }
  }
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
  json(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  setJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* not persisted */ } },
};
