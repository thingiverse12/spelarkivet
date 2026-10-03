/**
 * Three.js renderer: world mesh generation, soldier models, weapon viewmodel,
 * and the pooled effect system (tracers, impacts, explosions, smoke).
 */
import { buildWorld } from '../shared/physics.js';
import { getMapBoxes } from '../shared/maps.js';

/**
 * The 3D engine is vendored into the repo (vendor/three.module.min.js, three.js
 * r160, MIT) so the game works offline and on static hosting. Public CDNs are
 * only a fallback if somebody deletes the vendored copy.
 */
const LOCAL_SOURCE = '../../vendor/three.module.min.js';
const CDN_SOURCES = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js',
  'https://unpkg.com/three@0.160.0/build/three.module.min.js',
  'https://esm.sh/three@0.160.0'
];

export async function loadThree() {
  let lastErr = null;
  for (const url of [LOCAL_SOURCE, ...CDN_SOURCES]) {
    try {
      const mod = await import(/* webpackIgnore: true */ url);
      if (mod && mod.Scene) return mod;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('three.js unavailable');
}

/* ------------------------------------------------------------------ */

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const FACES = [
  { n: [0, 1, 0], b: 1.0, c: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], uv: 'xz' },
  { n: [0, -1, 0], b: 0.4, c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], uv: 'xz' },
  { n: [0, 0, 1], b: 0.82, c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], uv: 'xy' },
  { n: [0, 0, -1], b: 0.7, c: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]], uv: 'xy' },
  { n: [1, 0, 0], b: 0.64, c: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], uv: 'zy' },
  { n: [-1, 0, 0], b: 0.56, c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], uv: 'zy' }
];

