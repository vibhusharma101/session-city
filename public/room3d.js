// Inside a building: a 3D room whose furniture is the kinds of work the session did,
// with a robot agent walking to whatever it is doing right now.
import * as THREE from './three.js';
import { GEO, mat, glowMat, part, makeRobot, makeLabel, KINDS, dispose } from './models.js';
import { mix, shade, damp, clamp } from './util.js';

const ROOM = 7;
const WALL = 3.0;
const MAIN = '#e8825e', SUB = '#a58be0';

// x/z footprint in room units; `spot` is where an agent stands to use it.
const STATIONS = [
  { id: 'research', label: 'Bookshelf', unit: 'reads & searches', x: 0.1, z: 1.1, w: 0.6, d: 1.7, h: 1.6, color: '#8a5a3b', spot: [1.2, 2.0] },
  { id: 'build', label: 'Workbench', unit: 'file edits', x: 1.9, z: 0.15, w: 1.7, d: 0.75, h: 0.62, color: '#c9a27a', spot: [2.75, 1.4] },
  { id: 'chat', label: 'Coffee machine', unit: '', x: 3.95, z: 0.15, w: 0.55, d: 0.55, h: 0.9, color: '#dcd6cc', spot: [4.2, 1.15] },
  { id: 'shell', label: 'Terminal rack', unit: 'commands run', x: 4.8, z: 0.15, w: 0.85, d: 0.7, h: 1.75, color: '#3b4256', spot: [5.2, 1.35] },
  { id: 'web', label: 'Globe', unit: 'web & browser actions', x: 5.6, z: 3.6, w: 0.8, d: 0.8, h: 0.55, color: '#6b7280', spot: [5.2, 4.9] },
  { id: 'mcp', label: 'Switchboard', unit: 'MCP tool calls', x: 0.1, z: 4.4, w: 0.6, d: 1.3, h: 1.15, color: '#5b6478', spot: [1.25, 5.05] },
];
const DESKS = [[2.0, 2.9], [3.4, 2.9], [2.0, 4.2], [3.4, 4.2]];
const stationFor = (id) => STATIONS.find((s) => s.id === id);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// What you see out of the window: sky, a skyline and treetops; lit up at night.
function windowView(night) {
  return canvasTexture(512, 360, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 360);
    sky.addColorStop(0, night ? '#0b1430' : '#7fc3f0');
    sky.addColorStop(1, night ? '#2a3768' : '#dff1fb');
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 360);
    if (night) {
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 40; i++) g.fillRect((i * 97) % 512, (i * 53) % 170, 2, 2);
      g.fillStyle = '#f4f1e0'; g.beginPath(); g.arc(410, 70, 22, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = 'rgba(255,255,255,.9)';
      for (const [x, y, s] of [[90, 70, 1], [330, 110, 1.3]]) {
        g.beginPath(); g.ellipse(x, y, 46 * s, 16 * s, 0, 0, Math.PI * 2); g.ellipse(x + 30 * s, y - 10 * s, 30 * s, 16 * s, 0, 0, Math.PI * 2); g.fill();
      }
    }
    let x = 0, i = 0;
    while (x < 512) {
      const w = 40 + ((i * 37) % 50), h = 90 + ((i * 71) % 130);
      g.fillStyle = night ? '#1a2244' : ['#a9b6c9', '#c3cbd8', '#9fb0c4'][i % 3];
      g.fillRect(x, 360 - h - 40, w - 6, h);
      for (let wy = 360 - h - 30; wy < 320; wy += 16) for (let wx = x + 6; wx < x + w - 14; wx += 12) {
        if (night && ((wx * 7 + wy * 3 + i) % 5)) continue;
        g.fillStyle = night ? '#ffd27a' : 'rgba(255,255,255,.55)';
        g.fillRect(wx, wy, 6, 8);
      }
      x += w; i++;
    }
    g.fillStyle = night ? '#16301f' : '#5aa54f';
    for (let t = 0; t < 14; t++) { g.beginPath(); g.arc(t * 40 + 10, 345, 34, 0, Math.PI * 2); g.fill(); }
  });
}

