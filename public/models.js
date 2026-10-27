// Procedural low-poly models: buildings, the player's car, robots, coins, gates and props.
import * as THREE from './three.js';
import { mix, shade, rng, hash } from './util.js';

export const KINDS = {
  build:    { color: '#f2b880', label: 'Workshop',    desc: 'editing code' },
  research: { color: '#9cc3e6', label: 'Library',     desc: 'reading & searching' },
  shell:    { color: '#e0a48f', label: 'Factory',     desc: 'running commands' },
  web:      { color: '#8fd3c3', label: 'Observatory', desc: 'web & browser' },
  agents:   { color: '#b9a3e3', label: 'HQ',          desc: 'dispatching subagents' },
  mcp:      { color: '#e8d48a', label: 'Exchange',    desc: 'MCP tools' },
  chat:     { color: '#f2a7bd', label: 'Café',        desc: 'just talking' },
};
export const STATUS = { working: 'Working', waiting: 'Needs you', open: 'Open · idle', closed: 'Closed' };

// Cars unlock as your city levels up.
export const CAR_MODELS = [
  { id: 'hatch', label: 'Hatchback', color: '#e9573f', level: 1 },
  { id: 'jeep', label: 'Jeep', color: '#5bb85d', level: 2 },
  { id: 'taxi', label: 'Taxi', color: '#f6c445', level: 3 },
  { id: 'van', label: 'Camper van', color: '#4f9fe0', level: 4 },
  { id: 'pickup', label: 'Pickup', color: '#f08a3c', level: 5 },
  { id: 'convertible', label: 'Convertible', color: '#b07de0', level: 6 },
];
export const carById = (id) => CAR_MODELS.find((c) => c.id === id) ?? CAR_MODELS[0];

export const TILE = 2;    // world units per tile
export const FLOOR = 0.55; // world units per storey

// ---------- materials & primitives ----------
// Shared materials all use vertex colours, so every geometry drawn with mat()
// must carry a colour attribute: see ao() below.
const mats = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, vertexColors: true, ...opts }));
  return mats.get(key);
}
const glow = new Map();
export function glowMat(color) {
  if (!glow.has(color)) glow.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  return glow.get(color);
}

// Baked "ambient occlusion": vertices darken towards the bottom of the shape,
// so walls get contact shading where they meet the ground and tree crowns
// shade underneath, without any extra render pass.
export function ao(geo, dark = 0.7) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const pos = geo.attributes.position, span = Math.max(1e-6, max.y - min.y);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / span;
    colors.fill(dark + (1 - dark) * Math.pow(t, 0.55), i * 3, i * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export const GEO = {
  box: ao(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), // boxes sit on y = 0
  cyl: ao(new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0)),
  cyl6: ao(new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0)),
  sphere: ao(new THREE.IcosahedronGeometry(0.5, 1), 0.8),
  blob: ao(new THREE.IcosahedronGeometry(0.5, 0), 0.62),
  cone4: ao(new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0), 0.8),
  cone6: ao(new THREE.ConeGeometry(0.5, 1, 6).translate(0, 0.5, 0), 0.62),
  cone8: ao(new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0), 0.75),
  dome: ao(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0.85),
  ring: new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
};
const SHARED_GEO = new Set(Object.values(GEO));

// Frees what a subtree created for itself; shared geometry and cached materials stay.
export function dispose(root) {
  const cached = new Set([...mats.values(), ...glow.values()]);
  root.traverse((o) => {
    if (o.geometry && !o.isSprite && !SHARED_GEO.has(o.geometry)) o.geometry.dispose(); // sprites share one geometry
    for (const m of [o.material].flat()) {
      if (!m || cached.has(m)) continue;
      m.map?.dispose();
      m.dispose();
    }
    if (o.isInstancedMesh) o.dispose();
  });
}

