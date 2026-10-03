/**
 * Minimal vector / math helpers shared by the browser client and the Node server.
 * No dependencies, no Three.js — the server must be able to run this headless.
 */

export const DEG = Math.PI / 180;

export function v3(x = 0, y = 0, z = 0) { return { x, y, z }; }
export function clone(a) { return { x: a.x, y: a.y, z: a.z }; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function lenSq(a) { return a.x * a.x + a.y * a.y + a.z * a.z; }
export function len(a) { return Math.sqrt(lenSq(a)); }
export function dist(a, b) { return len(sub(a, b)); }
export function norm(a) {
  const l = len(a);
  return l > 1e-8 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}
export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function lerpV(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }; }

/** Wrap an angle difference into [-PI, PI]. */
export function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Yaw/pitch (radians) -> unit direction vector. Matches the client camera convention. */
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function anglesFromDir(d) {
  const cp = Math.hypot(d.x, d.z);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, cp) };
}

/** Deterministic PRNG (mulberry32) so bots/replays behave the same for a given seed. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = rng(seed);
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    chance: (p) => next() < p
  };
}

/* ------------------------------------------------------------------ */
/* Axis-aligned boxes                                                  */
/* ------------------------------------------------------------------ */

/** Box stored as {x,y,z} centre + {hx,hy,hz} half extents. */
export function boxFromCentreSize(cx, cy, cz, sx, sy, sz) {
  return { x: cx, y: cy, z: cz, hx: sx / 2, hy: sy / 2, hz: sz / 2 };
}

export function boxMinMax(b) {
  return {
    min: { x: b.x - b.hx, y: b.y - b.hy, z: b.z - b.hz },
    max: { x: b.x + b.hx, y: b.y + b.hy, z: b.z + b.hz }
  };
}

export function boxOverlaps(a, b) {
  return Math.abs(a.x - b.x) <= a.hx + b.hx &&
         Math.abs(a.y - b.y) <= a.hy + b.hy &&
         Math.abs(a.z - b.z) <= a.hz + b.hz;
}

export function pointInBox(p, b) {
  return Math.abs(p.x - b.x) <= b.hx && Math.abs(p.y - b.y) <= b.hy && Math.abs(p.z - b.z) <= b.hz;
}

/**
 * Ray vs AABB (slab method).
 * @returns {number|null} entry distance in [0, maxDist], or null.
 */
export function rayBox(origin, dir, b, maxDist = Infinity) {
  const min = { x: b.x - b.hx, y: b.y - b.hy, z: b.z - b.hz };
  const max = { x: b.x + b.hx, y: b.y + b.hy, z: b.z + b.hz };
  let tmin = 0, tmax = maxDist;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis], d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < min[axis] || o > max[axis]) return null;
    } else {
      let t1 = (min[axis] - o) / d;
      let t2 = (max[axis] - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Outward-facing normal of the box face hit at distance t. */
export function rayBoxNormal(origin, dir, b, t) {
  const p = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
  const eps = 1e-3;
  if (Math.abs(p.x - (b.x + b.hx)) < eps) return { x: 1, y: 0, z: 0 };
  if (Math.abs(p.x - (b.x - b.hx)) < eps) return { x: -1, y: 0, z: 0 };
  if (Math.abs(p.y - (b.y + b.hy)) < eps) return { x: 0, y: 1, z: 0 };
  if (Math.abs(p.y - (b.y - b.hy)) < eps) return { x: 0, y: -1, z: 0 };
  if (Math.abs(p.z - (b.z + b.hz)) < eps) return { x: 0, y: 0, z: 1 };
  return { x: 0, y: 0, z: -1 };
}

/** Sphere vs AABB — used for grenade/explosion overlap and zone checks. */
export function sphereBoxOverlap(c, r, b) {
  const dx = Math.max(Math.abs(c.x - b.x) - b.hx, 0);
  const dy = Math.max(Math.abs(c.y - b.y) - b.hy, 0);
  const dz = Math.max(Math.abs(c.z - b.z) - b.hz, 0);
  return dx * dx + dy * dy + dz * dz <= r * r;
}