function plant(scene, x, y, z, s) {
  const shadow = y === 0; // plants up on the shelf would smudge the floor with soft shadows
  const pot = part(GEO.cyl, mat('#c46a4a'), [0.38 * s, 0.34 * s, 0.38 * s], [x, y, z], shadow);
  scene.add(pot);
  const leaves = [[0, 0.7, 0, 0.55], [-0.12, 0.55, 0.08, 0.4], [0.12, 0.6, -0.06, 0.42], [0.04, 0.88, 0.05, 0.36]];
  for (const [dx, dy, dz, r] of leaves) {
    scene.add(part(GEO.blob, mat(dy > 0.8 ? '#6fcb5c' : '#4ea545'), [r * s, r * s * 1.1, r * s], [x + dx * s, y + dy * s, z + dz * s], shadow));
  }
}

export class Room {
  constructor(session) {
    this.id = session.id;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9dcc6'); // never seen: the room encloses the camera
    // you stand in a front corner of the room, at eye height, looking across it
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 60);
    this.yaw = Math.PI / 4;
    this.yawGoal = this.yaw;

    // daylight through the window, warm bounce off the floor, and the ceiling lamps
    this.fill = new THREE.HemisphereLight('#fff6e8', '#8a6a4c', 1.2);
    this.sunlight = new THREE.DirectionalLight('#fff0d8', 1.6);
    this.sunlight.position.set(-6, 9, 4);
    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(1024, 1024);
    this.sunlight.shadow.normalBias = 0.02;
    const sc = this.sunlight.shadow.camera;
    sc.left = sc.bottom = -6; sc.right = sc.top = 6;
    this.sunlight.target.position.set(3.5, 0, 3.5);
    scene.add(this.fill, this.sunlight, this.sunlight.target);

    this.hits = [];
    this.anim = {};
    this.lamps = [];
    this.buildRoom(session);
    this.buildStations(session);

