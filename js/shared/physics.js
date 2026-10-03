/**
 * Shared physics: an AABB world, grid broadphase, player movement with step-up
 * and world raycasting. Used by the authoritative Node server AND by the client
 * for prediction + the offline bot fallback, so behaviour is identical everywhere.
 */
import { rayBox, rayBoxNormal, boxOverlaps, boxFromCentreSize, clamp } from './math3.js';

export const GRAVITY = 24;
export const TERMINAL_VEL = -58;
export const PLAYER_HALF = 0.34;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.25;
export const EYE_HEIGHT = 1.62;
export const EYE_HEIGHT_CROUCH = 1.06;
export const STEP_HEIGHT = 0.55;
/** Vertical slack used by horizontal collision tests so resting contact does
 *  not read as an intersection. */
export const REST_EPSILON = 0.02;

export function buildWorld(rawBoxes) {
  const boxes = rawBoxes.map((b) => {
    // Accept either {x,y,z,hx,hy,hz,...} or [cx,cy,cz,sx,sy,sz] style tuples.
    if (Array.isArray(b)) {
      const box = boxFromCentreSize(b[0], b[1], b[2], b[3], b[4], b[5]);
      box.color = b[6] ?? '#8a8f98';
      box.kind = b[7] || 'solid';
      return box;
    }
    return b;
  });

  const cell = 4;
  const grid = new Map();
  const key = (cx, cz) => cx + ',' + cz;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const c0x = Math.floor((b.x - b.hx) / cell), c1x = Math.floor((b.x + b.hx) / cell);
    const c0z = Math.floor((b.z - b.hz) / cell), c1z = Math.floor((b.z + b.hz) / cell);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const k = key(cx, cz);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(i);
      }
    }
  }

  return { boxes, grid, cell, key };
}

function candidateIndices(world, box) {
  const seen = new Set();
  const c0x = Math.floor((box.x - box.hx) / world.cell), c1x = Math.floor((box.x + box.hx) / world.cell);
  const c0z = Math.floor((box.z - box.hz) / world.cell), c1z = Math.floor((box.z + box.hz) / world.cell);
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      const arr = world.grid.get(world.key(cx, cz));
      if (!arr) continue;
      for (const i of arr) seen.add(i);
    }
  }
  return seen;
}

/** AABB of an entity standing with its feet at e.pos. */
export function entityBox(e) {
  const h = e.crouching ? PLAYER_CROUCH_HEIGHT : e.height || PLAYER_HEIGHT;
  return {
    x: e.pos.x, y: e.pos.y + h / 2, z: e.pos.z,
    hx: e.half || PLAYER_HALF, hy: h / 2, hz: e.half || PLAYER_HALF
  };
}

export function collides(world, box, ignore) {
  for (const i of candidateIndices(world, box)) {
    const b = world.boxes[i];
    if (b.kind === 'trigger') continue;
    if (ignore && ignore.has(i)) continue;
    if (boxOverlaps(box, b)) return b;
  }
  return null;
}

function topOf(b) { return b.y + b.hy; }

/**
 * Integrate an entity through the world for dt seconds.
 * e = { pos, vel, onGround, crouching, height? }
 * Returns nothing; mutates e.
 */
export function integrate(e, world, dt) {
  if (dt <= 0) return;

  // --- vertical -------------------------------------------------------
  e.vel.y = Math.max(e.vel.y - GRAVITY * dt, TERMINAL_VEL);
  let dy = e.vel.y * dt;
  if (dy !== 0) {
    const probe = { ...entityBox(e), y: e.pos.y + dy + (e.crouching ? PLAYER_CROUCH_HEIGHT : (e.height || PLAYER_HEIGHT)) / 2 };
    const hit = collides(world, probe);
    if (hit) {
      if (dy < 0) {
        e.pos.y = topOf(hit);
        e.onGround = true;
        e.groundBox = hit;
      } else {
        e.pos.y = (hit.y - hit.hy) - (e.crouching ? PLAYER_CROUCH_HEIGHT : (e.height || PLAYER_HEIGHT)) - 1e-3;
      }
      e.vel.y = 0;
    } else {
      e.pos.y += dy;
      if (dy < 0) e.onGround = false;
    }
  }

  // --- horizontal -----------------------------------------------------
  const height = e.crouching ? PLAYER_CROUCH_HEIGHT : (e.height || PLAYER_HEIGHT);
  const axes = [['x', e.vel.x], ['z', e.vel.z]];
  for (const [axis, v] of axes) {
    const d = v * dt;
    if (d === 0) continue;
    const box = entityBox(e);
    box[axis === 'x' ? 'x' : 'z'] += d;
    // Lift the test box off the floor: collides() is inclusive, so a player
    // resting exactly on a surface would otherwise count as intersecting it and
    // be unable to move sideways at all.
    box.y += REST_EPSILON;
    box.hy -= REST_EPSILON;
    const hit = collides(world, box);
    if (!hit) {
      e.pos[axis] += d;
      continue;
    }
    // Blocked: try a step-up if the obstacle is low enough.
    const obstacleTop = topOf(hit);
    if (e.onGround && obstacleTop - e.pos.y <= STEP_HEIGHT && obstacleTop > e.pos.y + 0.01) {
      const steppedY = obstacleTop + 1e-3;
      const test = { ...box };
      test.y = steppedY + height / 2;
      if (!collides(world, test)) {
        e.pos[axis] += d;
        e.pos.y = steppedY;
        continue;
      }
    }
    e.vel[axis] = 0;
  }

  // --- ground probe (small epsilon below the feet) ---------------------
  const probe = { ...entityBox(e), y: e.pos.y - 0.08 + height / 2, hy: height / 2 };
  probe.hy = height / 2 + 0.08;
  probe.y = e.pos.y - 0.08 + probe.hy;
  const ground = collides(world, probe);
  e.onGround = !!ground;
  if (ground) e.groundBox = ground;

  // Never fall out of the world.
  if (e.pos.y < -30) {
    e.pos.y = -30;
    e.vel.y = 0;
    e.fell = true;
  }
}

