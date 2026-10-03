// Originala lowpoly-karaktärer byggda i kod (Three.js).
// Inspirerade av norrlandsmiljö och arbetskläder – helt egen design, inga kopior.
import * as THREE from '../vendor/three.module.min.js';

function mat(color, rough = 0.85) {
  return new THREE.MeshLambertMaterial({ color });
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function sph(r, color, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * Bygger en humanoid i "bondhulk"-stil.
 * cfg: { skin, pants, shoes, shirt, jacket?, jacketPatch?, vest?, cap, capTrim, beard?, hair?, build, briefcase? }
 * Returnerar { group, parts } där parts används för gånganimation.
 */
export function buildHuman(cfg) {
  const g = new THREE.Group();
  const s = cfg.build || 1;
  const parts = {};

  // ── BEN ──
  const legH = 0.78 * s;
  const mkLeg = (sx) => {
    const hip = new THREE.Group();
    hip.position.set(0.16 * s * sx, legH, 0);
    const leg = box(0.22 * s, legH, 0.24 * s, cfg.pants, 0, -legH / 2, 0);
    const shoe = box(0.24 * s, 0.14 * s, 0.36 * s, cfg.shoes, 0, -legH + 0.07 * s, 0.06 * s);
    hip.add(leg, shoe);
    g.add(hip);
    return hip;
  };
  parts.legL = mkLeg(1);
  parts.legR = mkLeg(-1);

  // ── ÖVERKROPP ──
  const torso = new THREE.Group();
  torso.position.y = legH;
  const torsoH = 0.72 * s;
  const body = box(0.56 * s, torsoH, 0.34 * s, cfg.shirt, 0, torsoH / 2, 0);
  torso.add(body);
  if (cfg.jacket !== undefined) {
    // öppen jacka: två frampaneler + rygg
    const jl = box(0.14 * s, torsoH * 0.96, 0.36 * s, cfg.jacket, -0.24 * s, torsoH / 2, 0);
    const jr = box(0.14 * s, torsoH * 0.96, 0.36 * s, cfg.jacket, 0.24 * s, torsoH / 2, 0);
    const jb = box(0.58 * s, torsoH * 0.96, 0.1 * s, cfg.jacket, 0, torsoH / 2, -0.16 * s);
    torso.add(jl, jr, jb);
    if (cfg.jacketPatch) {
      const pl = box(0.15 * s, 0.18 * s, 0.37 * s, cfg.jacketPatch, -0.24 * s, torsoH * 0.82, 0);
      const pr = box(0.15 * s, 0.18 * s, 0.37 * s, cfg.jacketPatch, 0.24 * s, torsoH * 0.82, 0);
      torso.add(pl, pr);
    }
  }
  if (cfg.vest !== undefined) {
    const v = box(0.6 * s, torsoH * 0.8, 0.38 * s, cfg.vest, 0, torsoH * 0.55, 0);
    torso.add(v);
    const stripe = box(0.62 * s, 0.07 * s, 0.4 * s, 0xf3f34a, 0, torsoH * 0.62, 0);
    torso.add(stripe);
  }
  if (cfg.tie !== undefined) {
    const t = box(0.09 * s, torsoH * 0.6, 0.05 * s, cfg.tie, 0, torsoH * 0.55, 0.19 * s);
    torso.add(t);
  }
  parts.torso = torso;
  g.add(torso);

  // ── ARMAR ──
  const armH = 0.62 * s;
  const mkArm = (sx) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.36 * s * sx, legH + torsoH * 0.92, 0);
    const sleeve = box(0.16 * s, armH * 0.62, 0.18 * s, cfg.jacket !== undefined ? cfg.jacket : (cfg.vest !== undefined ? cfg.shirt : cfg.shirt), 0, -armH * 0.31, 0);
    const forearm = box(0.14 * s, armH * 0.42, 0.16 * s, cfg.skin, 0, -armH * 0.78, 0);
    const hand = sph(0.09 * s, cfg.skin, 0, -armH, 0, 8);
    shoulder.add(sleeve, forearm, hand);
    torso.add(shoulder);
    return shoulder;
  };
  parts.armL = mkArm(1);
  parts.armR = mkArm(-1);

  // ── HUVUD ──
  const head = new THREE.Group();
  head.position.y = legH + torsoH + 0.02 * s;
  const skull = sph(0.26 * s, cfg.skin, 0, 0.24 * s, 0, 14);
  skull.scale.set(1, 1.12, 1);
  head.add(skull);
  // näsa
  head.add(sph(0.06 * s, cfg.skin, 0, 0.22 * s, 0.24 * s, 8));
  // ögon
  const eyeGeo = new THREE.SphereGeometry(0.035 * s, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(0.1 * s, 0.3 * s, 0.22 * s);
  const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(-0.1 * s, 0.3 * s, 0.22 * s);
  head.add(eL, eR);
  // skägg / mustasch
  if (cfg.beard) {
    const b = sph(0.24 * s, cfg.beard, 0, 0.13 * s, 0.06 * s, 12);
    b.scale.set(1, 0.85, 0.95);
    head.add(b);
    const m = box(0.2 * s, 0.05 * s, 0.08 * s, cfg.beard, 0, 0.19 * s, 0.23 * s);
    head.add(m);
  }
  // hår bak
  if (cfg.hair) {
    const h = sph(0.26 * s, cfg.hair, 0, 0.3 * s, -0.06 * s, 12);
    h.scale.set(1, 0.9, 0.9);
    head.add(h);
  }
  // keps
  if (cfg.cap !== undefined) {
    const dome = sph(0.27 * s, cfg.cap, 0, 0.36 * s, 0, 14, );
    dome.scale.set(1, 0.62, 1);
    head.add(dome);
    const brim = box(0.34 * s, 0.035 * s, 0.24 * s, cfg.capTrim !== undefined ? cfg.capTrim : cfg.cap, 0, 0.32 * s, 0.28 * s);
    head.add(brim);
    if (cfg.capTrim !== undefined) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.26 * s, 0.02 * s, 6, 16), mat(cfg.capTrim));
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.3 * s;
      head.add(band);
    }
  }
  parts.head = head;
  g.add(head);

  // ── PORTFÖLJ (fogden) ──
  if (cfg.briefcase) {
    const bc = box(0.34 * s, 0.26 * s, 0.1 * s, 0x3a2a18, 0, -armH - 0.1 * s, 0.06 * s);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06 * s, 0.015 * s, 6, 10), mat(0x241a10));
    handle.position.set(0, -armH - 0.02 * s, 0.06 * s);
    parts.armR.add(bc, handle);
    parts.briefcase = bc;
  }

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, parts, height: legH + torsoH + 0.5 * s };
}

