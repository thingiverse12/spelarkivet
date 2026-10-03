// Bygger Sörbäcken: originalscenografi i lowpoly (egen design).
import * as THREE from '../vendor/three.module.min.js';

const M = (c, r) => new THREE.MeshLambertMaterial({ color: c });
function box(w, h, d, c, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

export const WORLD_HALF = 52;

/** mark med canvas-textur (jord, gräs, snöfläckar) */
export function buildGround(season) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const cx = cv.getContext('2d');
  const base = season === 'winter' ? '#cfd8e2' : season === 'dusk' ? '#5c5a44' : '#6a6a4c';
  cx.fillStyle = base; cx.fillRect(0, 0, 256, 256);
  const patches = season === 'winter' ? ['#e6ecf3', '#b8c4d2', '#9aa8b8'] : ['#77765a', '#54543e', '#8a8a66'];
  for (let i = 0; i < 260; i++) {
    cx.fillStyle = patches[(Math.random() * patches.length) | 0];
    cx.globalAlpha = 0.25 + Math.random() * 0.4;
    const r = 4 + Math.random() * 26;
    cx.beginPath();
    cx.ellipse(Math.random() * 256, Math.random() * 256, r, r * (0.5 + Math.random() * 0.7), Math.random() * 3, 0, 7);
    cx.fill();
  }
  cx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_HALF * 2 + 40, WORLD_HALF * 2 + 40),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  return g;
}

export function spruce(h = 6) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, h * 0.3, 6), M(0x4a3524));
  trunk.position.y = h * 0.15; trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.28 - i * h * 0.06, h * 0.42, 7), M(0x274d2b + i * 0x010201));
    c.position.y = h * 0.34 + i * h * 0.22;
    c.castShadow = true;
    g.add(c);
  }
  return g;
}

export function birch(h = 5) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, h * 0.8, 6), M(0xd8d4c8));
  trunk.position.y = h * 0.4; trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.4, 7, 6), M(0x6f8f3a));
    b.position.set((Math.random() - 0.5) * 1.2, h * 0.72 + Math.random() * h * 0.25, (Math.random() - 0.5) * 1.2);
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

/** falurött norrlandstorp */
export function house(w = 7, d = 6, h = 3.4, color = 0x8a2f26) {
  const g = new THREE.Group();
  g.add(box(w, h, d, color, 0, h / 2, 0));
  // tak
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.74, h * 0.62, 4), M(0x2e2e34));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  roof.position.y = h + h * 0.3;
  roof.castShadow = true;
  g.add(roof);
  // fönster + dörr ( vita knutar )
  const win = (x, z, ry) => {
    const f = box(0.9, 1.0, 0.12, 0xf2f2ea, x, h * 0.55, z);
    f.rotation.y = ry;
    const fr = box(1.06, 1.16, 0.08, 0xfafaf2, x, h * 0.55, z - 0.05 * Math.sign(z || 1));
    fr.rotation.y = ry;
    g.add(fr, f);
  };
  win(w * 0.25, d / 2 + 0.02, 0);
  win(-w * 0.25, d / 2 + 0.02, 0);
  const door = box(1.0, 2.0, 0.14, 0xe8e4d8, 0, 1.0, d / 2 + 0.03);
  g.add(door);
  // knutar
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    g.add(box(0.22, h, 0.22, 0xf4f0e6, sx * w / 2, h / 2, sz * d / 2));
  });
  return g;
}

/** husvagnen */
export function caravan() {
  const g = new THREE.Group();
  const body = box(4.6, 1.9, 2.1, 0xd8d4c4, 0, 1.35, 0);
  g.add(body);
  const top = box(4.6, 0.3, 2.1, 0xb8b4a4, 0, 2.42, 0);
  g.add(top);
  const stripe = box(4.62, 0.24, 2.12, 0x8a6a3a, 0, 1.05, 0);
  g.add(stripe);
  [-1.4, 1.4].forEach(x => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), M(0x1c1c1c));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.42, 1.0);
    w.castShadow = true;
    g.add(w);
    const w2 = w.clone(); w2.position.z = -1.0; g.add(w2);
  });
  const win = box(1.1, 0.7, 0.1, 0x2e3a44, -1.0, 1.7, 1.06);
  g.add(win);
  const win2 = win.clone(); win2.position.x = 0.8; g.add(win2);
  const door = box(0.8, 1.5, 0.1, 0xc4c0b0, 1.8, 1.2, 1.06);
  g.add(door);
  return g;
}