/** Quake-style acceleration so movement feels snappy but has weight. */
export function accelerate(e, wishDir, speed, dt, opts = {}) {
  const frictionMul = opts.friction ?? 1;
  const accelMul = opts.accel ?? 1;
  const onGround = !!e.onGround;

  if (onGround) {
    const spd = Math.hypot(e.vel.x, e.vel.z);
    const control = Math.max(spd, 6);
    const drop = control * (opts.groundFriction ?? 8) * frictionMul * dt;
    const ns = Math.max(0, spd - drop) / (spd || 1);
    e.vel.x *= ns;
    e.vel.z *= ns;
  }

  const wl = Math.hypot(wishDir.x, wishDir.z);
  if (wl < 1e-4) return;
  const wx = wishDir.x / wl, wz = wishDir.z / wl;
  const cur = e.vel.x * wx + e.vel.z * wz;
  const add = speed - cur;
  if (add <= 0) return;
  const accelRate = (onGround ? 12 : 3) * accelMul;
  const inc = Math.min(add, accelRate * speed * dt);
  e.vel.x += wx * inc;
  e.vel.z += wz * inc;
}

export function horizontalSpeed(e) { return Math.hypot(e.vel.x, e.vel.z); }

/**
 * Raycast the static world.
 * @returns {{dist:number, normal:{x,y,z}, box:object, point:{x,y,z}}|null}
 */
export function raycastWorld(world, origin, dir, maxDist = 400) {
  const seg = {
    x: origin.x + dir.x * maxDist / 2,
    y: origin.y + dir.y * maxDist / 2,
    z: origin.z + dir.z * maxDist / 2,
    hx: Math.abs(dir.x * maxDist / 2) + 0.5,
    hy: Math.abs(dir.y * maxDist / 2) + 0.5,
    hz: Math.abs(dir.z * maxDist / 2) + 0.5
  };
  let best = null;
  for (const i of candidateIndices(world, seg)) {
    const b = world.boxes[i];
    if (b.kind === 'trigger') continue;
    const t = rayBox(origin, dir, b, maxDist);
    if (t === null) continue;
    if (!best || t < best.dist) {
      best = { dist: t, box: b, normal: rayBoxNormal(origin, dir, b, t), index: i };
    }
  }
  if (best) {
    best.point = {
      x: origin.x + dir.x * best.dist,
      y: origin.y + dir.y * best.dist,
      z: origin.z + dir.z * best.dist
    };
  }
  return best;
}

/** Distance from a point to the closest point on a box (for explosion falloff). */
export function boxDistance(p, b) {
  const dx = Math.max(Math.abs(p.x - b.x) - b.hx, 0);
  const dy = Math.max(Math.abs(p.y - b.y) - b.hy, 0);
  const dz = Math.max(Math.abs(p.z - b.z) - b.hz, 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * Line of sight test: true when nothing solid blocks the segment.
 */
export function hasLineOfSight(world, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) return true;
  const hit = raycastWorld(world, a, { x: dx / d, y: dy / d, z: dz / d }, d);
  return !hit;
}

export function snapToGround(world, pos, maxSearch = 12) {
  for (let dy = maxSearch; dy >= -maxSearch; dy -= 0.25) {
    const test = { x: pos.x, y: pos.y + dy, z: pos.z };
    const below = raycastWorld(world, { x: test.x, y: test.y + 0.2, z: test.z }, { x: 0, y: -1, z: 0 }, 0.6);
    if (below) return { ...test, y: below.point.y + 1e-3 };
  }
  return { ...pos };
}

export function clampSpeed(e, maxSpeed) {
  const s = horizontalSpeed(e);
  if (s > maxSpeed && s > 0) {
    const k = maxSpeed / s;
    e.vel.x *= k;
    e.vel.z *= k;
  }
}

export function withinBox2D(p, b) {
  return Math.abs(p.x - b.x) <= b.hx && Math.abs(p.z - b.z) <= b.hz;
}

export function clampTo(v, lo, hi) { return clamp(v, lo, hi); }
