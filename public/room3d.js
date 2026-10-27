// Inside a building: a 3D room whose furniture is the kinds of work the session did,
// with a robot agent walking to whatever it is doing right now.
import * as THREE from './three.js';
import { GEO, mat, glowMat, part, makeRobot, makeLabel, KINDS } from './models.js';
import { mix, shade, damp, clamp } from './util.js';

const ROOM = 7;
const WALL = 2.6;
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

export class Room {
  constructor(session) {
    this.id = session.id;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#1f2438');
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.yaw = Math.PI / 4;
    this.yawGoal = this.yaw;
    scene.add(new THREE.HemisphereLight('#fff6e8', '#6a5040', 1.3));
    const key = new THREE.DirectionalLight('#fff0d8', 2.2);
    key.position.set(9, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -7; sc.right = sc.top = 7;
    key.target.position.set(3.5, 0, 3.5);
    scene.add(key, key.target);
    this.lamp = new THREE.PointLight('#ffcf8a', 0, 9);
    this.lamp.position.set(3.5, 2.3, 3.5);
    scene.add(this.lamp);

    this.hits = [];
    this.anim = {};
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
    this.zzz = [];
  }

  buildRoom(s) {
    const kind = KINDS[s.kind].color;
    const wall = mix('#f4efe6', kind, 0.2);
    const scene = this.scene;
    // floor boards
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#d7b48c' : '#cfab82';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(ROOM / 8 * 2, ROOM / 8 * 2);
    tex.magFilter = THREE.NearestFilter;
    const floor = part(GEO.box, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), [ROOM, 0.1, ROOM], [ROOM / 2, -0.1, ROOM / 2], false);
    scene.add(floor);
    scene.add(part(GEO.box, mat(mix(kind, '#ffffff', 0.35), { flatShading: false }), [3.9, 0.02, 2.6], [3.65, 0, 3.75], false));

    // two walls with skirting, a window and the exit door
    scene.add(part(GEO.box, mat(shade(wall, -0.06)), [0.12, WALL, ROOM], [-0.06, 0, ROOM / 2]));
    scene.add(part(GEO.box, mat(wall), [ROOM, WALL, 0.12], [ROOM / 2, 0, -0.06]));
    scene.add(part(GEO.box, mat(shade(wall, -0.3)), [0.14, 0.14, ROOM], [-0.05, 0, ROOM / 2]));
    scene.add(part(GEO.box, mat(shade(wall, -0.3)), [ROOM, 0.14, 0.14], [ROOM / 2, 0, -0.05]));
    scene.add(part(GEO.box, mat('#ffffff'), [0.06, 1.1, 1.8], [0.01, 1.2, 3.75], false));
    this.windowGlass = part(GEO.box, new THREE.MeshBasicMaterial({ color: '#9fd3f0', toneMapped: false }), [0.07, 0.95, 1.65], [0.02, 1.27, 3.75], false);
    scene.add(this.windowGlass);
    scene.add(part(GEO.box, mat('#ffffff'), [0.08, 0.95, 0.05], [0.02, 1.27, 3.75], false));

    const door = new THREE.Group();
    door.add(part(GEO.box, mat('#8a6446'), [0.8, 1.45, 0.08], [6.4, 0, 0.02]));
    door.add(part(GEO.box, mat('#a77a55'), [0.68, 1.35, 0.1], [6.4, 0, 0.03]));
    door.add(part(GEO.sphere, mat('#f2d48a', { metalness: 0.6, roughness: 0.3 }), [0.08, 0.08, 0.08], [6.66, 0.7, 0.1]));
    const exit = makeLabel('EXIT', 0.22, { bg: '#2fae5a', fg: '#ffffff', font: 800, size: 40, radius: 8 });
    exit.position.set(6.4, 1.72, 0.1);
    door.add(exit);
    door.traverse((o) => { o.userData.door = true; });
    scene.add(door);
    this.hits.push(door);
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

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dist = clamp(22 / Math.min(1.4, w / h), 15, 30);
  }

  rotate(dx) { this.yawGoal = clamp(this.yawGoal - dx * 0.006, Math.PI / 4 - 0.6, Math.PI / 4 + 0.6); }

  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.hits, true)[0];
    if (!hit) return null;
    return hit.object.userData.door ? { door: true } : hit.object.userData.station ? { station: hit.object.userData.station } : null;
  }

  update(dt, t, s, night) {
    // camera
    this.yaw += (this.yawGoal - this.yaw) * damp(8, dt);
    const d = this.dist ?? 19;
    this.camera.position.set(3.5 + Math.sin(this.yaw) * d * 0.72, d * 0.62, 3.5 + Math.cos(this.yaw) * d * 0.72);
    this.camera.lookAt(3.3, 0.6, 3.3);
    this.windowGlass.material.color.set(night > 0.5 ? '#1d2a55' : mix('#9fd3f0', '#1d2a55', night));
    this.lamp.intensity = night * 6;

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
