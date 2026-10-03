/**
 * Bot AI. Bots write into the same input struct a human client sends, so they go
 * through exactly the same movement/weapon code path — no special-casing.
 */
import { eyePos } from './sim.js';
import { hasLineOfSight } from './physics.js';
import { dirFromAngles, dist, clamp, norm } from './math3.js';

const STATE = new WeakMap();

function brain(p) {
  let s = STATE.get(p);
  if (!s) {
    s = {
      goal: null, repath: 0, strafe: 0, strafeDir: 1, stuck: 0, lastPos: { x: 0, y: 0, z: 0 },
      targetId: null, retarget: 0, fireDelay: 0, reaction: 0.25 - p.skill * 0.18,
      grenadeAt: 0, jumpAt: 0, crouchAt: 0, aimJitter: 0, lastFire: 0
    };
    STATE.set(p, s);
  }
  return s;
}

function pickGoal(sim, p, s) {
  const mode = sim.modeId;
  const options = [];
  if (mode === 'dom' && sim.state.flags) {
    for (const f of sim.state.flags) {
      if (f.owner !== p.team) options.push({ x: f.x, z: f.z, w: 3 });
      else options.push({ x: f.x, z: f.z, w: 1 });
    }
  } else if (mode === 'snd' && sim.state.round) {
    const r = sim.state.round;
    if (r.phase === 'live') {
      if (p.team === r.attackers) {
        for (const site of sim.map.sites) options.push({ x: site.x, z: site.z, w: 3 });
      } else if (r.bomb.planted && r.bomb.pos) {
        options.push({ x: r.bomb.pos.x, z: r.bomb.pos.z, w: 5 });
      } else {
        for (const site of sim.map.sites) options.push({ x: site.x, z: site.z, w: 2 });
      }
    } else if (r.phase === 'planted' && r.bomb.pos) {
      if (p.team === r.defenders) options.push({ x: r.bomb.pos.x, z: r.bomb.pos.z, w: 5 });
      else options.push({ x: r.bomb.pos.x + 8, z: r.bomb.pos.z + 8, w: 2 });
    }
  }
  if (!options.length) {
    // Roam: head for a point biased toward the enemy half of the map.
    const a = sim.rng.next() * Math.PI * 2;
    const r = 8 + sim.rng.next() * 18;
    const bias = p.team === 'b' ? -1 : 1;
    options.push({ x: Math.cos(a) * r, z: Math.sin(a) * r + bias * 6, w: 1 });
  }
  const total = options.reduce((sum, o) => sum + o.w, 0);
  let roll = sim.rng.next() * total;
  let chosen = options[0];
  for (const o of options) { roll -= o.w; if (roll <= 0) { chosen = o; break; } }
  const jitter = 3.5;
  s.goal = {
    x: chosen.x + (sim.rng.next() - 0.5) * jitter,
    z: chosen.z + (sim.rng.next() - 0.5) * jitter
  };
}

function findTarget(sim, p, s, dt) {
  s.retarget -= dt;
  if (s.retarget > 0) {
    const current = sim.players.get(s.targetId);
    if (current && current.alive &&
        hasLineOfSight(sim.world, eyePos(p), eyePos(current))) return current;
  }
  s.retarget = 0.35 - p.skill * 0.15;

  let best = null;
  let bestScore = -Infinity;
  for (const other of sim.players.values()) {
    if (other === p || !other.alive) continue;
    if (sim.mode.teams && other.team === p.team) continue;
    const d = dist(p.pos, other.pos);
    if (d > 85) continue;
    const visible = hasLineOfSight(sim.world, eyePos(p), eyePos(other));
    const score = (visible ? 1000 : 0) - d;
    if (score > bestScore) { bestScore = score; best = other; }
  }
  s.targetId = best ? best.id : null;
  if (best && bestScore < 1000) return null;
  return best;
}