export function part(geo, material, [w, h, d], [x = 0, y = 0, z = 0] = [], shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const cube = (color, size, pos, opts) => part(GEO.box, mat(color, opts), size, pos);

// ---------- buildings ----------
export function storeys(s) {
  if (s.kind === 'chat') return 1;
  return Math.max(2, Math.min(9, 1 + Math.round(Math.log2(1 + s.turns))));
}

export function wallColor(s, colony) {
  const base = KINDS[s.kind].color;
  if (colony === 'oldtown') return mix(base, '#8d877c', 0.6);
  if (colony === 'uptown') return mix(base, '#ffffff', 0.08);
  return base;
}

// Returns { group, height, windows: [{ x, y, z, ry }], chimney, beacon }.
// The group's origin is the centre of the lot at ground level.
export function makeBuilding(s, colony) {
  const g = new THREE.Group();
  const r = rng(hash(s.id));
  const old = colony === 'oldtown', posh = colony === 'uptown';
  const color = wallColor(s, colony);
  const floors = storeys(s);
  const W = 1.5, H = floors * FLOOR + 0.2, base = 0.14;
  const out = { group: g, height: base + H, windows: [], chimney: null, beacon: null };

  g.add(cube(old ? '#a39b8b' : posh ? '#f6f0e3' : '#e6dcc6', [1.9, base, 1.9], [0, 0, 0]));
  if (posh) g.add(cube('#e7c45d', [1.94, 0.04, 1.94], [0, base - 0.02, 0], { metalness: 0.6, roughness: 0.35 }));
  const body = cube(color, [W, H, W], [0, base, 0]);
  g.add(body);
  for (let f = 1; f < floors; f++) g.add(cube(shade(color, -0.12), [W + 0.03, 0.04, W + 0.03], [0, base + f * FLOOR + 0.1, 0]));
  // a darker skirting and lighter corner trims give the block a readable silhouette
  g.add(cube(shade(color, -0.25), [W + 0.04, 0.1, W + 0.04], [0, base, 0]));
  for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(cube(shade(color, old ? -0.1 : 0.2), [0.09, H, 0.09], [cx * W / 2, base, cz * W / 2]));
  }

  // roof cap; old roofs sag a little
  const roofY = base + H;
  const cap = cube(shade(color, 0.18), [W + 0.1, 0.09, W + 0.1], [0, roofY, 0]);
  if (old) cap.rotation.z = (r() - 0.5) * 0.08;
  g.add(cap);
  if (posh) g.add(cube('#e7c45d', [W + 0.14, 0.035, W + 0.14], [0, roofY + 0.09, 0], { metalness: 0.6, roughness: 0.35 }));

  // door and awning on the front (+z)
  g.add(cube(old ? '#5a4634' : '#6b4a33', [0.3, 0.42, 0.04], [0, base, W / 2 + 0.01]));
  g.add(cube(shade(color, -0.35), [0.48, 0.05, 0.22], [0, base + 0.5, W / 2 + 0.1]));
  if (old) { // planks across the door
    const plank = cube('#8a6a48', [0.42, 0.06, 0.03], [0, base + 0.22, W / 2 + 0.04]);
    plank.rotation.z = 0.5;
    g.add(plank);
  }

  // window slots on all four sides (the door face skips its middle on the ground floor)
  for (let f = 0; f < floors; f++) {
    const y = base + f * FLOOR + 0.17;
    for (let side = 0; side < 4; side++) {
      const ry = side * Math.PI / 2;
      for (const u of [-0.3, 0.3]) {
        if (f === 0 && side === 0) continue;
        const nx = Math.sin(ry), nz = Math.cos(ry);
        out.windows.push({ x: nx * (W / 2 + 0.012) + Math.cos(ry) * u, y, z: nz * (W / 2 + 0.012) - Math.sin(ry) * u, ry });
      }
    }
  }

  // ivy creeping up abandoned walls
  if (old) for (let i = 0; i < 3; i++) {
    const side = Math.floor(r() * 4), ry = side * Math.PI / 2, u = (r() - 0.5) * 0.9;
    const h = 0.3 + r() * Math.min(1.4, H * 0.6);
    const ivy = cube(r() < 0.5 ? '#5f8a3f' : '#6f9a48', [0.22, h, 0.03], [0, base, 0]);
    ivy.position.x = Math.sin(ry) * (W / 2 + 0.02) + Math.cos(ry) * u;
    ivy.position.z = Math.cos(ry) * (W / 2 + 0.02) - Math.sin(ry) * u;
    ivy.rotation.y = ry;
    g.add(ivy);
  }

  roof(g, s, out, roofY + 0.09, color, old, r);
  // rooftop clutter on flat roofs: an AC unit, and a water tank on taller blocks
  if (!['research', 'chat', 'mcp', 'web'].includes(s.kind)) {
    const top = roofY + 0.09;
    g.add(cube(old ? '#8d8a84' : '#c9ced8', [0.34, 0.2, 0.26], [-0.4, top, 0.38]));
    g.add(cube('#59606e', [0.2, 0.02, 0.2], [-0.4, top + 0.2, 0.38]));
    if (floors >= 5 && s.kind !== 'agents') { // the HQ antenna stands where the tank would
      for (const [lx, lz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) g.add(cube('#6b5a4c', [0.04, 0.22, 0.04], [-0.35 + lx, top, -0.35 + lz]));
      g.add(part(GEO.cyl, mat(old ? '#7d6a58' : '#a9805c'), [0.4, 0.34, 0.4], [-0.35, top + 0.22, -0.35]));
      g.add(part(GEO.cone8, mat('#6b5a4c'), [0.44, 0.12, 0.44], [-0.35, top + 0.56, -0.35]));
    }
  }
  return out;
}

function roof(g, s, out, y, color, old, r) {
  switch (s.kind) {
    case 'build': { // tower crane
      const yellow = old ? '#9c8a5a' : '#f4b400';
      g.add(cube(yellow, [0.07, 1.1, 0.07], [0.35, y, -0.3]));
      const jib = cube(yellow, [1.3, 0.07, 0.07], [0.15, y + 1.05, -0.3]);
      if (old) jib.rotation.z = -0.12;
      g.add(jib);
      g.add(cube('#59606e', [0.22, 0.16, 0.16], [-0.38, y + 0.98, -0.3]));
      g.add(cube('#59606e', [0.015, 0.45, 0.015], [0.7, y + 0.6, -0.3]));
      out.hook = cube('#d95d39', [0.12, 0.1, 0.12], [0.7, y + 0.5, -0.3]);
      g.add(out.hook);
      break;
    }
    case 'research': { // pitched slate roof
      const p = part(GEO.cone4, mat(old ? '#6f7680' : '#5f7ea6'), [2.3, 0.8, 2.3], [0, y, 0]);
      p.rotation.y = Math.PI / 4;
      g.add(p);
      break;
    }
    case 'shell': // brick chimney
      g.add(cube(old ? '#7a5a4e' : '#a65a46', [0.24, 0.75, 0.24], [0.3, y, -0.25]));
      out.chimney = new THREE.Vector3(0.3, y + 0.85, -0.25);
      break;
    case 'web': { // observatory dome with a telescope
      g.add(part(GEO.dome, mat(old ? '#bdb8ae' : '#f2f5f9'), [1.0, 1.0, 1.0], [0, y, 0]));
      const scope = part(GEO.cyl, mat('#5b6478'), [0.12, 0.6, 0.12], [0, y + 0.3, 0]);
      scope.rotation.z = -0.7;
      g.add(scope);
      out.scope = scope;
      break;
    }
    case 'agents': { // antenna with a beacon, and a dish
      g.add(part(GEO.cyl, mat('#7c8499'), [0.05, 1.2, 0.05], [-0.25, y, -0.2]));
      out.beacon = part(GEO.sphere, glowMat(old ? '#5a3030' : '#ff5d5d'), [0.12, 0.12, 0.12], [-0.25, y + 1.25, -0.2], false);
      g.add(out.beacon);
      const dish = part(GEO.dome, mat('#e6e9f0'), [0.55, 0.3, 0.55], [0.25, y + 0.15, 0.2]);
      dish.rotation.x = Math.PI * 0.75;
      g.add(dish);
      break;
    }
    case 'mcp': // golden spire
      g.add(part(GEO.cone4, mat(old ? '#8f8253' : '#d4a72c', { metalness: old ? 0 : 0.5, roughness: 0.4 }), [0.7, 1.1, 0.7], [0, y, 0]));
      break;
    case 'chat': { // café: striped umbrellas and little tables out front
      for (const dx of [-0.55, 0.55]) {
        g.add(part(GEO.cyl, mat('#6b6f7a'), [0.03, 0.5, 0.03], [dx, 0.14, 0.95]));
        g.add(part(GEO.cone8, mat(old ? '#9a8a8a' : r() < 0.5 ? '#ef6f8e' : '#ffffff'), [0.6, 0.2, 0.6], [dx, 0.6, 0.95]));
        g.add(part(GEO.cyl, mat('#f3efe6'), [0.3, 0.04, 0.3], [dx, 0.34, 0.95]));
      }
      g.add(part(GEO.cone8, mat(old ? '#8d7f80' : '#ef6f8e'), [1.6, 0.35, 1.6], [0, y, 0]));
      break;
    }
  }
}

// ---------- the player's car (faces +x) ----------
export function makeCar(model) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const c = model.color, dark = shade(c, -0.25);
  const glass = '#bfe4f5';
  const long = model.id === 'van' ? 1.1 : 1;
  body.add(cube(c, [0.95 * long, 0.22, 0.52], [0, 0.12, 0]));
  body.add(cube(dark, [0.97 * long, 0.05, 0.54], [0, 0.12, 0]));
  switch (model.id) {
    case 'van':
      body.add(cube(glass, [0.82, 0.3, 0.48], [-0.04, 0.34, 0]));
      body.add(cube('#ffffff', [0.84, 0.05, 0.5], [-0.04, 0.64, 0]));
      break;
    case 'pickup':
      body.add(cube(glass, [0.36, 0.22, 0.46], [0.12, 0.34, 0]));
      body.add(cube(c, [0.38, 0.04, 0.48], [0.12, 0.56, 0]));
      body.add(cube(dark, [0.4, 0.1, 0.5], [-0.28, 0.34, 0]));
      break;
    case 'convertible':
      body.add(cube(glass, [0.06, 0.16, 0.46], [0.16, 0.34, 0]));
      body.add(cube('#3a3f4b', [0.3, 0.08, 0.4], [-0.12, 0.34, 0]));
      break;
    case 'jeep':
      body.add(cube(glass, [0.5, 0.26, 0.48], [-0.05, 0.34, 0]));
      body.add(cube(c, [0.52, 0.05, 0.5], [-0.05, 0.6, 0]));
      const spare = part(GEO.cyl, mat('#3a3f4b'), [0.26, 0.1, 0.26], [-0.53, 0.28, 0]);
      spare.rotation.z = Math.PI / 2;
      body.add(spare);
      break;
    default:
      body.add(cube(glass, [0.5, 0.22, 0.46], [-0.05, 0.34, 0]));
      body.add(cube(c, [0.52, 0.05, 0.48], [-0.05, 0.56, 0]));
      if (model.id === 'taxi') body.add(cube('#ffffff', [0.18, 0.08, 0.12], [-0.05, 0.61, 0]));
  }
  for (const z of [-0.1, 0.1]) {
    body.add(part(GEO.box, glowMat('#fff1b0'), [0.02, 0.06, 0.08], [0.48 * long, 0.18, z], false));
    body.add(part(GEO.box, glowMat('#ff5b5b'), [0.02, 0.06, 0.08], [-0.48 * long, 0.18, z], false));
  }
  const wheels = [];
  for (const x of [-0.3 * long, 0.3 * long]) for (const z of [-0.27, 0.27]) {
    // the wheel's axle runs along z; spinning the holder about z rolls it
    const w = part(GEO.cyl, mat('#30343e'), [0.24, 0.1, 0.24], [0, 0, -0.05]); // centred on the axle
    const holder = new THREE.Group();
    holder.position.set(x, 0.12, z);
    w.rotation.x = Math.PI / 2;
    holder.add(w);
    g.add(holder);
    wheels.push(holder);
  }
  g.userData = { body, wheels };
  return g;
}

