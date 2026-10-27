// Cars: the one you drive, and the traffic that keeps the streets busy.
import { iso, box, ellipse, shade, mix } from './util.js';

export const CAR_MODELS = [
  { id: 'hatch', label: 'Hatchback', color: '#e9573f' },
  { id: 'jeep', label: 'Jeep', color: '#5bb85d' },
  { id: 'taxi', label: 'Taxi', color: '#f6c445' },
  { id: 'van', label: 'Camper van', color: '#4f9fe0' },
  { id: 'pickup', label: 'Pickup', color: '#f08a3c' },
  { id: 'convertible', label: 'Convertible', color: '#b07de0' },
];
export const carById = (id) => CAR_MODELS.find((c) => c.id === id) ?? CAR_MODELS[0];

const GLASS = '#bfe4f5';
const TYRE = '#3a3f4b';

// Picks one of four road directions from a movement vector in tile space.
export function dirFrom(dx, dy, fallback) {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? '+x' : '-x') : (dy > 0 ? '+y' : '-y');
}

// Draws a car centred on tile position (gx, gy) facing `dir`.
// `tint` darkens colours at night; `bump` is a small vertical bounce.
export function drawVehicle(ctx, gx, gy, dir, model, { tint = (c) => c, night = 0, bump = 0, scale = 1 } = {}) {
  const alongX = dir[1] === 'x';
  const sgn = dir[0] === '+' ? 1 : -1;
  const L = 0.6 * scale, Wd = 0.32 * scale;

  // A slab along the car: a0..a1 are offsets from the centre towards the front,
  // w is its width across the car, z/h are its base and height in pixels.
  const slab = (a0, a1, w, z, h, color) => {
    const p0 = sgn > 0 ? a0 : -a1, p1 = sgn > 0 ? a1 : -a0;
    if (alongX) return box(ctx, gx + p0, gy - w / 2, p1 - p0, w, h, color, z + bump);
    return box(ctx, gx - w / 2, gy + p0, w, p1 - p0, h, color, z + bump);
  };
  const point = (a, c) => (alongX ? iso(gx + sgn * a, gy + c) : iso(gx + c, gy + sgn * a));

  const [cx, cy] = iso(gx, gy);
  ellipse(ctx, cx, cy + 1, 17 * scale, 8 * scale, 'rgba(40,50,30,.22)');

  // wheels peek out under the body
  for (const a of [-L * 0.32, L * 0.32]) for (const c of [-Wd / 2, Wd / 2]) {
    const [x, y] = point(a, c);
    ellipse(ctx, x, y - 2 + bump, 3.2 * scale, 2.6 * scale, TYRE);
  }

  const body = tint(model.color);
  const glass = tint(GLASS);
  const s = scale;
  switch (model.id) {
    case 'van':
      slab(-L / 2, L / 2, Wd, 3, 15 * s, body);
      slab(-L / 2 + 0.02, L / 2 - 0.14, Wd + 0.004, 10 * s, 5 * s, glass);
      slab(-L / 2, L / 2, Wd, 3 + 15 * s, 1.5 * s, tint('#fdf6e3'));
      break;
    case 'jeep':
      slab(-L / 2, L / 2, Wd, 3, 8 * s, body);
      slab(-L / 2 + 0.04, L * 0.12, Wd - 0.02, 3 + 8 * s, 7 * s, glass);
      slab(-L / 2 + 0.04, L * 0.12, Wd - 0.02, 3 + 15 * s, 2 * s, shade(body, -0.25));
      slab(-L / 2 - 0.05, -L / 2, Wd * 0.5, 6, 6 * s, tint(TYRE)); // spare wheel
      break;
    case 'pickup':
      slab(-L / 2, L / 2, Wd, 3, 7 * s, body);
      slab(L * 0.02, L * 0.36, Wd - 0.02, 3 + 7 * s, 7 * s, glass);
      slab(L * 0.02, L * 0.36, Wd - 0.02, 3 + 14 * s, 1.5 * s, shade(body, -0.15));
      slab(-L / 2 + 0.03, -L * 0.06, Wd - 0.06, 3 + 7 * s, 1.2 * s, shade(body, -0.45)); // open bed
      break;
    case 'convertible':
      slab(-L / 2, L / 2, Wd, 3, 6 * s, body);
      slab(L * 0.12, L * 0.16, Wd - 0.03, 3 + 6 * s, 5 * s, glass); // windscreen
      slab(-L * 0.2, L * 0.05, Wd * 0.3, 3 + 6 * s, 3 * s, tint('#f3e2c7')); // seats
      break;
    default: { // hatchback and taxi
      slab(-L / 2, L / 2, Wd, 3, 7 * s, body);
      slab(-L * 0.32, L * 0.18, Wd - 0.03, 3 + 7 * s, 6 * s, glass);
      slab(-L * 0.32, L * 0.18, Wd - 0.03, 3 + 13 * s, 1.5 * s, shade(body, 0.1));
      if (model.id === 'taxi') slab(-L * 0.1, L * 0.02, Wd * 0.35, 3 + 14.5 * s, 3 * s, tint('#fff3b0'));
    }
  }

  // headlights and tail-lights on the ends that face the viewer
  const front = point(L / 2, 0), back = point(-L / 2, 0);
  const lightY = -6 - bump;
  if (night > 0.3) {
    const [fx, fy] = front;
    ellipse(ctx, fx + (fx - cx) * 0.6, fy + (fy - cy) * 0.6 + lightY, 9, 4.5, `rgba(255,240,180,${0.45 * night})`);
  }
  ellipse(ctx, front[0], front[1] + lightY, 1.8, 1.4, night > 0.3 ? '#fff6c8' : '#fffbe8');
  ellipse(ctx, back[0], back[1] + lightY, 1.6, 1.2, '#ff5d5d');
}

// The car you drive gets a bobbing marker so you can always find it.
export function drawPlayerMarker(ctx, gx, gy, t, color) {
  const [x, y] = iso(gx, gy);
  const yy = y - 34 + Math.sin(t / 260) * 3;
  ctx.fillStyle = mix(color, '#ffffff', 0.15);
  ctx.strokeStyle = 'rgba(60,40,20,.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, yy + 9);
  ctx.lineTo(x - 7, yy - 1);
  ctx.arc(x, yy - 2, 7, Math.PI, 0);
  ctx.lineTo(x, yy + 9);
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, x, yy - 2, 2.8, 2.8, '#ffffff');
}