export function updateBot(sim, p, dt) {
  const s = brain(p);
  const input = p.input;
  input.mx = 0; input.mz = 0; input.fire = false; input.ads = false;
  input.sprint = false; input.crouch = false; input.jump = false;
  input.reload = false; input.grenade = null; input.streak = null; input.action = false;

  const w = p.weapons[p.slot];
  if (w && w.ammo === 0) { input.reload = true; }

  const target = findTarget(sim, p, s, dt);

  /* --------------------------- aiming --------------------------- */
  if (target) {
    const eye = eyePos(target);
    // Lead the target slightly when it is moving.
    const lead = 0.08 + (1 - p.skill) * 0.12;
    const tx = eye.x + target.vel.x * lead;
    const ty = eye.y + (p.skill > 0.7 ? 0.15 : 0) - 0.1;
    const tz = eye.z + target.vel.z * lead;
    const dx = tx - p.pos.x, dz = tz - p.pos.z;
    const horiz = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(-dx, -dz);
    const desiredPitch = clamp(Math.atan2(ty - (p.pos.y + 1.55), horiz), -1.2, 1.2);

    const turn = (2.2 + p.skill * 5.5) * dt;
    p.yaw = approachAngle(p.yaw, desiredYaw, turn);
    p.pitch = approach(p.pitch, desiredPitch, turn * 1.4);

    const yawErr = Math.abs(angDiff(desiredYaw, p.yaw));
    const pitchErr = Math.abs(desiredPitch - p.pitch);
    const d = dist(p.pos, target.pos);
    input.ads = d > 14 && p.skill > 0.4;
    const tolerance = (input.ads ? 0.035 : 0.09) + (1 - p.skill) * 0.06;
    s.fireDelay -= dt;
    if (yawErr < tolerance && pitchErr < tolerance * 2 && s.fireDelay <= 0 && !p.reloading) {
      input.fire = true;
      if (!s.lastFire) s.lastFire = sim.time;
      if (w && !w.def.auto && sim.time - (s.semiAt || 0) < 60 / w.def.rpm) input.fire = false;
      if (input.fire) s.semiAt = sim.time;
    } else {
      s.lastFire = 0;
    }

    // Reaction delay before engaging a newly spotted target.
    if (s.seenTargetId !== target.id) {
      s.seenTargetId = target.id;
      s.fireDelay = s.reaction * (1.4 - p.skill);
      input.fire = false;
    }

    // Grenades against a grouped or distant enemy.
    if (p.lethal > 0 && sim.time > s.grenadeAt && d > 10 && d < 30 && p.skill > 0.45) {
      s.grenadeAt = sim.time + 14;
      input.grenade = 'lethal';
    }
  } else {
    s.seenTargetId = null;
    p.pitch = approach(p.pitch, 0, 2 * dt);
  }

  /* -------------------------- movement -------------------------- */
  if (!s.goal || sim.time > s.repath) {
    s.repath = sim.time + 5 + sim.rng.next() * 5;
    pickGoal(sim, p, s);
  }

  const toGoal = { x: s.goal.x - p.pos.x, z: s.goal.z - p.pos.z };
  const goalDist = Math.hypot(toGoal.x, toGoal.z);
  if (goalDist < 2.5) {
    s.repath = 0;
  }

  let mx = 0, mz = 0;
  if (goalDist > 1.5) {
    const n = norm({ x: toGoal.x, y: 0, z: toGoal.z });
    const fwd = dirFromAngles(p.yaw, 0);
    const right = { x: fwd.z, y: 0, z: -fwd.x };
    mz = -(n.x * fwd.x + n.z * fwd.z);
    mx = (n.x * right.x + n.z * right.z);
  }

  // Strafe to be a harder target while shooting.
  s.strafe -= dt;
  if (s.strafe <= 0) {
    s.strafe = 0.6 + sim.rng.next() * 1.4;
    s.strafeDir = sim.rng.next() < 0.5 ? -1 : 1;
  }
  if (target) {
    mx += s.strafeDir * 0.75;
    if (dist(p.pos, target.pos) < 6) mz += 0.5; // back off at close range
  }

  // Stuck detection: nudge sideways and pick a new goal.
  const moved = dist(p.pos, s.lastPos);
  s.lastPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  if (moved < 0.02 && goalDist > 3) {
    s.stuck += dt;
    if (s.stuck > 0.35) {
      s.stuck = 0;
      s.repath = 0;
      s.strafe = 0.7;
      s.strafeDir = -s.strafeDir;
      if (sim.rng.next() < 0.4) input.jump = true;
    }
  } else {
    s.stuck = Math.max(0, s.stuck - dt);
  }

  input.mx = clamp(mx, -1, 1);
  input.mz = clamp(mz, -1, 1);
  input.sprint = !target && goalDist > 8;
  if (target && dist(p.pos, target.pos) > 40) input.sprint = true;

  // Random crouch while holding an angle.
  s.crouchAt -= dt;
  if (s.crouchAt <= 0) {
    s.crouchAt = 2 + sim.rng.next() * 5;
    s.wantCrouch = !s.wantCrouch && !target && sim.rng.next() < 0.3;
  }
  input.crouch = !!s.wantCrouch;

  // Objectives that need a hold action.
  if (sim.modeId === 'snd' && sim.state.round) {
    const r = sim.state.round;
    if (r.phase === 'live' && p.hasBomb) {
      const atSite = sim.map.sites.some((site) => Math.hypot(p.pos.x - site.x, p.pos.z - site.z) <= site.r);
      if (atSite && sim.alivePlayers(r.defenders).every((d) => dist(d.pos, p.pos) > 12)) input.action = true;
    }
    if (r.phase === 'planted' && p.team === r.defenders && r.bomb.pos) {
      if (Math.hypot(p.pos.x - r.bomb.pos.x, p.pos.z - r.bomb.pos.z) < 2.2) input.action = true;
    }
  }

  // Killstreaks
  if (p.streaksReady.length && sim.time > (s.streakAt || 0)) {
    s.streakAt = sim.time + 6;
    const idx = 0;
    const id = p.streaksReady[idx];
    if (id === 'predator' && target) {
      input.streak = idx;
      input.target = { x: target.pos.x, z: target.pos.z };
    } else if (id !== 'predator') {
      input.streak = idx;
    }
  }

  // Weapon swap when the current gun is dry and the other is not.
  const other = p.weapons[1 - p.slot];
  if (w && w.ammo === 0 && w.reserve === 0 && other && other.ammo > 0) input.slot = 1 - p.slot;
}

function approach(cur, target, step) {
  const d = target - cur;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}

function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function approachAngle(cur, target, step) {
  const d = angDiff(target, cur);
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}