// ---------- robots (the agents inside buildings) ----------
export function makeRobot(color, scale = 1) {
  const g = new THREE.Group();
  const body = part(ao(new THREE.CapsuleGeometry(0.17, 0.2, 4, 10), 0.8), mat(color, { flatShading: false, roughness: 0.5 }), [1, 1, 1], [0, 0.36, 0]);
  const head = new THREE.Group();
  head.position.set(0, 0.72, 0);
  head.add(part(GEO.box, mat('#eef1f6', { flatShading: false, roughness: 0.4 }), [0.36, 0.26, 0.3], [0, 0, 0]));
  head.add(part(GEO.box, mat('#1d2333'), [0.28, 0.16, 0.02], [0, 0.05, 0.155], false));
  const eyes = [-0.06, 0.06].map((x) => part(GEO.box, glowMat('#7cf2c8'), [0.05, 0.05, 0.02], [x, 0.11, 0.165], false));
  eyes.forEach((e) => head.add(e));
  head.add(part(GEO.cyl, mat('#9aa3b5'), [0.02, 0.12, 0.02], [0, 0.26, 0]));
  head.add(part(GEO.sphere, glowMat(color), [0.07, 0.07, 0.07], [0, 0.4, 0], false));
  const arms = [-0.24, 0.24].map((x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.5, 0);
    pivot.add(part(ao(new THREE.CapsuleGeometry(0.045, 0.16, 3, 6), 0.8), mat(shade(color, -0.15)), [1, 1, 1], [0, -0.12, 0]));
    g.add(pivot);
    return pivot;
  });
  g.add(body, head);
  g.scale.setScalar(scale);
  g.userData = { body, head, eyes, arms };
  return g;
}

