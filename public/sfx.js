// Little synthesized sounds (no audio files). Pitch varies a touch so repeats stay alive.
import { store } from './util.js';

let ac = null;
let muted = store.get('sc.muted') === '1';
// Browsers only allow audio after the person interacts with the page.
let unlocked = false;
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { unlocked = true; }, { once: true, capture: true });

function ctx() {
  if (muted || !unlocked) return null;
  try {
    ac ??= new AudioContext();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  } catch { return null; }
}

function tone(freq, { at = 0, dur = 0.12, type = 'sine', vol = 0.15, slide = 0 } = {}) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const vary = (f) => f * (0.96 + Math.random() * 0.08);

export const sfx = {
  get muted() { return muted; },
  toggle() { muted = !muted; store.set('sc.muted', muted ? '1' : '0'); return muted; },
  click: () => tone(vary(660), { dur: 0.06, type: 'triangle', vol: 0.08 }),
  hover: () => tone(vary(990), { dur: 0.035, type: 'sine', vol: 0.025 }),
  coin: (i = 0) => { tone(vary(988 + i * 30), { dur: 0.08, type: 'square', vol: 0.05 }); tone(vary(1319 + i * 30), { at: 0.07, dur: 0.16, type: 'square', vol: 0.05 }); },
  honk: () => { tone(392, { dur: 0.12, type: 'sawtooth', vol: 0.05 }); tone(392, { at: 0.16, dur: 0.18, type: 'sawtooth', vol: 0.05 }); },
  door: () => tone(vary(220), { dur: 0.25, type: 'triangle', vol: 0.1, slide: 1.8 }),
  whoosh: () => tone(vary(300), { dur: 0.3, type: 'sine', vol: 0.06, slide: 0.4 }),
  quest: () => [523, 659, 784].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.18, type: 'triangle', vol: 0.1 })),
  levelUp: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, { at: i * 0.1, dur: 0.3, type: 'square', vol: 0.06 })),
  build: () => [196, 247, 294].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.12, type: 'square', vol: 0.05 })),
};
