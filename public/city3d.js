// The 3D city: renderer, camera rig, colonies, buildings, your car, coins and effects.
import * as THREE from './three.js';
import {
  TILE, GEO, mat, glowMat, part, dispose, makeBuilding, makeCar, makeCoin, makeLabel, makeGate, makeFountain,
} from './models.js';
import { findPath, drivable } from './layout.js';
import { Post } from './post.js';
import { hash, rng, mix, clamp, damp, Tweens, easeOutBack, easeOutCubic } from './util.js';

const SKY = {
  top: '#4f9be0', horizon: '#dcefff',            // day
  nightTop: '#070c22', nightHorizon: '#26335f',  // night
};
const GRASS = { outside: '#8fcf63', uptown: '#7fd066', midtown: '#9bd26c', oldtown: '#c4b67a' };
const PARK = { uptown: '#74c85c', midtown: '#95d46a', oldtown: '#b5a86c' };
const ROAD = { uptown: '#6b7385', midtown: '#7c8494', oldtown: '#978e82' };
const CURB = { uptown: '#f4ecdc', midtown: '#efe2c4', oldtown: '#b3a790' };
const LIT = { working: 0.85, waiting: 0.65, open: 0.5, closed: 0.05 };
const PARK_TOP = 0.16;

// A gradient sky dome with a soft sun glow by day, and stars and a moon by night.
function makeSky() {
  const uniforms = {
    uTop: { value: new THREE.Color(SKY.top) },
    uHorizon: { value: new THREE.Color(SKY.horizon) },
    uSunDir: { value: new THREE.Vector3(-0.3, 0.45, 0.85).normalize() },
    uNight: { value: 0 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir;
      uniform vec3 uTop, uHorizon, uSunDir; uniform float uNight;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        float d = max(dot(dir, normalize(uSunDir)), 0.0);
        // sun by day, moon by night (a smaller, cooler disc)
        col += mix(vec3(1.0, 0.92, 0.75) * (pow(d, 900.0) * 3.0 + pow(d, 12.0) * 0.35),
                   vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, d) * 1.6 + pow(d, 60.0) * 0.12), uNight);
        // stars, fading in near the zenith
        vec3 cell = floor(dir * 180.0);
        float star = step(0.9965, hash(cell)) * smoothstep(0.1, 0.5, h);
        col += vec3(star) * uNight * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

// A soft round glow, used for the pools of lamplight at night (one per layout,
// since rebuilding the city disposes its textures).
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Endless grass with soft patches of lighter and darker green.
function makeGround() {
  const geo = new THREE.PlaneGeometry(1600, 1600, 200, 200).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.5 + Math.sin(x * 0.031 + z * 0.027) * 0.5;
    colors.fill(0.93 + n * 0.07, i * 3, i * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(geo, mat(GRASS.outside, { flatShading: false }));
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  return ground;
}

export class City {
  constructor(canvas, events) {
    this.events = events;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(SKY.horizon, 80, 220);
    // a long lens keeps buildings from distorting, like a model under a camera
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.5, 1200);
    this.post = new Post(r);

    this.sky = makeSky();
    scene.add(this.sky);

    // key: a warm, low afternoon sun from the front-left; fill: sky/ground bounce;
    // rim: a cool light from behind that separates buildings from the ground
    this.hemi = new THREE.HemisphereLight('#d6ecff', '#a3b36e', 1.1);
    this.sun = new THREE.DirectionalLight('#ffe7c2', 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.rim = new THREE.DirectionalLight('#a9c8ff', 0.7);
    scene.add(this.hemi, this.sun, this.sun.target, this.rim);

    scene.add(makeGround());
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.tweens = new Tweens();
    this.particles = [];
    this.recs = new Map();
    this.fountains = [];
    this.labels = [];
    // the pitch eases from a near-top-down map view when zoomed out to a lower,
    // more cinematic angle up close; yaw rests on the diagonals
    this.rig = { target: new THREE.Vector3(), goal: new THREE.Vector3(), yaw: Math.PI / 4, yawGoal: Math.PI / 4, pitch: 0.9, dist: 60, distGoal: 60, follow: false, minDist: 9, maxDist: 160 };
    this.car = { x: 0, y: 0, heading: 0, speed: 0, path: [], target: null, obj: null, odo: 0 };
    this.hover = null;
    this.selected = null;
    this.night = 0;
    this.keys = new Set();

    this.selRing = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9, depthWrite: false }));
    this.hoverRing = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }));
    this.selRing.visible = this.hoverRing.visible = false;
    scene.add(this.selRing, this.hoverRing);

    this.raycaster = new THREE.Raycaster();
    this.bindInput(canvas);
  }

  // ---------- coordinates ----------
  toWorld(gx, gy, y = 0) {
    return new THREE.Vector3((gx - this.L.W / 2) * TILE, y, (gy - this.L.H / 2) * TILE);
  }
  toTile(v) { return [v.x / TILE + this.L.W / 2, v.z / TILE + this.L.H / 2]; }

  project(v) {
    const p = v.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height, behind: p.z > 1 };
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- building the city ----------
  setLayout(L, carModel, isNew) {
    const first = !this.L;
    this.L = L;
    if (this.city) { this.scene.remove(this.city); dispose(this.city); }
    const city = this.city = new THREE.Group();
    this.scene.add(city);
    const prev = this.recs;
    this.hover = null;
    this.recs = new Map();
    this.labels = [];
    this.fountains = [];

    this.buildGround(city, L);
    this.buildFences(city, L);
    this.buildTrees(city, L);
    this.buildLamps(city, L);

    for (const gt of L.gates) {
      const gate = makeGate(gt.colony, { uptown: 'Uptown', midtown: 'Midtown', oldtown: 'Old Town' }[gt.colony]);
      gate.position.copy(this.toWorld(gt.x, gt.y));
      city.add(gate);
      if (gt.colony === 'uptown') {
        for (const dx of [-2, 2]) {
          const f = makeFountain();
          f.position.copy(this.toWorld(gt.x + dx, gt.y + 1.1));
          f.scale.setScalar(0.8);
          city.add(f);
          this.fountains.push(f);
        }
      }
    }

    for (const blk of L.blocks) {
      const lab = makeLabel(blk.name, 0.85, { bg: 'rgba(255,255,255,.92)', size: 40, font: 800 });
      lab.position.copy(this.toWorld(blk.bx + blk.B + 0.1, blk.by + blk.B + 0.1, 0.9));
      city.add(lab);
      this.labels.push(lab);
    }

    // buildings; windows and sills are instanced per building and parented to it,
    // so they follow its bounce, hover and rise animations
    const winGeo = new THREE.PlaneGeometry(0.24, 0.28);
    const winMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    for (const b of L.buildings) {
      const m = makeBuilding(b.s, b.colony);
      const pos = this.toWorld(b.gx + 0.5, b.gy + 0.5, PARK_TOP);
      m.group.position.copy(pos);
      city.add(m.group);
      const rec = {
        b, s: b.s, colony: b.colony, group: m.group, height: m.height + PARK_TOP, chimney: m.chimney, beacon: m.beacon,
        hook: m.hook, scope: m.scope, pending: -1, coin: null, alert: null, pulse: null, // -1: coin not built yet
        scale: 1, squash: 0, rise: isNew?.(b.s) ? 0 : 1, phase: (hash(b.s.id) % 1000) / 160, smokeT: 0, drones: [],
      };
      const n = Math.max(1, m.windows.length);
      const wins = rec.windows = new THREE.InstancedMesh(winGeo, winMat, n);
      const sills = new THREE.InstancedMesh(GEO.box, mat('#ffffff'), n);
      sills.castShadow = true;
      const r = rng(hash(b.s.id));
      rec.windowRnd = m.windows.map(() => r());
      m.windows.forEach((w, i) => {
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(0, w.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        wins.setMatrixAt(i, dummy.matrix);
        wins.setColorAt(i, col.set('#a9d2ee'));
        dummy.position.set(w.x + Math.sin(w.ry) * 0.03, w.y - 0.17, w.z + Math.cos(w.ry) * 0.03);
        dummy.scale.set(0.32, 0.035, 0.07);
        dummy.updateMatrix();
        sills.setMatrixAt(i, dummy.matrix);
        sills.setColorAt(i, col.set(b.colony === 'oldtown' ? '#9c968b' : '#f6f1e6'));
      });
      wins.count = sills.count = m.windows.length;
      m.group.add(wins, sills);
      m.group.traverse((o) => { if (o.isMesh) o.userData.rec = rec; });
      for (let i = 0; i < 4; i++) {
        const d = new THREE.Group();
        d.add(part(GEO.box, mat('#5b5f73'), [0.34, 0.05, 0.08], [0, 0, 0]));
        d.add(part(GEO.sphere, glowMat('#b9a3e3'), [0.1, 0.1, 0.1], [0, -0.05, 0], false));
        d.visible = false;
        city.add(d);
        rec.drones.push(d);
      }
      if (rec.rise === 0) this.raise(rec);
      this.recs.set(b.s.id, rec);
    }
    this.winClock = 0;

    // sun & shadows sized to the city; the sun sits front-left of the default
    // view so the faces you see are lit and shadows fall away from you
    const half = Math.max(L.W, L.H) * TILE / 2 + 12;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.near = 1; sc.far = half * 5;
    sc.updateProjectionMatrix();
    this.sun.position.set(-half * 0.45, half * 1.25, half * 1.5);
    this.sun.target.position.set(0, 0, 0);
    this.rim.position.set(half, half * 0.8, -half * 1.2);
    this.sky.material.uniforms.uSunDir.value.copy(this.sun.position).normalize();
    this.sun.shadow.mapSize.set(half > 60 ? 4096 : 2048, half > 60 ? 4096 : 2048);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }

    // the car
    if (!this.car.obj || first) {
      const c0 = L.colonies[0];
      this.car.x = (c0 ? c0.gateX : 1) + 0.5;
      this.car.y = L.avenue + 0.5;
      this.car.heading = 0;
    } else if (!drivable(L, Math.floor(this.car.x), Math.floor(this.car.y))) {
      this.car.x = 1.5; this.car.y = L.avenue + 0.5; this.car.path = [];
    }
    this.setCar(carModel);
    this.selected = this.selected && this.recs.get(this.selected.s.id);
    if (first) {
      this.fit(true);
      this.fit(true, L.colonies[0]?.id);
      // opening shot: start high and swung round, then glide down onto Uptown
      this.rig.dist *= 2.6;
      this.rig.yaw -= Math.PI / 2;
      this.rig.intro = true;
    }
  }

  buildGround(city, L) {
    for (const c of L.colonies) {
      const a = this.toWorld(c.ox - 1, -1), b = this.toWorld(c.ox + c.w + 1, c.h + 1);
      city.add(part(GEO.box, mat(GRASS[c.id], { flatShading: false }), [b.x - a.x, 0.04, b.z - a.z], [(a.x + b.x) / 2, 0, (a.z + b.z) / 2], false));
    }
    // roads
    const roads = [];
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (L.tiles[y * L.W + x] === 1) roads.push([x, y]);
    const road = new THREE.InstancedMesh(GEO.box, mat('#ffffff', { flatShading: false, roughness: 0.95 }), roads.length);
    road.receiveShadow = true;
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    const colonyOf = (x, y) => { const ci = L.colonyAt[y * L.W + x]; return ci >= 0 ? L.colonies[ci].id : 'midtown'; };
    roads.forEach(([x, y], i) => {
      dummy.position.copy(this.toWorld(x + 0.5, y + 0.5, 0.02));
      dummy.scale.set(TILE, 0.06, TILE);
      dummy.updateMatrix();
      road.setMatrixAt(i, dummy.matrix);
      road.setColorAt(i, col.set(ROAD[colonyOf(x, y)]));
    });
    city.add(road);

    // lane dashes on straight stretches, cracks in Old Town
    const dashes = [], cracks = [];
    for (const [x, y] of roads) {
      const h = drivable(L, x - 1, y) || drivable(L, x + 1, y), v = drivable(L, x, y - 1) || drivable(L, x, y + 1);
      const r = rng(hash(`d${x},${y}`));
      const old = colonyOf(x, y) === 'oldtown';
      if (h !== v && !(old && r() < 0.5)) dashes.push([x, y, h]);
      if (old && r() < 0.5) cracks.push([x, y, r() * Math.PI, 0.3 + r() * 0.7, r() - 0.5, r() - 0.5]);
    }
    const dash = new THREE.InstancedMesh(GEO.box, mat('#fff6dc', { flatShading: false }), Math.max(1, dashes.length));
    dashes.forEach(([x, y, h], i) => {
      dummy.position.copy(this.toWorld(x + 0.5, y + 0.5, 0.05));
      dummy.scale.set(h ? 0.8 : 0.1, 0.01, h ? 0.1 : 0.8);
      dummy.updateMatrix();
      dash.setMatrixAt(i, dummy.matrix);
    });
    dash.count = dashes.length;
    city.add(dash);
    const crack = new THREE.InstancedMesh(GEO.box, mat('#5d574f'), Math.max(1, cracks.length));
    cracks.forEach(([x, y, rot, len, ox, oz], i) => {
      dummy.position.copy(this.toWorld(x + 0.5 + ox * 0.5, y + 0.5 + oz * 0.5, 0.05));
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(len, 0.01, 0.05);
      dummy.updateMatrix();
      crack.setMatrixAt(i, dummy.matrix);
    });
    crack.count = cracks.length;
    dummy.rotation.set(0, 0, 0);
    city.add(crack);

    // blocks: a curb with a park on top; flowers in posh parks, weeds in abandoned ones
    const flowers = [], weeds = [];
    for (const blk of L.blocks) {
      const c = this.toWorld(blk.bx + blk.B / 2, blk.by + blk.B / 2);
      city.add(part(GEO.box, mat(CURB[blk.colony]), [blk.B * TILE + 0.2, 0.14, blk.B * TILE + 0.2], [c.x, 0, c.z], false));
      city.add(part(GEO.box, mat(PARK[blk.colony], { flatShading: false }), [blk.B * TILE - 0.25, PARK_TOP, blk.B * TILE - 0.25], [c.x, 0, c.z], false));
      const r = rng(hash(`f${blk.bx},${blk.by}`));
      const n = blk.colony === 'uptown' ? blk.B * 14 : blk.colony === 'midtown' ? blk.B * 4 : blk.B * 10;
      for (let i = 0; i < n; i++) {
        const x = blk.bx + 0.15 + r() * (blk.B - 0.3), y = blk.by + 0.15 + r() * (blk.B - 0.3);
        if (L.tiles[Math.floor(y) * L.W + Math.floor(x)] === 2) continue;
        (blk.colony === 'oldtown' ? weeds : flowers).push([x, y, r()]);
      }
    }
    const fl = new THREE.InstancedMesh(GEO.blob, mat('#ffffff'), Math.max(1, flowers.length));
    const palette = ['#ffffff', '#ffd166', '#ef798a', '#c3a6ff', '#ff9f68'];
    flowers.forEach(([x, y, k], i) => {
      dummy.position.copy(this.toWorld(x, y, PARK_TOP + 0.04));
      dummy.scale.setScalar(0.12);
      dummy.updateMatrix();
      fl.setMatrixAt(i, dummy.matrix);
      fl.setColorAt(i, col.set(palette[Math.floor(k * palette.length)]));
    });
    fl.count = flowers.length;
    city.add(fl);
    const wd = new THREE.InstancedMesh(GEO.cone4, mat('#8d9a4a'), Math.max(1, weeds.length));
    weeds.forEach(([x, y, k], i) => {
      dummy.position.copy(this.toWorld(x, y, PARK_TOP));
      dummy.scale.set(0.18, 0.2 + k * 0.3, 0.18);
      dummy.rotation.set(0, k * 6, (k - 0.5) * 0.4);
      dummy.updateMatrix();
      wd.setMatrixAt(i, dummy.matrix);
    });
    wd.count = weeds.length;
    dummy.rotation.set(0, 0, 0);
    city.add(wd);
  }

  buildFences(city, L) {
    const posts = { uptown: [], midtown: [], oldtown: [] }, rails = [];
    for (const f of L.fences) {
      const a = this.toWorld(...f.a), b = this.toWorld(...f.b);
      const len = a.distanceTo(b);
      if (len < 0.1) continue;
      const r = rng(hash(`w${f.a}${f.b}`));
      const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
      if (f.colony === 'uptown') {
        // trimmed hedge with stone pillars
        const hedge = part(GEO.box, mat('#3f8f3a'), [len, 0.7, 0.5], [(a.x + b.x) / 2, 0, (a.z + b.z) / 2]);
        hedge.rotation.y = ang;
        city.add(hedge);
        for (let d = 0; d <= len; d += 4) posts.uptown.push([a.x + (b.x - a.x) * d / len, a.z + (b.z - a.z) * d / len, 0, ang]);
      } else if (f.colony === 'midtown') {
        // white picket fence
        for (let d = 0; d <= len; d += 0.35) posts.midtown.push([a.x + (b.x - a.x) * d / len, a.z + (b.z - a.z) * d / len, 0, ang]);
        for (const y of [0.18, 0.42]) rails.push({ a, b, len, ang, y, color: '#f4f1ea', tilt: 0 });
      } else {
        // broken, leaning planks with gaps
        for (let d = 0; d <= len; d += 0.45) {
          if (r() < 0.22) continue;
          posts.oldtown.push([a.x + (b.x - a.x) * d / len, a.z + (b.z - a.z) * d / len, (r() - 0.5) * 0.5, ang]);
        }
      }
    }
    const dummy = new THREE.Object3D();
    const style = {
      uptown: { geo: GEO.box, color: '#efe6d2', size: [0.55, 0.95, 0.55] },
      midtown: { geo: GEO.box, color: '#f4f1ea', size: [0.08, 0.6, 0.06] },
      oldtown: { geo: GEO.box, color: '#7b5a3e', size: [0.32, 0.75, 0.06] },
    };
    for (const [id, list] of Object.entries(posts)) {
      if (!list.length) continue;
      const st = style[id];
      const m = new THREE.InstancedMesh(st.geo, mat(st.color), list.length);
      m.castShadow = true;
      list.forEach(([x, z, tilt, ang], i) => {
        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, ang, tilt);
        dummy.scale.set(...st.size);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      city.add(m);
    }
    for (const rl of rails) {
      const m = part(GEO.box, mat(rl.color), [rl.len, 0.05, 0.04], [(rl.a.x + rl.b.x) / 2, rl.y, (rl.a.z + rl.b.z) / 2]);
      m.rotation.y = rl.ang;
      city.add(m);
    }
  }

  buildTrees(city, L) {
    const trunks = [], round = [], cones = [], pines = [], dead = [];
    for (const t of L.trees) {
      const p = this.toWorld(t.x, t.y);
      const s = t.size;
      const inPark = L.blocks.some((b) => t.x >= b.bx && t.x < b.bx + b.B && t.y >= b.by && t.y < b.by + b.B);
      p.y = inPark ? PARK_TOP : 0.02;
      if (t.kind === 'dead') { dead.push([p, s]); continue; }
      trunks.push([p, s]);
      (t.kind === 'pine' ? pines : t.kind === 'cone' ? cones : round).push([p, s, hash(`${t.x}`) % 3]);
    }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    const inst = (geo, material, list, place) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, material, list.length);
      m.castShadow = true;
      m.receiveShadow = true;
      list.forEach((it, i) => { place(dummy, it, m, i); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
      city.add(m);
    };
    const leaf = ['#58b64f', '#47a043', '#6fcb5c'];
    inst(GEO.cyl6, mat('#9a6440'), trunks, (d, [p, s]) => { d.position.copy(p); d.rotation.set(0, 0, 0); d.scale.set(0.16 * s, 0.6 * s, 0.16 * s); });
    inst(GEO.blob, mat('#ffffff'), round, (d, [p, s, k], m, i) => { d.position.set(p.x, p.y + 0.95 * s, p.z); d.scale.set(1.1 * s, 1.0 * s, 1.1 * s); d.rotation.set(0, k, 0); m.setColorAt(i, col.set(leaf[k])); });
    inst(GEO.cone8, mat('#ffffff'), cones, (d, [p, s, k], m, i) => { d.position.set(p.x, p.y + 0.45 * s, p.z); d.scale.set(0.7 * s, 1.5 * s, 0.7 * s); d.rotation.set(0, 0, 0); m.setColorAt(i, col.set(['#3f9a46', '#4aa84e', '#358c3e'][k])); });
    inst(GEO.cone6, mat('#ffffff'), pines, (d, [p, s, k], m, i) => { d.position.set(p.x, p.y + 0.4 * s, p.z); d.scale.set(1.0 * s, 1.8 * s, 1.0 * s); d.rotation.set(0, k, 0); m.setColorAt(i, col.set(['#2f8a4a', '#3b9a53', '#2a7a42'][k])); });
    inst(GEO.cyl6, mat('#6e5847'), dead, (d, [p, s]) => { d.position.copy(p); d.rotation.set(0, 0, 0); d.scale.set(0.13 * s, 1.1 * s, 0.13 * s); });
    const branches = dead.flatMap(([p, s], i) => [[p, s, 0.7, 0.6 + i], [p, s, -0.8, 2.1 + i]]);
    inst(GEO.cyl6, mat('#6e5847'), branches, (d, [p, s, tilt, rot]) => { d.position.set(p.x, p.y + 0.6 * s, p.z); d.rotation.set(0, rot, tilt); d.scale.set(0.07 * s, 0.6 * s, 0.07 * s); });
  }

  buildLamps(city, L) {
    const dummy = new THREE.Object3D();
    const posts = new THREE.InstancedMesh(GEO.cyl6, mat('#4a5160'), L.lamps.length);
    const lit = L.lamps.filter((l) => l.colony !== 'oldtown' || hash(`${l.x},${l.y}`) % 3 === 0);
    this.bulbs = new THREE.InstancedMesh(GEO.sphere, glowMat('#ffffff'), Math.max(1, lit.length));
    this.bulbs.material = new THREE.MeshBasicMaterial({ color: '#dfe3ea', toneMapped: false });
    posts.castShadow = true;
    L.lamps.forEach((l, i) => {
      dummy.position.copy(this.toWorld(l.x, l.y));
      dummy.scale.set(0.08, 1.5, 0.08);
      dummy.rotation.set(0, 0, l.colony === 'oldtown' ? 0.15 : 0);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      posts.setColorAt(i, new THREE.Color(l.colony === 'uptown' ? '#c9a34a' : l.colony === 'oldtown' ? '#6a5a4c' : '#4a5160'));
    });
    this.bulbs.count = lit.length;
    lit.forEach((l, i) => {
      dummy.position.copy(this.toWorld(l.x, l.y, 1.55));
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.22);
      dummy.updateMatrix();
      this.bulbs.setMatrixAt(i, dummy.matrix);
    });
    posts.material = mat('#ffffff');
    city.add(posts, this.bulbs);
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: glowTexture(), color: '#ffb257', transparent: true, opacity: this.night * 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    }), Math.max(1, lit.length));
    lit.forEach((l, i) => {
      dummy.position.copy(this.toWorld(l.x, l.y, 0.08));
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(4.2);
      dummy.updateMatrix();
      this.pools.setMatrixAt(i, dummy.matrix);
    });
    this.pools.count = lit.length;
    city.add(this.pools);
  }

  // ---------- car ----------
  setCar(model) {
    if (this.car.obj) this.scene.remove(this.car.obj);
    this.car.model = model;
    this.car.obj = makeCar(model);
    this.car.obj.scale.setScalar(1.25);
    this.scene.add(this.car.obj);
    this.placeCar();
  }

  placeCar() {
    const c = this.car;
    c.obj.position.copy(this.toWorld(c.x, c.y, 0.05));
    c.obj.rotation.y = c.heading;
  }

  driveTo(target) {
    const c = this.car;
    const goal = target.b ?? target;
    c.path = findPath(this.L, c.x, c.y, goal);
    c.target = target.b ? target : null;
    this.rig.follow = true;
    if (!c.path.length && c.target) { c.target = null; this.events.arrive(target); }
    return c.path.length;
  }

  updateCar(dt) {
    const c = this.car;
    if (!c.obj) return;
    const { body, wheels } = c.obj.userData;
    let accel = 0;
    if (c.path.length) {
      const remaining = c.path.reduce((acc, p, i) => acc + (i ? Math.hypot(p[0] - c.path[i - 1][0], p[1] - c.path[i - 1][1]) : Math.hypot(p[0] - c.x, p[1] - c.y)), 0);
      const vmax = 6, a = 10;
      const want = Math.min(vmax, Math.sqrt(2 * a * remaining) + 0.3);
      const before = c.speed;
      c.speed = c.speed < want ? Math.min(want, c.speed + a * dt) : Math.max(want, c.speed - a * 1.5 * dt);
      accel = (c.speed - before) / Math.max(dt, 1e-3);
      let step = c.speed * dt;
      while (step > 0 && c.path.length) {
        const [tx, ty] = c.path[0];
        const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
        if (d > 1e-4) {
          const ang = Math.atan2(-dy, dx);
          let diff = ang - c.heading;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          c.heading += diff * damp(14, dt);
        }
        if (d <= step) { c.x = tx; c.y = ty; c.path.shift(); step -= d; c.odo += d; }
        else { c.x += dx / d * step; c.y += dy / d * step; c.odo += step; step = 0; }
      }
      if (c.odo >= 1) { this.events.drove?.(Math.floor(c.odo)); c.odo -= Math.floor(c.odo); }
      if (Math.random() < c.speed * dt * 1.2) this.puff(this.toWorld(c.x, c.y, 0.2), '#e9e4da', 0.25);
      if (!c.path.length) {
        c.speed = 0;
        if (c.target) { const t = c.target; c.target = null; this.events.arrive(t); }
      }
    }
    this.placeCar();
    for (const w of wheels) w.rotation.z -= c.speed * TILE * dt / 0.15;
    body.rotation.z = clamp(-accel * 0.004, -0.06, 0.06);
    body.position.y = c.speed > 0.1 ? Math.abs(Math.sin(performance.now() / 70)) * 0.02 : 0;
  }

  // ---------- camera ----------
  // Frames the whole city, or one colony.
  fit(instant, colony = null) {
    const L = this.L;
    if (!L) return;
    const c = colony && L.colonies.find((x) => x.id === colony);
    const wd = (c ? c.w + 2 : L.W) * TILE, hd = (c ? c.h + 4 : L.H) * TILE;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const across = (wd + hd) * Math.SQRT1_2;
    const d1 = across * 0.5 / (tan * this.camera.aspect);
    const d2 = across * 0.5 * Math.sin(this.rig.pitch) / tan;
    const r = this.rig;
    r.distGoal = clamp(Math.max(d1, d2) * 1.02, r.minDist, 400);
    if (!c) r.maxDist = Math.max(60, r.distGoal * 1.4);
    r.goal.copy(c ? this.toWorld(c.ox + c.w / 2, (c.h + 2) / 2) : new THREE.Vector3());
    r.follow = false;
    if (instant) { r.dist = r.distGoal; r.target.copy(r.goal); }
  }

  focus(rec, dist = 22) {
    const r = this.rig;
    r.goal.copy(rec.group.position).setY(0);
    r.distGoal = Math.min(r.distGoal, dist);
    r.follow = false;
  }

  // Quarter turns, always coming to rest on a diagonal (the classic city-builder view).
  rotate(steps) { this.rig.yawGoal = this.snapYaw(this.rig.yawGoal) + steps * Math.PI / 2; }
  snapYaw(y) { return Math.PI / 4 + Math.round((y - Math.PI / 4) / (Math.PI / 2)) * Math.PI / 2; }

  updateRig(dt) {
    const r = this.rig;
    // keyboard: WASD / arrows pan, Q/E rotate
    const k = this.keys, pan = r.dist * 0.9 * dt;
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) mz -= 1;
    if (k.has('s') || k.has('arrowdown')) mz += 1;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (mx || mz) {
      const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
      r.goal.x += (mx * c + mz * s) * pan;
      r.goal.z += (-mx * s + mz * c) * pan;
      r.follow = false;
    }
    if (r.follow && this.car.obj) r.goal.copy(this.car.obj.position).setY(0);
    const L = this.L;
    if (L) {
      const hx = L.W * TILE / 2 + 6, hz = L.H * TILE / 2 + 6;
      r.goal.x = clamp(r.goal.x, -hx, hx);
      r.goal.z = clamp(r.goal.z, -hz, hz);
    }
    r.distGoal = clamp(r.distGoal, r.minDist, r.maxDist);
    // the opening shot glides slowly; after that the camera answers quickly
    const ease = r.intro ? 1.7 : 8;
    if (r.intro && Math.abs(r.dist - r.distGoal) < r.distGoal * 0.02) r.intro = false;
    r.target.lerp(r.goal, damp(r.follow ? 5 : 9, dt));
    r.dist += (r.distGoal - r.dist) * damp(ease, dt);
    r.yaw += (r.yawGoal - r.yaw) * damp(ease * 0.9, dt);
    // steeper when zoomed out (read the map), lower when close (see the buildings)
    const zoom = clamp((r.dist - r.minDist) / Math.max(1, r.maxDist - r.minDist), 0, 1);
    r.pitch = 0.62 + 0.42 * Math.sqrt(zoom);
    const cp = Math.cos(r.pitch);
    this.camera.position.set(
      r.target.x + Math.sin(r.yaw) * cp * r.dist,
      r.target.y + Math.sin(r.pitch) * r.dist,
      r.target.z + Math.cos(r.yaw) * cp * r.dist,
    );
    this.camera.lookAt(r.target);
    this.sky.position.copy(this.camera.position);
    this.scene.fog.near = r.dist * 1.3;
    this.scene.fog.far = r.dist * 3.4 + 60;
    // the miniature look is strongest on the wide shots
    const u = this.post.uniforms;
    u.uBlur.value = 0.5 + zoom * 1.1;
    u.uBand.value = 0.24 - zoom * 0.08;
    u.uFocus.value = 0.47;
  }

  // ---------- input ----------
  groundAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const coins = [...this.recs.values()].filter((r) => r.coin?.visible).map((r) => r.coin.userData.hit);
    const hitCoin = this.raycaster.intersectObjects(coins, false)[0];
    if (hitCoin) return { coin: hitCoin.object.userData.coinFor };
    const hit = this.raycaster.intersectObjects(this.city ? this.city.children.filter((o) => o.isGroup) : [], true)
      .find((h) => h.object.userData.rec);
    if (hit) return { rec: hit.object.userData.rec };
    const g = this.groundAt(clientX, clientY);
    if (!g) return {};
    const [tx, ty] = this.toTile(g).map(Math.floor);
    const lot = this.L.buildings.find((b) => b.gx === tx && b.gy === ty);
    if (lot) return { rec: this.recs.get(lot.s.id) };
    return { tile: [tx, ty], road: drivable(this.L, tx, ty) };
  }

  bindInput(canvas) {
    const pointers = new Map();
    let drag = null, pinch = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.rig.distGoal };
        drag = null;
        return;
      }
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.rig.distGoal = pinch.dist * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
        return;
      }
      if (drag) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
        if (drag.moved) {
          this.rig.intro = false;
          if (drag.button === 2 || e.shiftKey) {
            drag.rotating = true;
            this.rig.yawGoal -= (e.clientX - drag.x) * 0.008;
          } else {
            const a = this.groundAt(drag.x, drag.y), b = this.groundAt(e.clientX, e.clientY);
            if (a && b) {
              this.rig.goal.add(a.sub(b));
              this.rig.target.copy(this.rig.goal);
            }
            this.rig.follow = false;
          }
          drag.x = e.clientX; drag.y = e.clientY;
          canvas.classList.add('dragging');
          this.setHover(null, e);
          return;
        }
      }
      const p = this.pick(e.clientX, e.clientY);
      this.setHover(p.rec ?? p.coin ?? null, e, !!p.coin);
      canvas.classList.toggle('pointing', !!(p.rec || p.coin || p.road));
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      canvas.classList.remove('dragging');
      const d = drag;
      drag = null;
      if (d?.rotating) this.rig.yawGoal = this.snapYaw(this.rig.yawGoal); // settle on the nearest diagonal
      if (!this.active || !d || d.moved || d.button !== 0 || e.type === 'pointercancel') return;
      const p = this.pick(e.clientX, e.clientY);
      if (p.coin) this.events.coin(p.coin);
      else if (p.rec) this.events.select(p.rec);
      else if (p.road) { this.events.ground?.(p.tile); this.driveTo(p.tile); this.marker(p.tile); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', (e) => this.setHover(null, e));
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      const r = this.rig;
      if (r.intro) { r.intro = false; r.distGoal = r.dist; }
      const before = r.distGoal;
      r.distGoal = clamp(r.distGoal * Math.exp(e.deltaY * 0.0012), r.minDist, r.maxDist);
      // zoom towards the cursor
      const g = this.groundAt(e.clientX, e.clientY);
      if (g && r.distGoal < before) r.goal.lerp(g.setY(0), 1 - r.distGoal / before);
      r.follow = false;
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (!this.active || e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'q') this.rotate(-1);
      else if (k === 'e') this.rotate(1);
      else this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  setHover(rec, e, coin = false) {
    if (rec === this.hover) { this.events.hover(rec, e, coin); return; }
    this.hover = rec;
    this.events.hover(rec, e, coin);
  }

  // ---------- coins, alerts & effects ----------
  setPending(id, amount) {
    const rec = this.recs.get(id);
    if (!rec || rec.pending === amount) return;
    rec.pending = amount;
    if (amount > 0 && !rec.coin) {
      const coin = makeCoin();
      coin.scale.setScalar(1.7);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.userData.coinFor = rec;
      coin.add(hit);
      coin.userData.hit = hit;
      this.city.add(coin);
      rec.coin = coin;
    }
    if (rec.coin) {
      rec.coin.visible = amount > 0;
      if (rec.coinLabel) { rec.coin.remove(rec.coinLabel); dispose(rec.coinLabel); rec.coinLabel = null; } // live amounts change every poll
      if (amount > 0) {
        rec.coinLabel = makeLabel('+' + (amount >= 1000 ? (amount / 1000).toFixed(1) + 'k' : amount), 0.38, { bg: '#fff7da', fg: '#8a5a00', font: 800, size: 40, border: '#f0c24a' });
        rec.coinLabel.position.set(0, 0.68, 0);
        rec.coin.add(rec.coinLabel);
      }
    }
  }

  collectFx(rec) {
    if (!rec.coin) return null;
    const pos = rec.coin.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 18; i++) this.sparkle(pos, ['#ffd166', '#fff1b0', '#f6c445'][i % 3]);
    const screen = this.project(pos);
    const coin = rec.coin;
    this.tweens.add(0.25, (k) => coin.scale.setScalar(1.7 * (1 + k * 0.6)), undefined, () => { coin.visible = false; coin.scale.setScalar(1.7); });
    rec.pending = 0;
    return screen;
  }

  bounce(rec) {
    this.tweens.add(0.5, (k) => { rec.squash = Math.sin(k * Math.PI * 2.5) * (1 - k) * 0.12; });
  }

  raise(rec) {
    rec.rise = 0;
    this.tweens.add(1.1, (k) => { rec.rise = k; }, easeOutBack);
    const p = rec.group.position;
    for (let i = 0; i < 14; i++) this.puff(new THREE.Vector3(p.x + (Math.random() - 0.5) * 1.6, 0.3, p.z + (Math.random() - 0.5) * 1.6), '#efe6d6', 0.5);
  }

  confetti(rec) {
    const p = rec ? rec.group.position.clone().setY(rec.height + 1) : this.car.obj.position.clone().setY(2);
    for (let i = 0; i < 60; i++) this.particle(p, {
      color: ['#ef6f8e', '#ffd166', '#7cf2c8', '#9cc3e6', '#b9a3e3'][i % 5], size: 0.14, life: 1.8,
      v: new THREE.Vector3((Math.random() - 0.5) * 7, 4 + Math.random() * 5, (Math.random() - 0.5) * 7), g: -9, spin: true, geo: GEO.box,
    });
  }

  marker(tile) {
    const p = this.toWorld(tile[0] + 0.5, tile[1] + 0.5, 0.08);
    const ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
    ring.position.copy(p);
    this.scene.add(ring);
    this.tweens.add(0.6, (k) => { ring.scale.setScalar(0.3 + k * 0.9); ring.material.opacity = 1 - k; }, undefined, () => { this.scene.remove(ring); ring.material.dispose(); });
  }

  particle(pos, { color, size = 0.2, life = 1, v = new THREE.Vector3(), g = 0, grow = 0, spin = false, geo = GEO.sphere, opacity = 1 }) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.position.copy(pos);
    m.scale.setScalar(size);
    this.scene.add(m);
    this.particles.push({ m, v, g, life, age: 0, size, grow, spin, opacity });
  }
  puff(pos, color = '#ffffff', size = 0.35) {
    this.particle(pos, { color, size, life: 1.2, v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4), grow: 1.2, opacity: 0.7 });
  }
  sparkle(pos, color) {
    this.particle(pos, { color, size: 0.12, life: 0.7, v: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6), g: -12 });
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      p.v.y += p.g * dt;
      p.m.position.addScaledVector(p.v, dt);
      const k = p.age / p.life;
      p.m.scale.setScalar(p.size * (1 + p.grow * k));
      p.m.material.opacity = p.opacity * (1 - k);
      if (p.spin) p.m.rotation.set(p.age * 7, p.age * 5, 0);
      if (k >= 1) { this.scene.remove(p.m); p.m.material.dispose(); this.particles.splice(i, 1); }
    }
  }

  // ---------- per frame ----------
  setNight(n) {
    if (Math.abs(n - this.night) < 0.001 && this.lightsSet) return;
    this.lightsSet = true;
    this.night = n;
    const u = this.sky.material.uniforms;
    u.uTop.value.set(mix(SKY.top, SKY.nightTop, n));
    u.uHorizon.value.set(mix(SKY.horizon, SKY.nightHorizon, n));
    u.uNight.value = n;
    this.scene.fog.color.copy(u.uHorizon.value);
    // at night the "sun" becomes cool moonlight and the city lights carry the scene
    this.hemi.intensity = 1.1 - n * 0.6;
    this.hemi.color.set(mix('#d6ecff', '#aab4d4', n));
    this.hemi.groundColor.set(mix('#a3b36e', '#4a4f3a', n));
    this.sun.intensity = 2.9 - n * 2.2;
    this.sun.color.set(mix('#ffe7c2', '#cdd6f2', n));
    this.rim.intensity = 0.7 + n * 0.3;
    this.renderer.toneMappingExposure = 1.0;
    if (this.pools) this.pools.material.opacity = n * 0.6;
    if (this.bulbs) this.bulbs.material.color.set(n > 0.3 ? '#ffd98a' : '#e8ebf0');
  }

  updateWindows(t) {
    const n = this.night, col = new THREE.Color();
    for (const rec of this.recs.values()) {
      const s = rec.s, wins = rec.windows;
      rec.windowRnd.forEach((r, i) => {
        let c;
        if (rec.colony === 'oldtown') {
          c = r < 0.35 ? '#8a6a48' : r < 0.55 ? '#2b2f38' : n > 0.4 ? '#1d2233' : '#8fa0a8';
        } else {
          const lit = r < LIT[s.status] * (n > 0.3 ? 1 : 0.5);
          const flicker = s.status === 'working' && Math.sin(t / 500 + r * 60) > 0.92;
          c = lit && !flicker ? (n > 0.3 ? '#ffd27a' : '#fff1c4') : n > 0.4 ? '#26324f' : '#a9d2ee';
        }
        wins.setColorAt(i, col.set(c));
      });
      if (wins.instanceColor) wins.instanceColor.needsUpdate = true;
    }
  }

  update(dt, t) {
    if (!this.L) return;
    this.tweens.update(dt);
    this.updateRig(dt);
    this.updateCar(dt);
    this.updateParticles(dt);
    for (const f of this.fountains) for (const d of f.userData.drops) {
      const k = (t / 1100 + d.phase) % 1;
      d.mesh.position.set(Math.cos(d.a) * k * 0.6, 1.0 + k * 0.6 - k * k * 1.3, Math.sin(d.a) * k * 0.6);
    }
    this.winClock -= dt;
    if (this.winClock <= 0) { this.updateWindows(t); this.winClock = 0.35; }

    const hover = this.hover, sel = this.selected;
    for (const rec of this.recs.values()) {
      const s = rec.s, live = s.status !== 'closed';
      const target = rec === hover || rec === sel ? 1.05 : 1;
      rec.scale += (target - rec.scale) * damp(14, dt);
      const sx = rec.scale * (1 - rec.squash * 0.5), sy = rec.scale * (1 + rec.squash) * Math.max(0.001, rec.rise);
      rec.group.scale.set(sx, sy, sx);
      const top = rec.group.position.y + (rec.height - PARK_TOP) * sy;

      if (rec.coin?.visible) {
        rec.coin.position.set(rec.group.position.x, top + 1.4 + Math.sin(t / 400 + rec.phase) * 0.15, rec.group.position.z);
        rec.coin.rotation.y = t / 500 + rec.phase;
      }
      // a bouncing "!" when the session needs you
      if (s.status === 'waiting') {
        if (!rec.alert) {
          rec.alert = makeLabel('!', 0.9, { bg: '#ffd166', fg: '#5a3d00', font: 900, size: 60, pad: 18, border: '#ffffff' });
          this.city.add(rec.alert);
        }
        rec.alert.visible = true;
        rec.alert.position.set(rec.group.position.x, top + (rec.coin?.visible ? 2.3 : 1.2) + Math.abs(Math.sin(t / 260)) * 0.35, rec.group.position.z);
      } else if (rec.alert) rec.alert.visible = false;
      // working: a ripple on the ground
      if (s.status === 'working') {
        if (!rec.pulse) {
          rec.pulse = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: '#4cc978', transparent: true, depthWrite: false }));
          rec.pulse.position.copy(rec.group.position).setY(PARK_TOP + 0.03);
          this.city.add(rec.pulse);
        }
        const k = (t / 1300 + rec.phase) % 1;
        rec.pulse.visible = true;
        rec.pulse.scale.setScalar(0.9 + k * 1.2);
        rec.pulse.material.opacity = 0.8 * (1 - k);
      } else if (rec.pulse) rec.pulse.visible = false;

      if (rec.chimney && live) {
        rec.smokeT -= dt;
        if (rec.smokeT <= 0) {
          rec.smokeT = 0.35;
          const p = rec.chimney.clone().multiply(rec.group.scale).add(rec.group.position);
          this.puff(p, '#d7dbe3', 0.25);
        }
      }
      if (rec.beacon) rec.beacon.visible = !live || Math.sin(t / 300 + rec.phase) > 0;
      if (rec.hook) {
        rec.hook.userData.y0 ??= rec.hook.position.y;
        rec.hook.position.y = rec.hook.userData.y0 + (live ? Math.sin(t / 700 + rec.phase) * 0.15 : 0);
      }
      if (rec.scope && live) rec.scope.rotation.y = t / 3000 + rec.phase;
      const drones = live ? Math.min(4, s.subagents || 0) : 0;
      rec.drones.forEach((d, i) => {
        d.visible = i < drones;
        if (!d.visible) return;
        const a = t / 1300 + rec.phase + i * Math.PI * 2 / drones;
        d.position.set(rec.group.position.x + Math.cos(a) * 1.4, top + 0.6 + Math.sin(a * 2) * 0.15, rec.group.position.z + Math.sin(a) * 1.4);
        d.rotation.y = -a;
      });
    }

    for (const [ring, rec, k] of [[this.selRing, sel, 1], [this.hoverRing, hover !== sel ? hover : null, 0.9]]) {
      ring.visible = !!rec;
      if (rec) {
        ring.position.copy(rec.group.position).setY(PARK_TOP + 0.04);
        ring.scale.setScalar(k * (1.15 + Math.sin(t / 250) * 0.04));
      }
    }
    const showLabels = this.rig.dist < 90;
    for (const l of this.labels) l.visible = showLabels;
  }

  render() { this.post.render(this.scene, this.camera); }
}