/** blå raggar-Volvo (originaal lowpoly, ej modellbilden) */
export function raggarVolvo() {
  const g = new THREE.Group();
  const body = box(4.4, 0.7, 1.9, 0x2f6fa8, 0, 0.75, 0);
  g.add(body);
  const cabin = box(2.3, 0.65, 1.75, 0x3579b4, -0.2, 1.4, 0);
  g.add(cabin);
  const glass = box(2.1, 0.5, 1.78, 0x18242e, -0.2, 1.42, 0);
  g.add(glass);
  [0.62, -0.62].forEach(z => {
    [-1.5, 1.5].forEach(x => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), M(0x141414));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.42, z);
      w.castShadow = true;
      g.add(w);
    });
    const bump = box(4.5, 0.18, 0.12, 0xc8c8cc, 0, 0.6, z * 1.55);
    g.add(bump);
  });
  const fb = box(0.16, 0.2, 1.95, 0xc8c8cc, 2.24, 0.6, 0);
  const rb = fb.clone(); rb.position.x = -2.24;
  g.add(fb, rb);
  const hl = box(0.1, 0.22, 0.4, 0xf4e8b0, 2.21, 0.95, 0.62);
  const hl2 = hl.clone(); hl2.position.z = -0.62;
  g.add(hl, hl2);
  return g;
}

/** utedass med hjärta */
export function outhouse() {
  const g = new THREE.Group();
  g.add(box(1.3, 2.1, 1.3, 0x7a2a20, 0, 1.05, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.6, 4), M(0x2a2a30));
  roof.rotation.y = Math.PI / 4; roof.position.y = 2.4; roof.castShadow = true;
  g.add(roof);
  const door = box(0.8, 1.7, 0.1, 0x8a3428, 0, 0.9, 0.68);
  g.add(door);
  const heart = new THREE.Mesh(new THREE.CircleGeometry(0.14, 5), M(0x140c0a));
  heart.position.set(0, 1.45, 0.74);
  g.add(heart);
  return g;
}

export function woodpile() {
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 6 - r; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 7), M(0x6a4a2c));
      log.rotation.x = Math.PI / 2;
      log.position.set(-0.75 + i * 0.3 + r * 0.15, 0.15 + r * 0.26, 0);
      log.castShadow = true;
      g.add(log);
    }
  }
  return g;
}

export function clothesline() {
  const g = new THREE.Group();
  [-3, 3].forEach(x => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.0, 6), M(0x7a6a50));
    p.position.set(x, 1.0, 0); p.castShadow = true;
    g.add(p);
  });
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 6, 4), M(0xd8d8d0));
  line.rotation.z = Math.PI / 2; line.position.y = 1.9;
  g.add(line);
  const cols = [0xd84a4a, 0x4a7ad8, 0xe8e8e0, 0x4aa85a, 0xe8c84a];
  cols.forEach((c, i) => {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));
    cloth.position.set(-2.2 + i * 1.1, 1.5, 0);
    cloth.rotation.y = (Math.random() - 0.5) * 0.5;
    g.add(cloth);
  });
  return g;
}

/** glödande gulkrona */
export function coin() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.09, 18),
    new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.55, roughness: 0.3, emissive: 0x8a6410, emissiveIntensity: 0.55 })
  );
  m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  g.add(m);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 20), new THREE.MeshBasicMaterial({ color: 0xffe89a, transparent: true, opacity: 0.5 }));
  g.add(ring);
  g.userData.spin = m;
  return g;
}

export function snusCan() {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0xe8e4da, metalness: 0.4, roughness: 0.4 }));
  can.position.y = 0.06; can.castShadow = true;
  g.add(can);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 16), M(0x2a4a8a));
  lid.position.y = 0.13;
  g.add(lid);
  return g;
}

/** älgen */
export function moose() {
  const g = new THREE.Group();
  const body = box(1.7, 0.9, 0.8, 0x4a3626, 0, 1.5, 0);
  g.add(body);
  const hump = box(0.7, 0.4, 0.7, 0x3e2d1f, 0.55, 2.05, 0);
  g.add(hump);
  [[0.6, 0.35], [0.6, -0.35], [-0.6, 0.35], [-0.6, -0.35]].forEach(([x, z]) => {
    const leg = box(0.18, 1.1, 0.18, 0x3e2d1f, x, 0.55, z);
    g.add(leg);
  });
  const neck = box(0.35, 0.8, 0.35, 0x4a3626, 0.9, 2.2, 0);
  neck.rotation.z = -0.4;
  g.add(neck);
  const head = new THREE.Group();
  head.position.set(1.15, 2.6, 0);
  const sk = box(0.55, 0.35, 0.3, 0x4a3626, 0, 0, 0);
  const muzzle = box(0.4, 0.25, 0.24, 0x5a4430, 0.4, -0.06, 0);
  head.add(sk, muzzle);
  // horn
  [-1, 1].forEach(s => {
    const ant = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 5), M(0x8a7454));
    ant.position.set(-0.05, 0.45, s * 0.3);
    ant.rotation.x = s * 0.5;
    head.add(ant);
    const palm = box(0.3, 0.24, 0.06, 0x8a7454, -0.05, 0.72, s * 0.44);
    head.add(palm);
  });
  g.add(head);
  g.userData.head = head;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** lyktstolpe */
export function lampPost() {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), M(0x3a3a42));
  p.position.y = 2.1; p.castShadow = true;
  g.add(p);
  const arm = box(0.7, 0.08, 0.08, 0x3a3a42, 0.35, 4.15, 0);
  g.add(arm);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  bulb.position.set(0.68, 4.05, 0);
  g.add(bulb);
  return g;
}