export const CHAR_PRESETS = {
  leif: {
    name: 'LEIF',
    skin: 0xe3ac82, pants: 0x333a46, shoes: 0x2a2018,
    shirt: 0x7a4a26, jacket: 0x5c6b40, jacketPatch: 0xb08040,
    cap: 0x2e6b4f, capTrim: 0xe8862a,
    beard: 0x96602c, build: 1.1,
    speed: 5.4, sprint: 8.0, jump: 7.4, stamina: 100,
  },
  billy: {
    name: 'BILLY',
    skin: 0xecbf98, pants: 0x5d718c, shoes: 0x24242c,
    shirt: 0x8b93a0, vest: 0xff7a1a,
    cap: 0xb03434, capTrim: 0x26262e,
    build: 0.98,
    speed: 6.1, sprint: 9.0, jump: 8.4, stamina: 90,
  },
  fogde: {
    name: 'KRONOFOGDEN',
    skin: 0xd8a87e, pants: 0x3c3c46, shoes: 0x1c1c22,
    shirt: 0xe8e8ee, jacket: 0x46465a, tie: 0x8a1f1f,
    hair: 0x2e2a26, build: 1.06, briefcase: true,
  },
};

/** Gång-/springanimation. phase i radianer, intensity 0..1 */
export function animateHuman(parts, phase, intensity, opts = {}) {
  const sw = Math.sin(phase) * 0.7 * intensity;
  parts.legL.rotation.x = sw;
  parts.legR.rotation.x = -sw;
  parts.armL.rotation.x = -sw * 0.85;
  parts.armR.rotation.x = sw * 0.85;
  parts.armL.rotation.z = 0.08 + intensity * 0.1;
  parts.armR.rotation.z = -0.08 - intensity * 0.1;
  const bob = Math.abs(Math.cos(phase)) * 0.06 * intensity;
  parts.torso.position.y = (parts.torso.userData.baseY ??= parts.torso.position.y) + bob * 0.4;
  parts.torso.rotation.x = intensity * 0.14 + (opts.lean || 0);
  parts.head.rotation.y = opts.lookY || 0;
  if (!intensity) {
    // andas
    const t = opts.time || 0;
    parts.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.015;
    parts.armL.rotation.x *= 0.9;
    parts.armR.rotation.x *= 0.9;
  }
}