// ---------- coins, signs, labels ----------
export function makeCoin() {
  const g = new THREE.Group();
  const face = part(ao(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 28), 1), mat('#ffd34d', { metalness: 0.15, roughness: 0.35, emissive: '#b07a00', emissiveIntensity: 0.55, flatShading: false }), [1, 1, 1], [0, 0, 0]);
  face.rotation.x = Math.PI / 2;
  const rim = part(ao(new THREE.TorusGeometry(0.34, 0.04, 6, 28), 1), mat('#e8a820', { metalness: 0.15, roughness: 0.4, emissive: '#7a5200', emissiveIntensity: 0.4 }), [1, 1, 1], [0, 0, 0]);
  const star = part(GEO.cone4, mat('#fff1b0', { emissive: '#a07400', emissiveIntensity: 0.4 }), [0.22, 0.05, 0.22], [0, 0, 0.045]);
  star.rotation.x = Math.PI / 2;
  g.add(face, rim, star);
  return g;
}

export function textCanvas(lines, { bg = 'rgba(255,255,255,.95)', fg = '#1d2333', font = 600, size = 44, pad = 22, radius = 30, border } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const list = Array.isArray(lines) ? lines : [lines];
  ctx.font = `${font} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const w = Math.ceil(Math.max(...list.map((l) => ctx.measureText(l).width)) + pad * 2);
  const h = Math.ceil(list.length * size * 1.2 + pad * 1.4);
  c.width = w; c.height = h;
  ctx.font = `${font} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(2, 2, w - 4, h - 4, Math.min(radius, h / 2)); ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.stroke(); }
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  list.forEach((l, i) => ctx.fillText(l, w / 2, pad * 0.7 + size * 0.6 + i * size * 1.2));
  return c;
}