    this.agent = makeRobot(MAIN, 1.25);
    this.agent.position.set(2.75, 0, 1.4);
    scene.add(this.agent);
    this.subs = [];
    const n = Math.min(DESKS.length, session.subagents || 0);
    for (let i = 0; i < n; i++) {
      const [x, z] = DESKS[i];
      const r = makeRobot(SUB, 0.95);
      r.position.set(x + 0.42, 0, z - 0.25);
      r.rotation.y = Math.PI;
      scene.add(r);
      this.subs.push(r);
    }
    this.state = { lastGroup: null, wanderAt: 0, goalId: 'build', mode: 'idle' };
  }

  buildRoom(s) {
    const kind = KINDS[s.kind].color;
    const scene = this.scene;
    const upper = mix('#f6f0e4', kind, 0.16), lower = mix(shade(kind, -0.15), '#8a6a4c', 0.35);
    const add = (m) => { m.castShadow = false; scene.add(m); return m; };

    // floorboards
    const floorTex = canvasTexture(512, 512, (g) => {
      for (let row = 0; row < 16; row++) {
        let x = -((row * 97) % 180);
        while (x < 512) {
          const w = 140 + ((row * 31 + Math.abs(x)) % 90);
          const tone = 168 + ((row * 13 + Math.abs(x) * 7) % 26);
          g.fillStyle = `rgb(${tone + 40},${tone - 2},${tone - 52})`;
          g.fillRect(x, row * 32, w, 32);
          g.fillStyle = 'rgba(60,35,15,.35)';
          g.fillRect(x, row * 32, 2, 32);
          x += w;
        }
        g.fillStyle = 'rgba(60,35,15,.4)';
        g.fillRect(0, row * 32, 512, 2);
      }
    });
    floorTex.repeat.set(2, 2);
    add(part(GEO.box, new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }), [ROOM, 0.1, ROOM], [ROOM / 2, -0.1, ROOM / 2]));
    add(part(GEO.box, mat(mix(kind, '#ffffff', 0.3), { flatShading: false }), [3.9, 0.02, 2.7], [3.65, 0, 3.75]));
    add(part(GEO.box, mat(mix(kind, '#ffffff', 0.6), { flatShading: false }), [3.5, 0.025, 2.3], [3.65, 0, 3.75]));

    // four walls (two-tone, with a dado rail and skirting) and a ceiling, so every
    // direction you look is room
    const walls = [
      { x: -0.07, z: ROOM / 2, alongZ: true },
      { x: ROOM + 0.07, z: ROOM / 2, alongZ: true },
      { x: ROOM / 2, z: -0.07, alongZ: false },
      { x: ROOM / 2, z: ROOM + 0.07, alongZ: false },
    ];
    const span = (t, len = ROOM + 0.28) => (w) => (w.alongZ ? [t, 0, len] : [len, 0, t]);
    for (const w of walls) {
      const size = (t, h, len) => { const [a, , b] = span(t, len)(w); return [a, h, b]; };
      add(part(GEO.box, mat(upper, { flatShading: false }), size(0.14, WALL), [w.x, 0, w.z]));
      add(part(GEO.box, mat(lower, { flatShading: false }), size(0.17, 1.0, ROOM), [w.x, 0, w.z]));
      add(part(GEO.box, mat('#f4ead8'), size(0.21, 0.06, ROOM), [w.x, 1.0, w.z]));
      add(part(GEO.box, mat(shade(lower, -0.3)), size(0.21, 0.14, ROOM), [w.x, 0, w.z]));
      add(part(GEO.box, mat('#efe6d4', { emissive: '#8a7d68', emissiveIntensity: 0.45 }), size(0.3, 0.12, ROOM), [w.x, WALL - 0.12, w.z]));
    }
    // the ceiling only sees bounce light from the floor, so give it a soft glow of its own
    add(part(GEO.box, mat('#f7f2e8', { flatShading: false, emissive: '#b9a88f', emissiveIntensity: 0.55 }), [ROOM + 0.3, 0.12, ROOM + 0.3], [ROOM / 2, WALL, ROOM / 2]));

    // a window onto the city (sky and skyline change with day and night)
    this.views = { day: windowView(false), night: windowView(true) };
    const z0 = 2.85, len = 1.8, y0 = 1.05, h = 1.25;
    this.pane = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshBasicMaterial({ map: this.views.day, toneMapped: false }));
    this.pane.rotation.y = Math.PI / 2;
    this.pane.position.set(0.09, y0 + h / 2, z0 + len / 2);
    add(this.pane);
    const bar = (sx, sy, sz, px, py, pz) => add(part(GEO.box, mat('#ffffff'), [sx, sy, sz], [px, py, pz]));
    bar(0.1, 0.08, len + 0.16, 0.11, y0 - 0.08, z0 + len / 2);
    bar(0.1, 0.08, len + 0.16, 0.11, y0 + h, z0 + len / 2);
    bar(0.1, h, 0.08, 0.11, y0, z0 - 0.04);
    bar(0.1, h, 0.08, 0.11, y0, z0 + len + 0.04);
    bar(0.1, h, 0.05, 0.11, y0, z0 + len / 2);
    bar(0.24, 0.05, len + 0.3, 0.14, y0 - 0.1, z0 + len / 2);

    // the exit door
    const door = new THREE.Group();
    door.add(part(GEO.box, mat('#6f4f36'), [1.0, 2.05, 0.1], [6.3, 0, 0.03]));
    door.add(part(GEO.box, mat('#a77a55'), [0.84, 1.95, 0.12], [6.3, 0, 0.04]));
    for (const y of [0.35, 1.15]) door.add(part(GEO.box, mat('#956b49'), [0.6, 0.6, 0.14], [6.3, y, 0.04]));
    door.add(part(GEO.sphere, mat('#f2d48a', { metalness: 0.6, roughness: 0.3 }), [0.09, 0.09, 0.09], [6.62, 0.95, 0.13]));
    const exit = makeLabel('EXIT', 0.26, { bg: '#2fae5a', fg: '#ffffff', font: 800, size: 40, radius: 8 });
    exit.position.set(6.3, 2.3, 0.12);
    door.add(exit);
    door.traverse((o) => { o.userData.door = true; });
    scene.add(door);
    this.hits.push(door);

    // a wall clock showing the real time, above the coffee machine
    const clock = new THREE.Group();
    clock.position.set(4.25, 2.2, 0.09);
    clock.add(new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), new THREE.MeshStandardMaterial({ map: canvasTexture(128, 128, (g) => {
      g.fillStyle = '#fffaf0'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3b2f22';
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.fillRect(64 + Math.sin(a) * 50 - 2, 64 - Math.cos(a) * 50 - 5, 4, 10); }
    }) })));
    clock.add(new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.03, 8, 32), new THREE.MeshStandardMaterial({ color: shade(kind, -0.35) })));
    const hand = (l, w) => {
      const pivot = new THREE.Group();
      pivot.add(new THREE.Mesh(new THREE.BoxGeometry(w, l, 0.01).translate(0, l / 2, 0.015), new THREE.MeshBasicMaterial({ color: '#2b2118' })));
      clock.add(pivot);
      return pivot;
    };
    this.anim.clock = { hour: hand(0.15, 0.025), minute: hand(0.22, 0.016) };
    scene.add(clock);

    // framed art above the workbench, in the building's colour
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshStandardMaterial({ map: canvasTexture(220, 150, (g) => {
      g.fillStyle = mix(kind, '#ffffff', 0.55); g.fillRect(0, 0, 220, 150);
      g.fillStyle = shade(kind, -0.1); g.beginPath(); g.arc(70, 80, 42, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(110, 130); g.lineTo(160, 40); g.lineTo(210, 130); g.fill();
      g.fillStyle = shade(kind, -0.35); g.fillRect(0, 128, 220, 22);
    }) }));
    art.position.set(2.75, 1.85, 0.1);
    add(art);
    add(part(GEO.box, mat('#5a4030'), [1.22, 0.87, 0.04], [2.75, 1.85 - 0.435, 0.06]));

    // a shelf of plants over the switchboard, and potted plants in the corners
    add(part(GEO.box, mat('#8a6446'), [0.3, 0.05, 1.5], [0.2, 1.75, 5.1]));
    for (const z of [4.6, 5.1, 5.6]) plant(scene, 0.2, 1.8, z, 0.35);
    plant(scene, 6.5, 0, 2.6, 1);
    plant(scene, 0.55, 0, 6.45, 1.2);
    plant(scene, 6.45, 0, 6.45, 0.9);

    // pendant lamps
    for (const [x, z] of [[2.7, 3.6], [4.6, 3.6]]) {
      add(part(GEO.cyl, mat('#3b3f4a'), [0.015, 0.7, 0.015], [x, WALL - 0.7, z]));
      add(part(GEO.cone8, mat(shade(kind, -0.25), { side: THREE.DoubleSide }), [0.55, 0.32, 0.55], [x, WALL - 1.0, z]));
      const bulb = add(part(GEO.sphere, new THREE.MeshBasicMaterial({ color: '#fff1c4', toneMapped: false }), [0.14, 0.14, 0.14], [x, WALL - 1.0, z]));
      const light = new THREE.PointLight('#ffcf8a', 0.5, 7, 1.6);
      light.position.set(x, WALL - 1.15, z);
      scene.add(light);
      this.lamps.push({ light, bulb });
    }
  }

  buildStations(s) {
    const used = STATIONS.filter((st) => st.id === 'build' || st.id === 'chat' || (s.groups?.[st.id] || 0) > 0);
    for (const st of used) {
      const g = new THREE.Group();
      g.add(part(GEO.box, mat(st.color), [st.w, st.h, st.d], [st.x + st.w / 2, 0, st.z + st.d / 2]));
      const cx = st.x + st.w / 2, cz = st.z + st.d / 2;
      switch (st.id) {
        case 'research': // books on the shelves facing the room
          for (let shelf = 0; shelf < 4; shelf++) {
            const y = 0.12 + shelf * 0.38;
            g.add(part(GEO.box, mat(shade(st.color, -0.3)), [0.04, 0.03, st.d], [st.x + st.w + 0.01, y - 0.02, cz]));
            for (let i = 0; i < 8; i++) {
              const colr = ['#c0392b', '#2e86de', '#f6b93b', '#38ada9', '#8e44ad', '#e17055', '#27ae60'][(i + shelf * 3) % 7];
              g.add(part(GEO.box, mat(colr), [0.06, 0.24 + ((i * shelf) % 3) * 0.04, 0.16], [st.x + st.w + 0.03, y, st.z + 0.15 + i * 0.2]));
            }
          }
          break;
        case 'build': { // a monitor with scrolling code
          g.add(part(GEO.box, mat('#555c6e'), [0.06, 0.18, 0.06], [cx, st.h, st.z + 0.2]));
          g.add(part(GEO.box, mat('#2b3040'), [0.8, 0.5, 0.06], [cx, st.h + 0.15, st.z + 0.2]));
          const code = document.createElement('canvas');
          code.width = 128; code.height = 80;
          const tex = new THREE.CanvasTexture(code);
          tex.colorSpace = THREE.SRGBColorSpace;
          const screen = part(GEO.box, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [0.72, 0.42, 0.01], [cx, st.h + 0.19, st.z + 0.235], false);
          g.add(screen);
          this.anim.code = { canvas: code, tex, t: 0 };
          g.add(part(GEO.box, mat('#e8e8ec'), [0.5, 0.03, 0.16], [cx, st.h, st.z + 0.52]));
          break;
        }
        case 'chat':
          g.add(part(GEO.box, mat('#3b3f4a'), [0.4, 0.12, 0.04], [cx, 0.62, st.z + st.d + 0.01]));
          g.add(part(GEO.cyl, mat('#ffffff'), [0.12, 0.13, 0.12], [cx, 0.36, st.z + st.d - 0.06]));
          this.anim.steam = new THREE.Vector3(cx, 0.55, st.z + st.d - 0.06);
          break;
        case 'shell': { // blinking lights on the rack's front
          const leds = [];
          for (let r = 0; r < 7; r++) for (let i = 0; i < 4; i++) {
            const led = part(GEO.box, new THREE.MeshBasicMaterial({ color: '#3f4658', toneMapped: false }), [0.07, 0.04, 0.02], [st.x + 0.17 + i * 0.17, 0.22 + r * 0.21, st.z + st.d + 0.005], false);
            g.add(led);
            leds.push({ led, r, i });
          }
          this.anim.leds = leds;
          break;
        }
        case 'web': {
          g.children[0].scale.set(0.4, st.h, 0.4);
          const globe = new THREE.Group();
          globe.position.set(cx, st.h + 0.35, cz);
          globe.add(part(GEO.sphere, mat('#4fa3e0', { flatShading: false, roughness: 0.5 }), [0.55, 0.55, 0.55], [0, 0, 0]));
          for (let i = 0; i < 5; i++) {
            const land = part(GEO.blob, mat('#6cbf5f'), [0.18, 0.12, 0.2], [Math.cos(i * 1.3) * 0.22, (i % 3 - 1) * 0.12, Math.sin(i * 1.3) * 0.22]);
            globe.add(land);
          }
          g.add(globe);
          this.anim.globe = globe;
          break;
        }
        case 'mcp':
          for (let r = 0; r < 4; r++) for (let i = 0; i < 5; i++) {
            g.add(part(GEO.box, glowMat(['#ef6f8e', '#ffd27a', '#7cf2c8', '#9cc3e6'][(r + i) % 4]), [0.03, 0.08, 0.08], [st.x + st.w + 0.01, 0.35 + r * 0.18, st.z + 0.2 + i * 0.22], false));
          }
          break;
      }
      g.traverse((o) => { o.userData.station = st; });
      this.scene.add(g);
      this.hits.push(g);
    }
    // desks for the subagents
    const n = Math.min(DESKS.length, s.subagents || 0);
    for (let i = 0; i < n; i++) {
      const [x, z] = DESKS[i];
      this.scene.add(part(GEO.box, mat('#b98c62'), [0.9, 0.45, 0.5], [x + 0.45, 0, z]));
      this.scene.add(part(GEO.box, mat('#2b3040'), [0.4, 0.28, 0.04], [x + 0.45, 0.45, z - 0.12]));
    }
  }

  dispose() {
    this.views.day.dispose();
    this.views.night.dispose();
    dispose(this.scene);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // narrow screens need a wider lens to keep the room in view
    this.camera.fov = clamp(70 - (w / h) * 11, 48, 62);
    this.camera.updateProjectionMatrix();
  }

  // Dragging turns your head; you stay standing in the corner.
  rotate(dx) { this.yawGoal = clamp(this.yawGoal - dx * 0.004, Math.PI / 4 - 0.55, Math.PI / 4 + 0.55); }

  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.hits, true)[0];
    if (!hit) return null;
    return hit.object.userData.door ? { door: true } : hit.object.userData.station ? { station: hit.object.userData.station } : null;
  }

  update(dt, t, s, night) {
    // camera: standing in the front corner at eye height, with a slow breathing sway
    this.yaw += (this.yawGoal - this.yaw) * damp(6, dt);
    const sway = Math.sin(t / 2600) * 0.012;
    this.camera.position.set(6.55, 2.05 + sway, 6.55);
    const look = 6.2;
    this.camera.lookAt(6.55 - Math.sin(this.yaw) * look, 0.55, 6.55 - Math.cos(this.yaw) * look);

    // light: daylight through the window by day, the pendant lamps at night
    this.sunlight.intensity = 1.6 * (1 - night) + 0.15;
    this.fill.intensity = 1.2 - night * 0.55;
    this.fill.color.set(mix('#fff6e8', '#c9b7a0', night));
    for (const l of this.lamps) {
      l.light.intensity = 0.4 + night * 5;
      l.bulb.material.color.set(night > 0.3 ? '#ffe2a0' : '#fff6dc');
    }
    const view = night > 0.5 ? this.views.night : this.views.day;
    if (this.pane.material.map !== view) { this.pane.material.map = view; this.pane.material.needsUpdate = true; }
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    this.anim.clock.minute.rotation.z = -(mins % 60) / 60 * Math.PI * 2;
    this.anim.clock.hour.rotation.z = -(mins % 720) / 720 * Math.PI * 2;

    // where the agent wants to be
    const st = this.state;
    let goal, at = null;
    if (s.status === 'waiting') { goal = [3.6, 5.6]; st.mode = 'wait'; }
    else if (s.status === 'open') { at = stationFor('chat'); st.mode = 'idle'; }
    else if (s.status === 'closed') { at = stationFor('build'); st.mode = 'sleep'; }
    else {
      st.mode = 'work';
      if (s.lastGroup !== st.lastGroup) { st.lastGroup = s.lastGroup; st.wanderAt = t + 7000; st.goalId = s.lastGroup; }
      if (t > st.wanderAt) {
        const busy = STATIONS.filter((x) => (s.groups?.[x.id] || 0) > 0);
        st.goalId = busy.length ? busy[Math.floor(Math.random() * busy.length)].id : 'build';
        st.wanderAt = t + 5000 + Math.random() * 4000;
      }
      at = stationFor(st.goalId) ?? stationFor('build');
    }
    if (at) goal = at.spot;
    const a = this.agent, u = a.userData;
    const dx = goal[0] - a.position.x, dz = goal[1] - a.position.z, dist = Math.hypot(dx, dz);
    const walking = dist > 0.05;
    if (walking) {
      const step = Math.min(dist, 1.8 * dt);
      a.position.x += dx / dist * step;
      a.position.z += dz / dist * step;
      const face = Math.atan2(dx, dz);
      let diff = Math.atan2(Math.sin(face - a.rotation.y), Math.cos(face - a.rotation.y));
      a.rotation.y += diff * damp(12, dt);
    } else {
      // face the station, or the camera when waiting for you
      const face = at ? Math.atan2(at.x + at.w / 2 - a.position.x, at.z + at.d / 2 - a.position.z) : Math.PI / 4;
      let diff = Math.atan2(Math.sin(face - a.rotation.y), Math.cos(face - a.rotation.y));
      a.rotation.y += diff * damp(8, dt);
    }
    const mode = walking ? 'walk' : st.mode;
    a.position.y = mode === 'walk' ? Math.abs(Math.sin(t / 110)) * 0.06 : 0;
    u.head.rotation.x = mode === 'sleep' ? 0.45 : 0;
    u.head.rotation.z = mode === 'idle' ? Math.sin(t / 900) * 0.08 : 0;
    u.arms[0].rotation.x = mode === 'walk' ? Math.sin(t / 110) * 0.7 : mode === 'work' ? -1.1 + Math.sin(t / 90) * 0.25 : 0;
    u.arms[1].rotation.x = mode === 'walk' ? -Math.sin(t / 110) * 0.7 : mode === 'work' ? -1.1 + Math.cos(t / 90) * 0.25 : 0;
    u.arms[1].rotation.z = mode === 'wait' ? 2.6 + Math.sin(t / 150) * 0.4 : 0;
    u.eyes.forEach((e) => { e.scale.y = mode === 'sleep' ? 0.01 : Math.sin(t / 1700) > 0.97 ? 0.01 : 0.05; });

    this.subs.forEach((r, i) => {
      const ru = r.userData;
      const working = s.status === 'working';
      ru.arms[0].rotation.x = working ? -1.1 + Math.sin(t / 95 + i) * 0.25 : 0;
      ru.arms[1].rotation.x = working ? -1.1 + Math.cos(t / 95 + i) * 0.25 : 0;
      ru.head.rotation.x = s.status === 'closed' ? 0.45 : 0;
    });

    // props
    const live = s.status === 'working';
    if (this.anim.globe) this.anim.globe.rotation.y += (live ? 0.8 : 0.1) * dt;
    if (this.anim.leds) for (const { led, r, i } of this.anim.leds) {
      const on = live ? Math.sin(t / (90 + i * 37) + r * 2 + i) > 0 : (r + i) % 3 === 0;
      led.material.color.set(on ? (i % 2 ? '#7cf2c8' : '#ffd27a') : '#3f4658');
    }
    if (this.anim.code) {
      const c = this.anim.code;
      c.t -= dt;
      if (c.t <= 0) {
        c.t = live && s.lastGroup === 'build' ? 0.25 : 2;
        const g = c.canvas.getContext('2d');
        g.fillStyle = '#1b2233'; g.fillRect(0, 0, 128, 80);
        const off = Math.floor(t / 250);
        for (let i = 0; i < 7; i++) {
          g.fillStyle = ['#7cf2c8', '#ffd27a', '#9cc3e6', '#f2a7bd'][(i + off) % 4];
          g.fillRect(8 + (i % 2) * 10, 8 + i * 10, 20 + ((i + off) * 37) % 70, 5);
        }
        c.tex.needsUpdate = true;
      }
    }
    // floating Zzz while asleep, steam while on a coffee break
    this.fx = this.fx ?? [];
    this.fxT = (this.fxT ?? 0) - dt;
    if (this.fxT <= 0) {
      this.fxT = 0.7;
      if (st.mode === 'sleep' && !walking) this.spawn(makeLabel('z', 0.3, { bg: 'rgba(255,255,255,.0)', fg: '#ffffff', font: 800, size: 60, pad: 4 }), a.position.clone().setY(1.6), 2.2);
      if (st.mode === 'idle' && this.anim.steam) {
        const puff = part(GEO.sphere, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }), [0.12, 0.12, 0.12], [0, 0, 0], false);
        this.spawn(puff, this.anim.steam.clone(), 1.4);
      }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      f.obj.position.y += dt * 0.5;
      f.obj.position.x += Math.sin(f.age * 3) * dt * 0.2;
      f.obj.material.opacity = Math.max(0, 1 - f.age / f.life);
      if (f.age >= f.life) { this.scene.remove(f.obj); this.fx.splice(i, 1); }
    }
  }

  spawn(obj, pos, life) {
    obj.position.copy(pos);
    obj.material.transparent = true;
    this.scene.add(obj);
    this.fx.push({ obj, age: 0, life });
  }

  // where to draw the speech bubble
  headPosition() { return this.agent.position.clone().setY(this.agent.position.y + 1.55); }
}