export class Renderer {
  constructor(canvas, THREE) {
    this.T = THREE;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 800);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 12);

    this.texture = this.makePanelTexture();
    this.worldMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.texture });

    this.players = new Map();
    this.entityMeshes = new Map();
    this.tracers = [];
    this.particles = [];
    this.smokeClouds = [];
    this.flashes = [];
    this.viewModel = null;
    this.viewModelWeapon = null;
    this.time = 0;

    this.initEffects();
    this.vmScene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const vmLight = new THREE.DirectionalLight(0xffffff, 1.6);
    vmLight.position.set(-0.4, 1, 0.6);
    this.vmScene.add(vmLight);
    this.resize();
  }

  /* ------------------------------ setup ------------------------------ */

  makePanelTexture() {
    const T = this.T;
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, size, size);
    // Noise
    const img = g.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    // Panel seams
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, size - 2, size - 2);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, size / 2); g.lineTo(size, size / 2); g.stroke();
    g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.stroke();
    // Rivets
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (const [x, y] of [[8, 8], [size - 8, 8], [8, size - 8], [size - 8, size - 8]]) {
      g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
    }
    const tex = new T.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  loadMap(map) {
    const T = this.T;
    // Clear the previous world.
    for (const child of [...this.scene.children]) {
      if (child.userData.world || child.userData.sky) {
        this.scene.remove(child);
        child.geometry?.dispose?.();
      }
    }

    const theme = map.theme;
    this.scene.fog = new T.FogExp2(new T.Color(theme.fog).getHex(), theme.fogDensity);
    this.scene.background = new T.Color(theme.sky);

    const hemi = new T.HemisphereLight(new T.Color(theme.sky), new T.Color(theme.ambient), 1.15);
    hemi.userData.world = true;
    this.scene.add(hemi);

    const sun = new T.DirectionalLight(new T.Color(theme.sun.color), theme.sun.intensity * 0.55);
    sun.position.set(theme.sun.dir[0] * 100, theme.sun.dir[1] * 100, theme.sun.dir[2] * 100);
    sun.userData.world = true;
    this.scene.add(sun);

    const sky = this.makeSky(theme);
    sky.userData.sky = true;
    this.scene.add(sky);

    const mesh = this.buildWorldMesh(map.boxes);
    mesh.userData.world = true;
    this.scene.add(mesh);
    this.mapBounds = map.bounds || null;
  }

  /**
   * Physics world for client-side prediction. Built once per map and cached —
   * it is the exact same world the server simulates against.
   */
  worldFor(mapId) {
    if (this._worldFor !== mapId) {
      this._world = buildWorld(getMapBoxes(mapId));
      this._worldFor = mapId;
    }
    return this._world;
  }

  makeSky(theme) {
    const T = this.T;
    const geo = new T.SphereGeometry(500, 20, 14);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = hexToRgb(theme.sky);
    const bottom = hexToRgb(theme.skyBottom);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 500;
      const t = Math.max(0, Math.min(1, y * 0.5 + 0.5));
      const mix = Math.pow(t, 0.7);
      colors[i * 3] = bottom[0] + (top[0] - bottom[0]) * mix;
      colors[i * 3 + 1] = bottom[1] + (top[1] - bottom[1]) * mix;
      colors[i * 3 + 2] = bottom[2] + (top[2] - bottom[2]) * mix;
    }
    geo.setAttribute('color', new T.BufferAttribute(colors, 3));
    const mat = new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false });
    return new T.Mesh(geo, mat);
  }

  buildWorldMesh(rawBoxes) {
    const T = this.T;
    // Map data arrives as compact tuples [cx,cy,cz,sx,sy,sz,color,kind].
    const boxes = rawBoxes.map((b) => Array.isArray(b)
      ? { x: b[0], y: b[1], z: b[2], hx: b[3] / 2, hy: b[4] / 2, hz: b[5] / 2, color: b[6], kind: b[7] }
      : b);

    const positions = [];
    const normals = [];
    const colors = [];
    const uvs = [];
    const indices = [];
    const tile = 0.5; // texture tiles per world unit

    for (const b of boxes) {
      const rgb = hexToRgb(b.color || '#888888');
      const variance = 0.94 + ((Math.abs(b.x * 13.7 + b.z * 7.3) % 1) * 0.12);
      const base = b.y - b.hy;

      for (const face of FACES) {
        // Skip faces buried inside another box.
        const px = b.x + face.n[0] * (b.hx + 0.03);
        const py = b.y + face.n[1] * (b.hy + 0.03);
        const pz = b.z + face.n[2] * (b.hz + 0.03);
        let buried = false;
        for (const o of boxes) {
          if (o === b) continue;
          if (Math.abs(px - o.x) <= o.hx && Math.abs(py - o.y) <= o.hy && Math.abs(pz - o.z) <= o.hz) {
            buried = true; break;
          }
        }
        if (buried) continue;

        const start = positions.length / 3;
        for (const c of face.c) {
          const vx = b.x + c[0] * b.hx;
          const vy = b.y + c[1] * b.hy;
          const vz = b.z + c[2] * b.hz;
          positions.push(vx, vy, vz);
          normals.push(face.n[0], face.n[1], face.n[2]);

          // Face shading + ground-contact darkening.
          const ao = 1 - Math.max(0, 1 - Math.max(0, vy - base) / 1.6) * 0.32 * (face.n[1] >= 0 ? 1 : 0.4);
          const lum = face.b * variance * ao;
          colors.push(rgb[0] * lum, rgb[1] * lum, rgb[2] * lum);

          let u = 0, v = 0;
          if (face.uv === 'xz') { u = vx; v = vz; }
          else if (face.uv === 'xy') { u = vx; v = vy; }
          else { u = vz; v = vy; }
          uvs.push(u * tile, v * tile);
        }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return new T.Mesh(geo, this.worldMaterial);
  }

  /* ------------------------------ soldiers ------------------------------ */

  makeSoldier(colors) {
    const T = this.T;
    const g = new T.Group();
    const mk = (w, h, d, color, x, y, z) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshLambertMaterial({ color: new T.Color(color) }));
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    const legL = mk(0.2, 0.78, 0.22, colors.dark, -0.14, 0.39, 0);
    const legR = mk(0.2, 0.78, 0.22, colors.dark, 0.14, 0.39, 0);
    mk(0.56, 0.66, 0.34, colors.body, 0, 1.11, 0);          // torso
    mk(0.6, 0.14, 0.36, colors.accent, 0, 1.42, 0);         // shoulders
    const head = mk(0.32, 0.3, 0.32, colors.skin, 0, 1.63, 0);
    mk(0.33, 0.1, 0.06, colors.visor, 0, 1.66, -0.17);      // visor
    mk(0.16, 0.5, 0.18, colors.body, -0.36, 1.14, -0.05);   // arms
    mk(0.16, 0.5, 0.18, colors.body, 0.36, 1.14, -0.05);
    mk(0.12, 0.14, 0.72, '#2b2b2b', 0.16, 1.15, -0.42);     // weapon
    g.userData = { legL, legR, head };
    return g;
  }

  teamColors(team, id) {
    if (team === 'a') return { body: '#2f5fbf', dark: '#1e3d7a', accent: '#4f8ae0', skin: '#c9a184', visor: '#9fe8ff' };
    if (team === 'b') return { body: '#b03a2e', dark: '#6f241c', accent: '#e06a4f', skin: '#c9a184', visor: '#ffd28f' };
    const hues = ['#c9a227', '#7d3c98', '#1e8449', '#b9770e', '#2e86c1', '#a04000', '#117a65', '#7b7d7d'];
    const h = hues[(id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
    return { body: h, dark: '#333', accent: '#ddd', skin: '#c9a184', visor: '#ffffff' };
  }

  updatePlayer(state, isLocal, dt) {
    let entry = this.players.get(state.id);
    if (!state.alive) {
      if (entry) { this.scene.remove(entry.group); this.players.delete(state.id); }
      return;
    }
    if (!entry) {
      const group = this.makeSoldier(this.teamColors(state.team, state.id));
      this.scene.add(group);
      entry = { group, phase: 0 };
      this.players.set(state.id, entry);
    }
    const g = entry.group;
    g.visible = !isLocal;
    g.position.set(state.x, state.y, state.z);
    g.rotation.y = state.yaw;
    const crouch = state.crouch ? 0.72 : 1;
    g.scale.set(1, crouch, 1);

    const speed = Math.hypot(state.vx || 0, state.vz || 0);
    entry.phase += dt * (2 + speed * 1.6);
    const swing = Math.sin(entry.phase * 4) * Math.min(0.6, speed * 0.1);
    if (g.userData.legL) {
      g.userData.legL.rotation.x = swing;
      g.userData.legR.rotation.x = -swing;
    }
  }

  removePlayer(id) {
    const entry = this.players.get(id);
    if (entry) { this.scene.remove(entry.group); this.players.delete(id); }
  }

  clearPlayers() {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
  }

  /* ------------------------------ viewmodel ------------------------------ */

  setViewModel(weaponDef, attachments = []) {
    const key = weaponDef ? weaponDef.id + '|' + attachments.join(',') : 'none';
    if (this.viewModelWeapon === key) return;
    this.viewModelWeapon = key;
    if (this.viewModel) { this.vmScene.remove(this.viewModel); this.viewModel = null; }
    if (!weaponDef) return;
    this.viewModel = this.buildViewModel(weaponDef, attachments);
    this.vmScene.add(this.viewModel);
  }

  buildViewModel(def, attachments) {
    const T = this.T;
    const g = new T.Group();
    const bodyMat = new T.MeshLambertMaterial({ color: new T.Color(def.color || '#333') });
    const accentMat = new T.MeshLambertMaterial({ color: new T.Color(def.accent || '#888') });
    const metal = new T.MeshLambertMaterial({ color: new T.Color('#22252a') });
    const box = (w, h, d, mat, x, y, z) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    const scale = def.cls === 'pistol' ? 0.62 : def.cls === 'smg' ? 0.8 : def.cls === 'lmg' ? 1.18 : def.cls === 'sniper' ? 1.1 : 1;
    const len = 0.62 * scale;

    box(0.075, 0.12, len, bodyMat, 0, 0, -len / 2);                       // receiver
    box(0.05, 0.05, len * 0.75, metal, 0, 0.035, -len * 0.9);            // barrel
    box(0.06, 0.19, 0.07, accentMat, 0, -0.15, -len * 0.35);             // magazine
    box(0.055, 0.13, 0.09, bodyMat, 0.0, -0.12, 0.06);                   // grip
    box(0.06, 0.09, 0.22, bodyMat, 0, -0.01, 0.2);                       // stock
    box(0.02, 0.035, 0.02, accentMat, 0, 0.09, -len * 0.55);             // front post

    if (def.cls === 'shotgun') {
      box(0.05, 0.05, len * 0.8, metal, 0, -0.045, -len * 0.85);         // second tube
      box(0.07, 0.09, 0.16, accentMat, 0, -0.05, -len * 0.45);           // pump
    }
    if (def.cls === 'lmg') {
      box(0.11, 0.16, 0.14, accentMat, 0, -0.16, -len * 0.3);            // box mag
      box(0.02, 0.02, 0.16, metal, -0.05, -0.1, -len * 0.95);            // bipod
      box(0.02, 0.02, 0.16, metal, 0.05, -0.1, -len * 0.95);
    }
    if (def.cls === 'sniper') {
      box(0.055, 0.055, 0.2, metal, 0, 0.1, -len * 0.35);                // scope tube
      box(0.07, 0.07, 0.03, metal, 0, 0.1, -len * 0.45);
    }
    if (def.cls === 'pistol') {
      box(0.05, 0.16, 0.08, bodyMat, 0, -0.13, -0.02);
    }
    // Hands
    box(0.08, 0.09, 0.16, new T.MeshLambertMaterial({ color: new T.Color('#4a4f3a') }), 0.02, -0.09, 0.05);
    box(0.075, 0.085, 0.13, new T.MeshLambertMaterial({ color: new T.Color('#4a4f3a') }), -0.01, -0.11, -len * 0.42);

    if (attachments.includes('acog')) box(0.05, 0.06, 0.14, metal, 0, 0.1, -len * 0.3);
    else if (attachments.includes('reddot')) box(0.04, 0.045, 0.06, metal, 0, 0.095, -len * 0.4);
    else if (attachments.includes('reflex')) box(0.05, 0.05, 0.05, metal, 0, 0.095, -len * 0.4);
    if (attachments.includes('silencer')) box(0.045, 0.045, 0.2, metal, 0, 0.035, -len * 1.15);
    if (attachments.includes('grip')) box(0.03, 0.1, 0.04, accentMat, 0, -0.11, -len * 0.62);
    if (attachments.includes('extmag')) box(0.06, 0.12, 0.07, accentMat, 0, -0.26, -len * 0.35);

    g.position.set(0.2, -0.19, -0.42);
    g.userData.basePos = g.position.clone();
    return g;
  }

  updateViewModel(state, dt) {
    if (!this.viewModel) return;
    const ads = state.ads || 0;
    const bob = state.bob || 0;
    const sway = state.sway || { x: 0, y: 0 };
    const recoil = state.recoil || 0;
    const reload = state.reload || 0;   // 0..1 progress, 0 when idle
    const sprint = state.sprint ? 1 : 0;

    const targetX = 0.2 * (1 - ads) + sway.x * 0.02;
    const targetY = -0.19 * (1 - ads) - 0.11 * ads + Math.sin(bob * 2) * 0.012 + sway.y * 0.02 - reload * 0.22 - sprint * 0.05;
    const targetZ = -0.42 + ads * 0.16 + recoil * 0.07 + reload * 0.06;

    this.viewModel.position.x += (targetX - this.viewModel.position.x) * Math.min(1, dt * 14);
    this.viewModel.position.y += (targetY - this.viewModel.position.y) * Math.min(1, dt * 14);
    this.viewModel.position.z += (targetZ - this.viewModel.position.z) * Math.min(1, dt * 18);

    this.viewModel.rotation.x = -reload * 1.1 + sprint * 0.35 - recoil * 0.12;
    this.viewModel.rotation.y = -ads * 0.32 + sprint * 0.5 + Math.cos(bob) * 0.008;
    this.viewModel.rotation.z = -reload * 0.5 + sprint * 0.4;
  }

  setMuzzleFlash(on) {
    if (!this.viewModel) return;
    if (on && !this.flash) {
      const T = this.T;
      this.flash = new T.Mesh(
        new T.SphereGeometry(0.07, 6, 6),
        new T.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9 })
      );
      this.vmScene.add(this.flash);
    }
    if (this.flash) {
      this.flash.visible = on;
      if (on) {
        this.flash.position.set(0.2, -0.15, -1.1);
        this.flash.scale.setScalar(0.8 + Math.random() * 0.7);
      }
    }
  }

  /* ------------------------------ effects ------------------------------ */

  initEffects() {
    const T = this.T;
    // Tracers
    this.tracerMax = 200;
    this.tracerGeo = new T.BufferGeometry();
    this.tracerPos = new Float32Array(this.tracerMax * 6);
    this.tracerCol = new Float32Array(this.tracerMax * 6);
    this.tracerGeo.setAttribute('position', new T.BufferAttribute(this.tracerPos, 3));
    this.tracerGeo.setAttribute('color', new T.BufferAttribute(this.tracerCol, 3));
    this.tracerMesh = new T.LineSegments(this.tracerGeo,
      new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }));
    this.tracerMesh.frustumCulled = false;
    this.scene.add(this.tracerMesh);

    // Particles
    this.particleMax = 600;
    this.particleGeo = new T.BufferGeometry();
    this.particlePos = new Float32Array(this.particleMax * 3);
    this.particleCol = new Float32Array(this.particleMax * 3);
    this.particleGeo.setAttribute('position', new T.BufferAttribute(this.particlePos, 3));
    this.particleGeo.setAttribute('color', new T.BufferAttribute(this.particleCol, 3));
    this.particleMesh = new T.Points(this.particleGeo,
      new T.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false }));
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    for (let i = 0; i < this.particleMax; i++) this.particles.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, max: 1 });

    // Explosion flashes
    this.flashPool = [];
    for (let i = 0; i < 6; i++) {
      const m = new T.Mesh(
        new T.SphereGeometry(1, 10, 8),
        new T.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.9, depthWrite: false })
      );
      m.visible = false;
      this.scene.add(m);
      this.flashPool.push({ mesh: m, life: 0, max: 1, radius: 1 });
    }

    // Smoke
    this.smokePool = [];
    for (let i = 0; i < 14; i++) {
      const m = new T.Mesh(
        new T.SphereGeometry(1, 8, 6),
        new T.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.0, depthWrite: false })
      );
      m.visible = false;
      this.scene.add(m);
      this.smokePool.push({ mesh: m, until: 0, radius: 1 });
    }
  }

  addTracer(from, to) {
    if (this.tracers.length >= this.tracerMax) this.tracers.shift();
    this.tracers.push({ ax: from.x, ay: from.y, az: from.z, bx: to.x, by: to.y, bz: to.z, life: 0.07, max: 0.07 });
  }

  addImpact(point, normal) {
    for (let i = 0; i < 7; i++) this.spawnParticle(point, 0.35 + Math.random() * 0.4, [0.85, 0.78, 0.6], 4.5);
    if (normal) this.spawnParticle({ x: point.x + normal.x * 0.05, y: point.y + normal.y * 0.05, z: point.z + normal.z * 0.05 }, 0.12, [1, 0.95, 0.7], 0.2);
  }

  addBlood(point) {
    for (let i = 0; i < 8; i++) this.spawnParticle(point, 0.4 + Math.random() * 0.3, [0.6, 0.05, 0.05], 3.5);
  }

  addExplosion(pos, radius) {
    for (let i = 0; i < 26; i++) this.spawnParticle(pos, 0.7 + Math.random() * 0.7, [1, 0.6 + Math.random() * 0.3, 0.2], 9);
    const slot = this.flashPool.find((f) => f.life <= 0);
    if (slot) {
      slot.life = 0.35;
      slot.max = 0.35;
      slot.radius = Math.max(2, radius * 0.6);
      slot.mesh.visible = true;
      slot.mesh.position.set(pos.x, pos.y, pos.z);
    }
  }

  spawnParticle(point, life, rgb, speed) {
    const p = this.particles.find((q) => q.life <= 0);
    if (!p) return;
    p.life = life;
    p.max = life;
    p.x = point.x; p.y = point.y; p.z = point.z;
    p.vx = (Math.random() - 0.5) * speed;
    p.vy = Math.random() * speed * 0.8;
    p.vz = (Math.random() - 0.5) * speed;
    p.r = rgb[0]; p.g = rgb[1]; p.b = rgb[2];
  }

  syncEntities(entities, now) {
    const seen = new Set();
    for (const e of entities) {
      seen.add(e.id);
      let mesh = this.entityMeshes.get(e.id);
      const kind = e.kind === 'grenade' ? 'grenade' : e.kind;
      if (!mesh || mesh.userData.kind !== kind) {
        if (mesh) { this.scene.remove(mesh); mesh.geometry?.dispose?.(); }
        mesh = this.makeEntityMesh(kind, e);
        mesh.userData.kind = kind;
        this.entityMeshes.set(e.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(e.x, e.y, e.z);
      if (kind === 'smoke') {
        const radius = e.radius || 5;
        mesh.scale.setScalar(radius);
        mesh.material.opacity = 0.42;
      }
      if (kind === 'heli') mesh.rotation.y = now * 3;
    }
    for (const [id, mesh] of [...this.entityMeshes]) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry?.dispose?.();
        this.entityMeshes.delete(id);
      }
    }
  }

  makeEntityMesh(kind, e) {
    const T = this.T;
    const mat = (color, opts = {}) => new T.MeshLambertMaterial({ color: new T.Color(color), ...opts });
    switch (kind) {
      case 'grenade': {
        const m = new T.Mesh(new T.SphereGeometry(0.11, 6, 5), mat('#3a4a35'));
        return m;
      }
      case 'crate': {
        const g = new T.Group();
        const box = new T.Mesh(new T.BoxGeometry(0.9, 0.8, 0.9), mat('#5d6b3f'));
        g.add(box);
        const lid = new T.Mesh(new T.BoxGeometry(0.95, 0.12, 0.95), mat('#8a9a5b'));
        lid.position.y = 0.44;
        g.add(lid);
        return g;
      }
      case 'sentry': {
        const g = new T.Group();
        g.add(new T.Mesh(new T.BoxGeometry(0.8, 0.5, 0.8), mat('#3f4448')));
        const head = new T.Mesh(new T.BoxGeometry(0.5, 0.4, 0.5), mat('#5c666e'));
        head.position.y = 0.5;
        g.add(head);
        const barrel = new T.Mesh(new T.BoxGeometry(0.12, 0.12, 0.9), mat('#22262a'));
        barrel.position.set(0, 0.5, -0.6);
        g.add(barrel);
        return g;
      }
      case 'heli': {
        const g = new T.Group();
        g.add(new T.Mesh(new T.BoxGeometry(1.8, 1.2, 4), mat('#39413a')));
        const tail = new T.Mesh(new T.BoxGeometry(0.4, 0.4, 3), mat('#39413a'));
        tail.position.z = 3;
        g.add(tail);
        const rotor = new T.Mesh(new T.BoxGeometry(7, 0.1, 0.4), mat('#22262a'));
        rotor.position.y = 0.9;
        g.add(rotor);
        g.userData.rotor = rotor;
        return g;
      }
      case 'missile': {
        const m = new T.Mesh(new T.BoxGeometry(0.4, 2.2, 0.4), mat('#7a7f86'));
        return m;
      }
      case 'smoke': {
        return new T.Mesh(new T.SphereGeometry(1, 8, 6),
          new T.MeshBasicMaterial({ color: 0xb9bec4, transparent: true, opacity: 0, depthWrite: false }));
      }
      default:
        return new T.Mesh(new T.BoxGeometry(0.4, 0.4, 0.4), mat('#888'));
    }
  }

  /* ------------------------------ frame ------------------------------ */

  update(dt, view) {
    this.time += dt;

    // Camera
    this.camera.position.set(view.x, view.y, view.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = view.yaw;
    this.camera.rotation.x = view.pitch;
    this.camera.rotation.z = view.roll || 0;
    const targetFov = view.fov || 78;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 16);
      this.camera.updateProjectionMatrix();
    }

    // Tracers
    let ti = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) { this.tracers.splice(i, 1); continue; }
      const f = tr.life / tr.max;
      this.tracerPos[ti * 6] = tr.ax; this.tracerPos[ti * 6 + 1] = tr.ay; this.tracerPos[ti * 6 + 2] = tr.az;
      this.tracerPos[ti * 6 + 3] = tr.bx; this.tracerPos[ti * 6 + 4] = tr.by; this.tracerPos[ti * 6 + 5] = tr.bz;
      this.tracerCol[ti * 6] = 1 * f; this.tracerCol[ti * 6 + 1] = 0.85 * f; this.tracerCol[ti * 6 + 2] = 0.4 * f;
      this.tracerCol[ti * 6 + 3] = 1 * f; this.tracerCol[ti * 6 + 4] = 0.6 * f; this.tracerCol[ti * 6 + 5] = 0.2 * f;
      ti++;
    }
    for (let i = ti; i < this.tracerMax; i++) {
      this.tracerPos[i * 6] = 0; this.tracerPos[i * 6 + 1] = -999; this.tracerPos[i * 6 + 2] = 0;
      this.tracerPos[i * 6 + 3] = 0; this.tracerPos[i * 6 + 4] = -999; this.tracerPos[i * 6 + 5] = 0;
    }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;

    // Particles
    let pi = 0;
    for (const p of this.particles) {
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 9 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const f = Math.max(0, p.life / p.max);
        this.particlePos[pi * 3] = p.x; this.particlePos[pi * 3 + 1] = p.y; this.particlePos[pi * 3 + 2] = p.z;
        this.particleCol[pi * 3] = p.r * f; this.particleCol[pi * 3 + 1] = p.g * f; this.particleCol[pi * 3 + 2] = p.b * f;
        pi++;
        if (pi >= this.particleMax) break;
      }
    }
    for (let i = pi; i < this.particleMax; i++) {
      this.particlePos[i * 3 + 1] = -999;
      this.particleCol[i * 3] = 0; this.particleCol[i * 3 + 1] = 0; this.particleCol[i * 3 + 2] = 0;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;

    // Explosion flashes
    for (const f of this.flashPool) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.mesh.scale.setScalar(f.radius * (1.1 - k * 0.6));
      f.mesh.material.opacity = k * 0.85;
      if (f.life <= 0) f.mesh.visible = false;
    }

    // Smoke lifetime is driven by the server (entity list), nothing to age here.
  }

  render(showViewModel) {
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    if (showViewModel && this.viewModel) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
      this.renderer.autoClear = true;
    }
  }

  /** Project a world position to CSS pixel coords (for HUD overlays). */
  project(world) {
    const T = this.T;
    const v = new T.Vector3(world.x, world.y, world.z).project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      behind: v.z > 1
    };
  }
}