// A camera-facing label; `height` is its size in world units.
export function makeLabel(lines, height = 0.5, style) {
  const c = textCanvas(lines, style);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(height * c.width / c.height, height, 1);
  sp.renderOrder = 10;
  return sp;
}

// ---------- colony gates ----------
// The gate spans one road tile; its local x runs along the wall.
export function makeGate(colony, name) {
  const g = new THREE.Group();
  const span = TILE * 1.1;
  const style = {
    uptown: { pillar: '#f3ecdc', cap: '#e7c45d', beam: '#e7c45d', sign: { bg: '#2f4a3a', fg: '#f6e3a1', border: '#e7c45d' } },
    midtown: { pillar: '#c8734f', cap: '#efe6d6', beam: '#6f7d93', sign: { bg: '#ffffff', fg: '#1d2333' } },
    oldtown: { pillar: '#6e5f53', cap: '#5c524a', beam: '#7b4b2e', sign: { bg: '#8a6f55', fg: '#3a2a1c' } },
  }[colony];
  const shiny = colony === 'uptown' ? { metalness: 0.6, roughness: 0.3 } : {};
  for (const sx of [-1, 1]) {
    const p = new THREE.Group();
    p.position.x = sx * span / 2;
    p.add(cube(style.pillar, [0.4, 1.9, 0.4], [0, 0, 0]));
    if (colony === 'uptown') p.add(part(GEO.sphere, mat(style.cap, shiny), [0.36, 0.36, 0.36], [0, 2.1, 0]));
    else p.add(cube(style.cap, [0.48, 0.12, 0.48], [0, 1.9, 0]));
    if (colony === 'oldtown' && sx > 0) p.rotation.z = -0.08;
    g.add(p);
  }
  const beam = cube(style.beam, [span + 0.4, 0.16, 0.2], [0, 1.72, 0], shiny);
  if (colony === 'oldtown') { beam.rotation.z = 0.06; beam.position.y = 1.6; }
  g.add(beam);
  const sign = makeLabel(name, 0.7, { ...style.sign, font: 800, size: 46 });
  sign.position.set(colony === 'oldtown' ? 0.15 : 0, 2.3, 0);
  sign.material.rotation = colony === 'oldtown' ? -0.08 : 0;
  g.add(sign);
  if (colony === 'oldtown') { // a keep-out board
    const board = makeLabel('KEEP OUT', 0.22, { bg: '#d9c9a8', fg: '#8a2b1c', font: 800, size: 40, radius: 6 });
    board.position.set(-span / 2 + 0.1, 1.0, 0.3);
    g.add(board);
  }
  return g;
}

export function makeFountain() {
  const g = new THREE.Group();
  g.add(part(GEO.cyl, mat('#e9e2d2'), [1.6, 0.25, 1.6], [0, 0, 0]));
  g.add(part(GEO.cyl, new THREE.MeshStandardMaterial({ color: '#6cc3ea', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }), [1.4, 0.04, 1.4], [0, 0.22, 0], false));
  g.add(part(GEO.cyl, mat('#e9e2d2'), [0.18, 0.7, 0.18], [0, 0.2, 0]));
  g.add(part(GEO.cyl, mat('#e9e2d2'), [0.6, 0.08, 0.6], [0, 0.85, 0]));
  g.add(part(GEO.sphere, mat('#e7c45d', { metalness: 0.6, roughness: 0.3 }), [0.16, 0.16, 0.16], [0, 1.02, 0]));
  const drops = [];
  for (let i = 0; i < 8; i++) {
    const d = part(GEO.sphere, new THREE.MeshBasicMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.85 }), [0.07, 0.07, 0.07], [0, 0, 0], false);
    g.add(d);
    drops.push({ mesh: d, a: (i / 8) * Math.PI * 2, phase: i / 8 });
  }
  g.userData.drops = drops;
  return g;
}
