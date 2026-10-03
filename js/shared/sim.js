/**
 * The authoritative game simulation.
 *
 * One implementation, two hosts:
 *   - the Node server runs it for online matches (server-authoritative hits)
 *   - the browser runs it locally for the offline/bot fallback
 * That is why this file must stay free of DOM / Three.js dependencies.
 */
import { getMap, getMapBoxes } from './maps.js';
import {
  buildWorld, integrate, accelerate, collides, raycastWorld, horizontalSpeed,
  clampSpeed, PLAYER_HALF, PLAYER_HEIGHT, PLAYER_CROUCH_HEIGHT, EYE_HEIGHT,
  EYE_HEIGHT_CROUCH, hasLineOfSight, snapToGround
} from './physics.js';
import {
  makeRng, rayBox, dirFromAngles, clamp, dist, add, sub, scale, norm, lerp
} from './math3.js';
import {
  effectiveWeapon, falloffDamage, sanitizeLoadout, LETHAL_MAP, TACTICAL_MAP
} from './weapons.js';
import { sanitizePerks } from './perks.js';
import { streaksForLoadout, KILLSTREAK_MAP } from './killstreaks.js';
import { MODES } from './modes.js';
import { updateBot } from './bots.js';

/* ------------------------------------------------------------------ */
/* Rulesets                                                            */
/* ------------------------------------------------------------------ */

export const RULESETS = {
  hardcore: {
    id: 'hardcore', name: 'Hardcore', nameSv: 'Hardcore',
    health: 30, damageMul: 1.6, friendlyFire: true, enemyHealthBars: false,
    respawnDelay: 3, scoreMul: 1, speedMul: 1, timeMul: 1,
    scoreLimits: { tdm: 60, ffa: 25, dom: 150, snd: 4, gungame: 1 },
    desc: '30 HP, more damage, friendly fire on, no enemy health bars.',
    descSv: '30 HP, mer skada, friendly fire, inga fiende-hälsobar.'
  },
  classic: {
    id: 'classic', name: 'Classic', nameSv: 'Klassisk',
    health: 100, damageMul: 1, friendlyFire: false, enemyHealthBars: true,
    respawnDelay: 3, scoreMul: 1, speedMul: 1, timeMul: 1,
    scoreLimits: { tdm: 75, ffa: 30, dom: 200, snd: 4, gungame: 1 },
    desc: 'The 6v6 default: 100 HP, no friendly fire.',
    descSv: 'Standard 6v6: 100 HP, ingen friendly fire.'
  },
  arcade: {
    id: 'arcade', name: 'Arcade', nameSv: 'Arkad',
    health: 100, damageMul: 1.1, friendlyFire: false, enemyHealthBars: true,
    respawnDelay: 2, scoreMul: 1, speedMul: 1.22, timeMul: 0.75,
    scoreLimits: { tdm: 40, ffa: 20, dom: 120, snd: 3, gungame: 1 },
    desc: 'Fast movement, short matches, extra damage.',
    descSv: 'Snabb rörelse, korta matcher, extra skada.'
  }
};

export const BASE_SPEED = 5.6;
export const SPRINT_MUL = 1.42;
export const CROUCH_MUL = 0.55;
export const JUMP_VEL = 7.8;
export const MAX_RANGE = 220;

/* ------------------------------------------------------------------ */
/* Hitboxes                                                            */
/* ------------------------------------------------------------------ */

export function torsoBox(p) {
  const h = p.crouching ? PLAYER_CROUCH_HEIGHT * 0.8 : PLAYER_HEIGHT * 0.8;
  return { x: p.pos.x, y: p.pos.y + h / 2, z: p.pos.z, hx: PLAYER_HALF, hy: h / 2, hz: PLAYER_HALF };
}

export function headBox(p) {
  const bodyH = p.crouching ? PLAYER_CROUCH_HEIGHT * 0.8 : PLAYER_HEIGHT * 0.8;
  const headH = 0.36;
  return { x: p.pos.x, y: p.pos.y + bodyH + headH / 2, z: p.pos.z, hx: 0.2, hy: headH / 2, hz: 0.2 };
}

export function eyePos(p) {
  const h = p.crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
  return { x: p.pos.x, y: p.pos.y + h, z: p.pos.z };
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

export class Sim {
  constructor(opts = {}) {
    this.mapId = opts.mapId || 'rust';
    this.map = getMap(this.mapId);
    this.world = buildWorld(getMapBoxes(this.mapId));
    this.modeId = opts.mode || 'tdm';
    this.mode = MODES[this.modeId] || MODES.tdm;
    this.rules = RULESETS[opts.ruleset] || RULESETS.hardcore;
    this.rng = makeRng(opts.seed || 12345);
    this.now = opts.now || (() => Date.now());

    this.players = new Map();
    this.entities = [];
    this.events = [];
    this.entitySeq = 1;

    this.time = 0;
    this.over = false;
    this.winner = null;
    this.teams = { a: { score: 0, id: 'a' }, b: { score: 0, id: 'b' } };
    this.state = {};
    this.mode.init(this);

    this.timeLimit = (this.mode.timeLimit?.(this) ?? 600) * this.rules.timeMul;
    this.timeLeft = this.timeLimit;
    this.scoreLimit = this.mode.scoreLimit?.(this) ?? 0;
  }

  /* ------------------------------ players ------------------------------ */

  addPlayer(info) {
    const p = {
      id: info.id,
      name: String(info.name || 'Soldier').slice(0, 18),
      team: info.team || (this.mode.teams ? 'a' : 'ffa'),
      isBot: !!info.isBot,
      skill: clamp(info.skill ?? 0.5, 0, 1),
      loadout: sanitizeLoadout(info.loadout),
      perks: sanitizePerks(sanitizeLoadout(info.loadout)),
      alive: false,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0,
      crouching: false, sprinting: false, onGround: false,
      health: this.rules.health,
      maxHealth: this.rules.health,
      weapons: [], slot: 0,
      lethal: 0, tactical: 0,
      streak: 0, streaksReady: [],
      kills: 0, deaths: 0, assists: 0, headshots: 0, score: 0, objective: 0,
      bloom: 0, nextShot: 0, prevFire: false,
      reloading: false, reloadEnd: 0, swapping: false, swapEnd: 0,
      respawnAt: 0, lastHitBy: null, recentDamage: [],
      flash: 0, stun: 0, burning: { until: 0, tick: 0, owner: null },
      weaponXp: {},
      input: emptyInput(),
      bot: null,
      joined: this.time
    };
    this.buildLoadout(p, this.mode.startingWeapon ? this.mode.startingWeapon(p, this) : null);
    this.players.set(p.id, p);
    this.mode.onJoin?.(this, p);
    this.balanceTeams();
    this.spawnPlayer(p);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.entities = this.entities.filter((e) => e.owner !== id);
    this.events.push({ t: 'leave', id, name: p.name });
    this.mode.onLeave?.(this, p);
    this.balanceTeams();
  }

  buildLoadout(p, forcedWeapon) {
    const l = p.loadout;
    const primary = forcedWeapon || l.primary;
    const secondary = l.secondary;
    p.weapons = [
      { id: primary, attachments: forcedWeapon ? [] : (l.primaryAttachments || []), ammo: 0, reserve: 0 },
      { id: secondary, attachments: l.secondaryAttachments || [], ammo: 0, reserve: 0 }
    ];
    for (const w of p.weapons) {
      const def = effectiveWeapon(w.id, w.attachments);
      w.ammo = def.mag;
      w.reserve = def.reserve;
      w.def = def;
    }
    p.slot = 0;
    p.lethal = 1;
    p.tactical = 1;
    p.streaksReady = [];
    p.streaks = streaksForLoadout(p.loadout);
  }

  balanceTeams() {
    if (!this.mode.teams) return;
    const list = [...this.players.values()].filter((p) => !p.isBot);
    const bots = [...this.players.values()].filter((p) => p.isBot);
    const counts = { a: 0, b: 0 };
    for (const p of list) counts[p.team] = (counts[p.team] || 0) + 1;
    for (const p of bots) {
      p.team = counts.a <= counts.b ? 'a' : 'b';
      counts[p.team]++;
    }
  }

  /* ------------------------------ spawning ----------------------------- */

  pickSpawn(p) {
    const spawns = this.mode.spawnsFor(this, p);
    if (!spawns.length) return { x: 0, y: 1, z: 0 };
    let best = null;
    let bestScore = -Infinity;
    for (const s of spawns) {
      let score = this.rng.next() * 6;
      for (const other of this.players.values()) {
        if (other === p || !other.alive) continue;
        if (this.mode.teams && other.team === p.team) continue;
        const d = Math.hypot(other.pos.x - s[0], other.pos.z - s[2]);
        score += Math.min(d, 60) * (d < 12 ? -2.5 : 1);
        if (other.alive && d < 25 && hasLineOfSight(this.world, eyePos(other), { x: s[0], y: s[1] + 1, z: s[2] })) {
          score -= 40;
        }
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return { x: best[0], y: best[1], z: best[2] };
  }

  spawnPlayer(p, at) {
    const pos = at || this.pickSpawn(p);
    const grounded = snapToGround(this.world, pos, 6);
    p.pos = { x: grounded.x, y: grounded.y + 0.05, z: grounded.z };
    p.vel = { x: 0, y: 0, z: 0 };
    // Without this a player cannot jump for the first tick after spawning
    // (and the client's prediction would disagree with the server).
    p.onGround = true;
    p.health = p.maxHealth = this.rules.health;
    p.alive = true;
    p.crouching = false;
    p.bloom = 0;
    p.reloading = false;
    p.swapping = false;
    p.flash = 0; p.stun = 0;
    p.recentDamage = [];
    this.buildLoadout(p, this.mode.startingWeapon ? this.mode.startingWeapon(p, this) : null);
    // Face the middle of the map.
    const dir = Math.atan2(-p.pos.x, -p.pos.z);
    p.yaw = dir;
    p.pitch = 0;
    this.events.push({ t: 'spawn', id: p.id, pos: p.pos, team: p.team });
    this.mode.onSpawn?.(this, p);
  }

  /* ------------------------------- input ------------------------------- */

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = { ...emptyInput(), ...(input || {}) };
    if (typeof p.input.yaw === 'number') p.yaw = p.input.yaw;
    if (typeof p.input.pitch === 'number') p.pitch = clamp(p.input.pitch, -1.55, 1.55);
    // Client-authoritative position, with an anti-teleport clamp: nobody can move
    // faster than the fastest legal speed between two inputs.
    if (typeof p.input.x === 'number' && typeof p.input.y === 'number' && typeof p.input.z === 'number') {
      const elapsed = this.time - (p.lastInputTime ?? this.time);
      const maxStep = Math.max(0.05, elapsed) * (BASE_SPEED * SPRINT_MUL * this.rules.speedMul * 1.8) + 0.6;
      const dx = p.input.x - p.pos.x, dy = p.input.y - p.pos.y, dz = p.input.z - p.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxStep && d > 0) {
        const k = maxStep / d;
        p.pos.x += dx * k; p.pos.y += dy * k; p.pos.z += dz * k;
        // Re-sync the client on the next snapshot.
        p.resync = true;
      } else {
        p.pos.x = p.input.x; p.pos.y = p.input.y; p.pos.z = p.input.z;
      }
      // Keep the authoritative copy from sinking into geometry.
      const box = { x: p.pos.x, y: p.pos.y + PLAYER_HEIGHT / 2, z: p.pos.z, hx: PLAYER_HALF * 0.98, hy: PLAYER_HEIGHT / 2, hz: PLAYER_HALF * 0.98 };
      if (collides(this.world, box)) {
        p.pos.y += 0.12;
        const box2 = { ...box, y: p.pos.y + PLAYER_HEIGHT / 2 };
        if (collides(this.world, box2)) p.resync = true;
      }
      p.lastInputTime = this.time;
    }
  }

  /* -------------------------------- tick ------------------------------- */

  tick(dtRaw) {
    const dt = clamp(dtRaw, 0.0005, 1 / 15);
    this.time += dt;
    if (!this.timeLeftLocked) this.timeLeft = Math.max(0, this.timeLeft - dt);

    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.updateEntities(dt);
    this.mode.tick?.(this, dt);

    if (!this.over && this.mode.isOver?.(this)) this.endMatch();
    if (!this.over && this.timeLeft <= 0 && this.mode.usesTimer !== false) this.endMatch();

    const out = this.events;
    this.events = [];
    return out;
  }

  endMatch(reason) {
    if (this.over) return;
    this.over = true;
    this.winner = this.mode.winner(this);
    this.events.push({ t: 'end', winner: this.winner, reason: reason || 'limit', scoreboard: this.scoreboard() });
  }

  updatePlayer(p, dt) {
    if (!p.alive) {
      if (this.mode.respawn && this.time >= p.respawnAt && !this.over) {
        this.spawnPlayer(p);
      }
      return;
    }

    // --- status effects -------------------------------------------------
    p.flash = Math.max(0, p.flash - dt);
    p.stun = Math.max(0, p.stun - dt);
    if (p.burning.until > this.time) {
      p.burning.tick -= dt;
      if (p.burning.tick <= 0) {
        p.burning.tick = 0.4;
        this.applyDamage(p, 22, this.players.get(p.burning.owner) || null, 'thermite');
      }
    }
    p.bloom = Math.max(0, p.bloom - 7 * dt);

    if (p.isBot) updateBot(this, p, dt);
    const i = p.input;

    // --- movement -------------------------------------------------------
    const stunned = p.stun > 0;
    const speedMul = (p.weapons[p.slot]?.def?.moveSpeed ?? 1) * this.rules.speedMul * (stunned ? 0.45 : 1);
    let speed = BASE_SPEED * speedMul;
    p.sprinting = !!i.sprint && !p.crouching && !i.ads && !stunned && horizontalSpeed(p) > 0.5;
    if (p.sprinting) speed *= SPRINT_MUL;
    if (i.ads) speed *= 0.62;

    p.crouching = !!i.crouch;
    if (p.crouching) speed *= CROUCH_MUL;

    const mx = clamp(i.mx ?? 0, -1, 1), mz = clamp(i.mz ?? 0, -1, 1);
    // Forward is -Z rotated by yaw (matches dirFromAngles); mz = -1 means "forward".
    const fwd = dirFromAngles(p.yaw, 0);
    const right = { x: fwd.z, y: 0, z: -fwd.x };
    const wishDir = { x: fwd.x * -mz + right.x * mx, y: 0, z: fwd.z * -mz + right.z * mx };

    if (i.jump && p.onGround && !stunned) {
      p.vel.y = JUMP_VEL * (p.perks.has('commando') ? 1.08 : 1);
      p.onGround = false;
      this.events.push({ t: 'step', id: p.id, pos: p.pos, kind: 'jump' });
    }

    if (p.isBot) {
      // Bots are simulated here — there is no other authority for them.
      const wasGrounded = p.onGround;
      const impactVel = p.vel.y;
      accelerate(p, wishDir, speed, dt, { accel: p.perks.has('commando') ? 1.15 : 1 });
      clampSpeed(p, speed * 1.35);
      integrate(p, this.world, dt);

      if (p.fell) {
        p.fell = false;
        this.applyDamage(p, 999, null, 'fall');
        return;
      }
      if (!wasGrounded && p.onGround && impactVel < -21 && !p.perks.has('commando')) {
        this.applyDamage(p, (-impactVel - 21) * 3.4, null, 'fall');
        if (!p.alive) return;
      }
    } else {
      // Humans are client-authoritative for movement: the client runs this exact
      // physics and reports its position, which setInput() has already validated
      // against the teleport clamp and the world geometry. Re-simulating here
      // would fight the client and desync what other players see, so we only
      // derive the ground state (needed for spread) and fall damage.
      const height = p.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
      const probe = {
        x: p.pos.x, y: p.pos.y - 0.08 + height / 2 + 0.08, z: p.pos.z,
        hx: PLAYER_HALF * 0.98, hy: height / 2 + 0.08, hz: PLAYER_HALF * 0.98
      };
      const grounded = !!collides(this.world, probe);
      if (p.lastReportedY != null) {
        const vy = (p.pos.y - p.lastReportedY) / dt;
        p.reportedFallVel = vy;
        if (p.wasAirborne && grounded && vy < -21 && !p.perks.has('commando')) {
          this.applyDamage(p, (-vy - 21) * 3.4, null, 'fall');
          if (!p.alive) return;
        }
      }
      p.wasAirborne = !grounded;
      p.lastReportedY = p.pos.y;
      p.onGround = grounded;
      p.vel.x = wishDir.x * speed;
      p.vel.z = wishDir.z * speed;
    }

    if (horizontalSpeed(p) > 1.2 && p.onGround) {
      p.stepTimer = (p.stepTimer || 0) - dt;
      if (p.stepTimer <= 0) {
        p.stepTimer = p.sprinting ? 0.3 : 0.42;
        this.events.push({ t: 'step', id: p.id, pos: p.pos, kind: p.sprinting ? 'run' : 'walk', team: p.team });
      }
    }

    // --- weapon handling ------------------------------------------------
    if (p.swapping && this.time >= p.swapEnd) {
      p.swapping = false;
      this.events.push({ t: 'swap', id: p.id, slot: p.slot });
    }
    if (typeof i.slot === 'number' && i.slot !== p.slot && !p.swapping && p.weapons[i.slot]) {
      p.slot = i.slot;
      p.swapping = true;
      p.swapEnd = this.time + (p.weapons[i.slot].def.swapTime || 0.4);
      p.reloading = false;
      this.events.push({ t: 'swap', id: p.id, slot: p.slot });
    }
    if (i.reload && !p.reloading && !p.swapping) this.startReload(p);
    if (p.reloading && this.time >= p.reloadEnd) this.finishReload(p);

    if (i.fire) this.tryFire(p);
    p.prevFire = !!i.fire;

    if (i.grenade === 'lethal') this.throwGrenade(p, 'lethal');
    if (i.grenade === 'tactical') this.throwGrenade(p, 'tactical');

    if (typeof i.streak === 'number') this.useStreak(p, i.streak, i.target);

    // Killstreaks become available as the streak grows.
    for (const s of p.streaks || []) {
      if (p.streak >= s.cost && !p.streaksReady.includes(s.id)) {
        p.streaksReady.push(s.id);
        this.events.push({ t: 'streakReady', id: p.id, streak: s.id });
      }
    }

    // Pick up care packages.
    for (const e of this.entities) {
      if (e.kind !== 'crate' || e.taken) continue;
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 1.6 && Math.abs(e.pos.y - p.pos.y) < 2.5) {
        e.taken = true;
        e.dead = true;
        const pool = (p.streaks || []).length ? p.streaks.map((s) => s.id) : ['uav'];
        const pick = this.rng.pick(pool);
        if (!p.streaksReady.includes(pick)) p.streaksReady.push(pick);
        this.events.push({ t: 'crate', by: p.id, owner: e.owner, streak: pick, pos: e.pos });
      }
    }

    p.recentDamage = p.recentDamage.filter((d) => this.time - d.t < 5);
  }

  /* ------------------------------ weapons ------------------------------ */

  startReload(p) {
    const w = p.weapons[p.slot];
    if (!w || w.ammo >= w.def.mag || w.reserve <= 0) return;
    p.reloading = true;
    const mul = p.perks.has('sleight') ? 0.6 : 1;
    p.reloadEnd = this.time + (w.def.reloadTime || 2) * mul;
    this.events.push({ t: 'reload', id: p.id });
  }

  finishReload(p) {
    const w = p.weapons[p.slot];
    p.reloading = false;
    if (!w) return;
    const need = w.def.mag - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take;
    w.reserve -= take;
    this.events.push({ t: 'reloadDone', id: p.id });
  }

  computeSpread(p, def) {
    const moving = horizontalSpeed(p);
    let spread = p.input.ads ? def.spread.ads : def.spread.hip;
    if (!p.onGround) spread *= 2.4;
    spread += (moving / BASE_SPEED) * def.spread.move;
    spread += p.bloom;
    if (p.perks.has('steadyaim') && !p.input.ads) spread *= 0.75;
    if (p.isBot) spread *= 1.5 - p.skill * 0.85;
    return spread;
  }

  tryFire(p) {
    const w = p.weapons[p.slot];
    if (!w || p.reloading || p.swapping || p.stun > 0) return;
    if (this.time < p.nextShot) return;
    if (!w.def.auto && p.prevFire) return;
    if (w.ammo <= 0) {
      if (p.prevFire !== 'dry') {
        this.events.push({ t: 'dryfire', id: p.id });
        p.prevFire = 'dry';
      }
      if (w.reserve > 0) this.startReload(p);
      return;
    }
    p.nextShot = this.time + 60 / w.def.rpm;
    w.ammo--;
    const spread = this.computeSpread(p, w.def);
    p.bloom = Math.min(p.bloom + w.def.spread.climb, 7);
    this.fireRays(p, w, spread);
    if (p.isBot) {
      p.pitch = clamp(p.pitch + w.def.recoil.vert * 0.004 * (1 - p.skill * 0.5), -1.55, 1.55);
      p.yaw += (this.rng.next() - 0.5) * w.def.recoil.horz * 0.004;
    }
  }

  fireRays(p, w, spreadDeg) {
    const origin = eyePos(p);
    const base = dirFromAngles(p.yaw, p.pitch);
    const pellets = w.def.pellets || 1;
    const tracerEnds = [];
    for (let n = 0; n < pellets; n++) {
      const dir = pellets > 1 || spreadDeg > 0.02 ? spreadDir(base, spreadDeg, this.rng) : base;
      const hit = this.hitscan(p, origin, dir, w.def);
      tracerEnds.push(hit.point);
      if (hit.type === 'player') {
        this.damagePlayer(hit.player, hit, p, w.def);
      } else if (hit.type === 'sentry') {
        this.damageSentry(hit.sentry, hit.head ? 60 : 34, p);
      } else if (hit.type === 'world') {
        this.events.push({ t: 'impact', pos: hit.point, normal: hit.normal, weapon: w.id });
      }
    }
    this.events.push({
      t: 'shot', by: p.id, team: p.team, pos: origin, ends: tracerEnds,
      weapon: w.id, silent: !!w.def.silent, ads: !!p.input.ads, ammo: w.ammo
    });
    if (w.ammo === 0 && w.reserve > 0) this.startReload(p);
  }

  hitscan(shooter, origin, dir, def) {
    const worldHit = raycastWorld(this.world, origin, dir, MAX_RANGE);
    let best = worldHit
      ? { type: 'world', dist: worldHit.dist, point: worldHit.point, normal: worldHit.normal }
      : { type: 'none', dist: MAX_RANGE, point: add(origin, scale(dir, MAX_RANGE)), normal: { x: 0, y: 1, z: 0 } };

    // Smoke absorbs bullets.
    for (const e of this.entities) {
      if (e.kind !== 'smoke' || e.until < this.time) continue;
      const t = raySphere(origin, dir, e.pos, e.radius);
      if (t !== null && t < best.dist) {
        best = { type: 'smoke', dist: t, point: add(origin, scale(dir, t)), normal: { x: 0, y: 1, z: 0 } };
      }
    }

    for (const p of this.players.values()) {
      if (p === shooter || !p.alive) continue;
      const head = headBox(p);
      let t = rayBox(origin, dir, head, best.dist);
      if (t !== null) {
        best = { type: 'player', player: p, head: true, dist: t, point: add(origin, scale(dir, t)) };
        continue;
      }
      t = rayBox(origin, dir, torsoBox(p), best.dist);
      if (t !== null) {
        best = { type: 'player', player: p, head: false, dist: t, point: add(origin, scale(dir, t)) };
      }
    }

    for (const e of this.entities) {
      if (e.kind !== 'sentry' || e.dead) continue;
      const box = { x: e.pos.x, y: e.pos.y + 0.7, z: e.pos.z, hx: 0.45, hy: 0.7, hz: 0.45 };
      const t = rayBox(origin, dir, box, best.dist);
      if (t !== null) {
        best = { type: 'sentry', sentry: e, head: origin.y > e.pos.y + 1.1, dist: t, point: add(origin, scale(dir, t)) };
      }
    }
    return best;
  }

  damagePlayer(victim, hit, attacker, def) {
    let dmg = falloffDamage(def, hit.dist);
    if (hit.head) dmg *= def.headMult;
    if (attacker && attacker.perks.has('stoppingpower')) dmg *= 1.2;
    dmg *= this.rules.damageMul;
    if (attacker && attacker !== victim && this.mode.teams && attacker.team === victim.team && !this.rules.friendlyFire) return;
    this.applyDamage(victim, dmg, attacker, 'bullet', { head: hit.head });
  }

  applyDamage(victim, amount, attacker, cause, extra = {}) {
    if (!victim || !victim.alive || this.over) return;
    if (attacker && attacker !== victim && this.mode.teams && attacker.team === victim.team &&
        !this.rules.friendlyFire && cause !== 'fall') return;
    victim.health -= amount;
    victim.lastHitBy = attacker ? attacker.id : null;
    if (attacker && attacker !== victim) {
      const entry = victim.recentDamage.find((d) => d.id === attacker.id);
      if (entry) { entry.dmg += amount; entry.t = this.time; }
      else victim.recentDamage.push({ id: attacker.id, dmg: amount, t: this.time });
    }
    this.events.push({
      t: 'hit', by: attacker ? attacker.id : null, victim: victim.id,
      dmg: Math.round(amount), head: !!extra.head, cause
    });
    if (victim.health <= 0) this.kill(victim, attacker, cause, extra);
  }

  kill(victim, attacker, cause, extra = {}) {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.streaksReady = [];
    victim.vel = { x: 0, y: 0, z: 0 };
    victim.respawnAt = this.time + this.rules.respawnDelay * (this.mode.respawn === false ? 999 : 1);

    let killer = attacker || null;
    if (killer && killer !== victim && this.mode.teams && killer.team === victim.team && cause === 'bullet') {
      // Friendly fire: penalise in team modes.
      killer.score = Math.max(0, killer.score - 50);
    }
    const suicide = !killer || killer === victim || cause === 'fall';

    if (killer && !suicide) {
      killer.kills++;
      if (extra.head) killer.headshots++;
      killer.streak++;
      killer.score += 100 * this.rules.scoreMul;
      killer.weaponXp[killer.weapons[killer.slot]?.id] = (killer.weaponXp[killer.weapons[killer.slot]?.id] || 0) + 1;
      if (killer.perks.has('scavenger')) {
        const w = killer.weapons[killer.slot];
        if (w) w.reserve = Math.min(w.def.reserve, w.reserve + Math.ceil(w.def.mag * 0.6));
        killer.lethal = Math.min(2, killer.lethal + 1);
      }
      this.mode.onKill?.(this, killer, victim, cause);
    } else {
      this.mode.onKill?.(this, null, victim, cause);
    }

    // Assists
    const assists = [];
    if (killer) {
      for (const d of victim.recentDamage) {
        if (d.id === killer.id) continue;
        if (d.dmg >= victim.maxHealth * 0.25) {
          const helper = this.players.get(d.id);
          if (helper && helper.alive) {
            helper.assists++;
            helper.score += 25;
            assists.push(d.id);
          }
        }
      }
    }

    this.events.push({
      t: 'kill', killer: killer && !suicide ? killer.id : null, victim: victim.id,
      killerName: killer && !suicide ? killer.name : null, victimName: victim.name,
      weapon: killer ? killer.weapons[killer.slot]?.id : null,
      head: !!extra.head, cause, suicide, assists,
      killerTeam: killer?.team, victimTeam: victim.team,
      streak: killer ? killer.streak : 0
    });

    victim.recentDamage = [];
    this.mode.onDeath?.(this, victim, killer);
  }

  /* ----------------------------- grenades ------------------------------ */

  throwGrenade(p, type) {
    const def = type === 'lethal' ? LETHAL_MAP[p.loadout.lethal] : TACTICAL_MAP[p.loadout.tactical];
    if (!def) return;
    if ((type === 'lethal' ? p.lethal : p.tactical) <= 0) return;
    if (p.nextGrenade && this.time < p.nextGrenade) return;
    p.nextGrenade = this.time + 1.1;
    if (type === 'lethal') p.lethal--; else p.tactical--;

    const eye = eyePos(p);
    const dir = dirFromAngles(p.yaw, p.pitch);
    const pos = { x: eye.x + dir.x * 0.5, y: eye.y - 0.1, z: eye.z + dir.z * 0.5 };
    const speed = 16;
    const e = {
      id: this.entitySeq++, kind: 'grenade', gtype: def.id, effect: def.effect || null,
      pos, vel: { x: dir.x * speed, y: dir.y * speed + 3.2, z: dir.z * speed },
      owner: p.id, team: p.team, fuse: def.fuse, def,
      attach: null, spin: this.rng.next() * 6
    };
    this.entities.push(e);
    this.events.push({ t: 'throw', by: p.id, team: p.team, kind: def.id, pos, vel: e.vel, effect: e.effect });
  }

  explodeGrenade(e) {
    const def = e.def;
    if (def.effect === 'smoke') {
      this.entities.push({
        id: this.entitySeq++, kind: 'smoke', pos: { ...e.pos }, radius: def.radius,
        until: this.time + def.duration, owner: e.owner, team: e.team
      });
      this.events.push({ t: 'smoke', pos: e.pos, radius: def.radius, until: this.time + def.duration });
      return;
    }
    if (def.effect === 'flash' || def.effect === 'stun') {
      const affected = [];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const eye = eyePos(p);
        const d = dist(eye, e.pos);
        if (d > def.radius) continue;
        if (!hasLineOfSight(this.world, e.pos, eye)) continue;
        const strength = 1 - d / def.radius;
        const duration = def.duration * (0.4 + strength * 0.8);
        if (def.effect === 'flash') p.flash = Math.max(p.flash, duration);
        else p.stun = Math.max(p.stun, duration);
        affected.push({ id: p.id, strength });
      }
      this.events.push({ t: 'flash', pos: e.pos, kind: def.effect, affected });
      return;
    }
    // Damage grenades
    this.explosion(e.pos, def.radius, def.damage, this.players.get(e.owner) || null, def.id);
    if (def.burn) {
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (dist(eyePos(p), e.pos) > def.radius) continue;
        p.burning = { until: this.time + def.burn.duration, tick: 0.4, owner: e.owner };
      }
    }
  }

  explosion(pos, radius, damage, attacker, source) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const eye = eyePos(p);
      const d = dist(eye, pos);
      if (d > radius) continue;
      const feet = { x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z };
      if (!hasLineOfSight(this.world, pos, feet)) continue;
      const falloff = 1 - d / radius;
      const dmg = damage * (0.35 + falloff * 0.65) * this.rules.damageMul;
      const friendly = attacker && attacker !== p && this.mode.teams && attacker.team === p.team;
      if (friendly && !this.rules.friendlyFire) continue;
      this.applyDamage(p, dmg, attacker, source || 'explosion');
    }
    for (const s of this.entities) {
      if (s.kind === 'sentry' && !s.dead && dist(s.pos, pos) < radius) {
        this.damageSentry(s, damage * 0.6, attacker);
      }
    }
    this.events.push({ t: 'explosion', pos, radius, source: source || 'frag' });
  }

  /* --------------------------- killstreaks ----------------------------- */

  useStreak(p, index, target) {
    const id = p.streaksReady[index];
    if (!id) return;
    p.streaksReady.splice(index, 1);
    const def = KILLSTREAK_MAP[id];
    if (!def) return;

    switch (id) {
      case 'uav':
      case 'counteruav': {
        const team = p.team;
        this.state[team] = this.state[team] || {};
        this.state[team][id + 'Until'] = this.time + def.duration;
        this.events.push({ t: 'streak', by: p.id, name: p.name, team, id });
        break;
      }
      case 'carepackage': {
        const eye = eyePos(p);
        const dir = dirFromAngles(p.yaw, p.pitch);
        const drop = { x: eye.x + dir.x * 6, y: eye.y + 2, z: eye.z + dir.z * 6 };
        this.entities.push({
          id: this.entitySeq++, kind: 'crate', pos: drop, vel: { x: 0, y: -6, z: 0 },
          owner: p.id, team: p.team, taken: false
        });
        this.events.push({ t: 'streak', by: p.id, name: p.name, team: p.team, id, pos: drop });
        break;
      }
      case 'sentry': {
        const eye = eyePos(p);
        const dir = dirFromAngles(p.yaw, p.pitch);
        const pos = { x: eye.x + dir.x * 1.6, y: p.pos.y, z: eye.z + dir.z * 1.6 };
        this.entities.push({
          id: this.entitySeq++, kind: 'sentry', pos, vel: { x: 0, y: 0, z: 0 },
          health: 250, owner: p.id, team: p.team, nextShot: 0, yaw: p.yaw
        });
        this.events.push({ t: 'streak', by: p.id, name: p.name, team: p.team, id, pos });
        break;
      }
      case 'predator': {
        const point = target ? { x: target.x, y: 60, z: target.z } : null;
        if (!point) { p.streaksReady.unshift(id); return; }
        this.entities.push({
          id: this.entitySeq++, kind: 'missile', pos: { x: point.x, y: 70, z: point.z },
          vel: { x: 0, y: -55, z: 0 }, owner: p.id, team: p.team, groundY: 1
        });
        this.events.push({ t: 'streak', by: p.id, name: p.name, team: p.team, id, pos: point });
        break;
      }
      case 'helicopter': {
        const center = { x: 0, y: 22, z: 0 };
        this.entities.push({
          id: this.entitySeq++, kind: 'heli', pos: { x: center.x + 18, y: center.y, z: center.z },
          vel: { x: 0, y: 0, z: 0 }, owner: p.id, team: p.team, health: 400,
          until: this.time + def.duration, angle: 0, nextShot: 0
        });
        this.events.push({ t: 'streak', by: p.id, name: p.name, team: p.team, id });
        break;
      }
    }
  }

  damageSentry(sentry, dmg, attacker) {
    sentry.health -= dmg;
    this.events.push({ t: 'sentryHit', id: sentry.id, dmg: Math.round(dmg), by: attacker?.id });
    if (sentry.health <= 0) {
      sentry.dead = true;
      this.explosion(sentry.pos, 4, 60, this.players.get(sentry.owner) || null, 'sentry');
      this.events.push({ t: 'sentryDestroyed', id: sentry.id });
    }
  }

  /* ----------------------------- entities ------------------------------ */

  updateEntities(dt) {
    for (const e of this.entities) {
      if (e.dead) continue;
      switch (e.kind) {
        case 'grenade': this.tickGrenade(e, dt); break;
        case 'crate': this.tickCrate(e, dt); break;
        case 'sentry': this.tickSentry(e, dt); break;
        case 'missile': this.tickMissile(e, dt); break;
        case 'heli': this.tickHeli(e, dt); break;
        case 'smoke': if (e.until < this.time) e.dead = true; break;
      }
    }
    this.entities = this.entities.filter((e) => !e.dead);
  }

  tickGrenade(e, dt) {
    e.fuse -= dt;
    if (e.attach) {
      const host = this.players.get(e.attach);
      if (host && host.alive) {
        e.pos = { x: host.pos.x, y: host.pos.y + 0.9, z: host.pos.z };
      } else {
        e.attach = null;
        e.resting = true;
      }
      if (e.fuse <= 0) { e.dead = true; this.explodeGrenade(e); }
      return;
    }
    if (e.resting) {
      if (e.fuse <= 0) { e.dead = true; this.explodeGrenade(e); }
      return;
    }
    e.vel.y -= 24 * dt;
    const next = { x: e.pos.x + e.vel.x * dt, y: e.pos.y + e.vel.y * dt, z: e.pos.z + e.vel.z * dt };
    const probe = { x: next.x, y: next.y, z: next.z, hx: 0.12, hy: 0.12, hz: 0.12 };
    const hitBox = worldProbe(this.world, probe);
    if (hitBox) {
      if (e.def.kind === 'stick') {
        e.pos = { ...next };
        e.vel = { x: 0, y: 0, z: 0 };
        // Stick to a player if we hit one, otherwise to the surface.
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          if (dist(p.pos, next) < 1.1) { e.attach = p.id; break; }
        }
        if (!e.attach) e.resting = true;
      } else {
        // Bounce.
        const n = boxNormalFor(hitBox, next);
        const d = { x: e.vel.x, y: e.vel.y, z: e.vel.z };
        const k = d.x * n.x + d.y * n.y + d.z * n.z;
        e.vel = {
          x: (d.x - 2 * k * n.x) * 0.45,
          y: (d.y - 2 * k * n.y) * 0.45,
          z: (d.z - 2 * k * n.z) * 0.45
        };
        e.pos = { ...next };
        // Settle instead of jittering forever.
        if (Math.abs(e.vel.x) + Math.abs(e.vel.y) + Math.abs(e.vel.z) < 1.4) e.resting = true;
      }
      this.events.push({ t: 'bounce', id: e.id, pos: e.pos });
    } else {
      e.pos = next;
    }
    if (e.pos.y < -5) { e.dead = true; return; }
    if (e.fuse <= 0) { e.dead = true; this.explodeGrenade(e); }
  }

  tickCrate(e, dt) {
    e.vel.y -= 20 * dt;
    const next = { x: e.pos.x, y: e.pos.y + e.vel.y * dt, z: e.pos.z };
    const probe = { x: next.x, y: next.y, z: next.z, hx: 0.5, hy: 0.5, hz: 0.5 };
    if (worldProbe(this.world, probe) || next.y < 0.5) {
      const g = snapToGround(this.world, { x: next.x, y: Math.max(0.5, next.y), z: next.z }, 30);
      e.pos = { x: next.x, y: g.y + 0.5, z: next.z };
      e.vel = { x: 0, y: 0, z: 0 };
      this.events.push({ t: 'crateLanded', id: e.id, pos: e.pos });
    } else {
      e.pos = next;
    }
  }

  tickSentry(e, dt) {
    const target = this.acquireTarget(e, 45);
    if (target) {
      const eye = eyePos(target);
      const desired = Math.atan2(-(eye.x - e.pos.x), -(eye.z - e.pos.z));
      e.yaw = turnToward(e.yaw, desired, 4 * dt);
      if (this.time >= e.nextShot && Math.abs(angDiffSmall(e.yaw, desired)) < 0.25) {
        e.nextShot = this.time + 0.35;
        const origin = { x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z };
        const dir = norm(sub(eye, origin));
        const hit = this.hitscan({ id: e.owner, perks: new Set(), team: e.team }, origin, spreadDir(dir, 1.2, this.rng), null);
        if (hit.type === 'player') {
          this.applyDamage(hit.player, 18 * this.rules.damageMul, this.players.get(e.owner) || null, 'sentry');
        }
        this.events.push({ t: 'shot', by: e.owner, team: e.team, pos: origin, ends: [hit.point], weapon: 'sentry', silent: false, sentry: e.id });
      }
    }
  }

  tickMissile(e, dt) {
    e.pos.y += e.vel.y * dt;
    const g = snapToGround(this.world, { x: e.pos.x, y: 40, z: e.pos.z }, 40);
    if (e.pos.y <= g.y + 0.5) {
      e.dead = true;
      this.explosion(e.pos, 9, 200, this.players.get(e.owner) || null, 'predator');
      this.events.push({ t: 'explosion', pos: e.pos, radius: 9, source: 'predator' });
    }
  }

  tickHeli(e, dt) {
    if (this.time > e.until || e.health <= 0) {
      e.dead = true;
      this.explosion(e.pos, 5, 40, null, 'heli');
      return;
    }
    e.angle += dt * 0.6;
    const r = 20;
    const target = this.acquireTarget(e, 70, true);
    const tx = target ? target.pos.x : Math.cos(e.angle) * r;
    const tz = target ? target.pos.z : Math.sin(e.angle) * r;
    const ty = target ? Math.max(16, target.pos.y + 18) : 22;
    e.pos.x = lerp(e.pos.x, tx + Math.cos(e.angle) * 8, 1.4 * dt);
    e.pos.z = lerp(e.pos.z, tz + Math.sin(e.angle) * 8, 1.4 * dt);
    e.pos.y = lerp(e.pos.y, ty, 1.2 * dt);
    if (target && this.time >= e.nextShot) {
      e.nextShot = this.time + 0.25;
      const origin = { ...e.pos };
      if (hasLineOfSight(this.world, origin, eyePos(target))) {
        this.applyDamage(target, 12 * this.rules.damageMul, this.players.get(e.owner) || null, 'heli');
        this.events.push({ t: 'shot', by: e.owner, team: e.team, pos: origin, ends: [eyePos(target)], weapon: 'heli', silent: false });
      }
    }
    this.events.push({ t: 'heliPos', id: e.id, pos: e.pos, team: e.team });
  }

  acquireTarget(from, range, allowAir = false) {
    let best = null, bestScore = -Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (this.mode.teams && p.team === from.team) continue;
      if (p.perks.has('coldblooded')) continue;
      const d = dist(from.pos, p.pos);
      if (d > range) continue;
      if (!hasLineOfSight(this.world, { x: from.pos.x, y: from.pos.y + (allowAir ? 0 : 1.2), z: from.pos.z }, eyePos(p))) continue;
      const score = -d + (p.streak * 2);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /* ------------------------------ queries ------------------------------ */

  isHostile(a, b) {
    if (!a || !b) return false;
    if (a === b) return false;
    if (!this.mode.teams) return true;
    return a.team !== b.team;
  }

  alivePlayers(team) {
    const out = [];
    for (const p of this.players.values()) if (p.alive && (!team || p.team === team)) out.push(p);
    return out;
  }

  uavActive(team) { return (this.state[team]?.uavUntil || 0) > this.time; }
  jammed(team) { return (this.state[team]?.counteruavUntil || 0) > this.time; }

  scoreboard() {
    const list = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths,
      assists: p.assists, score: p.score, streak: p.streak, isBot: p.isBot,
      objective: p.objective, ping: p.ping ?? 0
    }));
    list.sort((a, b) => b.score - a.score || b.kills - a.kills);
    return {
      players: list,
      teams: { a: this.teams.a.score, b: this.teams.b.score },
      timeLeft: this.timeLeft,
      over: this.over,
      winner: this.winner,
      flags: this.state.flags ? this.state.flags.map((f) => ({ id: f.id, owner: f.owner, progress: f.progress, team: f.team })) : null,
      round: this.state.round ? { ...this.state.round } : null
    };
  }

  /** Per-recipient snapshot (health only for the owner, no enemy HP in hardcore). */
  snapshotFor(viewerId) {
    const players = [];
    for (const p of this.players.values()) {
      const own = p.id === viewerId;
      players.push({
        id: p.id, name: p.name, team: p.team, isBot: p.isBot,
        x: round3(p.pos.x), y: round3(p.pos.y), z: round3(p.pos.z),
        yaw: round3(p.yaw), pitch: round3(p.pitch),
        crouch: p.crouching, sprint: p.sprinting, alive: p.alive,
        health: own || (this.rules.enemyHealthBars && this.mode.teams && p.team === this.players.get(viewerId)?.team) ? Math.max(0, Math.round(p.health)) : undefined,
        maxHealth: own ? p.maxHealth : undefined,
        slot: p.slot, weapon: p.weapons[p.slot]?.id,
        ammo: own ? p.weapons[p.slot]?.ammo : undefined,
        reserve: own ? p.weapons[p.slot]?.reserve : undefined,
        reloading: own ? p.reloading : (this.rules.enemyHealthBars ? p.reloading : false),
        kills: p.kills, deaths: p.deaths, score: p.score, streak: p.streak,
        streaksReady: own ? p.streaksReady : undefined,
        lethal: own ? p.lethal : undefined,
        tactical: own ? p.tactical : undefined,
        flash: own ? p.flash : undefined,
        stun: own ? p.stun : undefined,
        bomb: !!p.hasBomb,
        ads: !!p.input.ads,
        resync: own ? !!p.resync : undefined
      });
    }
    for (const p of this.players.values()) if (p.id === viewerId) p.resync = false;
    return {
      time: round3(this.time),
      timeLeft: Number.isFinite(this.timeLeft) ? Math.max(0, Math.round(this.timeLeft)) : -1,
      over: this.over,
      winner: this.winner,
      mode: this.modeId,
      map: this.mapId,
      ruleset: this.rules.id,
      scoreLimit: this.scoreLimit,
      teams: { a: this.teams.a.score, b: this.teams.b.score },
      players,
      entities: this.entities.map((e) => ({
        id: e.id, kind: e.kind, team: e.team, owner: e.owner,
        x: round3(e.pos.x), y: round3(e.pos.y), z: round3(e.pos.z),
        radius: e.radius, until: e.until, health: e.health
      })),
      flags: this.state.flags ? this.state.flags.map((f) => ({ id: f.id, owner: f.owner, progress: round2(f.progress), team: f.team })) : null,
      round: this.state.round ? sanitizeRound(this.state.round) : null,
      uav: {
        a: this.uavActive('a'), b: this.uavActive('b'),
        ffa: this.uavActive('ffa'),
        jamA: this.jammed('a'), jamB: this.jammed('b'), jamFfa: this.jammed('ffa')
      },
      scoreboard: this.scoreboard()
    };
  }
}

function sanitizeRound(r) {
  return {
    num: r.num, phase: r.phase, timer: Math.max(0, Math.round(r.timer)),
    attackers: r.attackers, defenders: r.defenders,
    planted: !!r.bomb.planted, site: r.bomb.site || null,
    bombPos: r.bomb.pos ? { x: round2(r.bomb.pos.x), y: round2(r.bomb.pos.y), z: round2(r.bomb.pos.z) } : null,
    carrier: r.bomb.carrier || null,
    plantProgress: round2(r.plantProgress || 0),
    defuseProgress: round2(r.defuseProgress || 0),
    winner: r.winner || null
  };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function emptyInput() {
  return {
    mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, ads: false, jump: false,
    crouch: false, sprint: false, reload: false, slot: 0, grenade: null,
    streak: null, action: false, target: null, x: null, y: null, z: null
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

export function spreadDir(base, spreadDeg, rng) {
  if (spreadDeg <= 0.001) return base;
  const rad = spreadDeg * Math.PI / 180;
  const a = rng.next() * Math.PI * 2;
  const r = Math.sqrt(rng.next()) * Math.tan(rad);
  // Build an orthonormal basis around base.
  const up = Math.abs(base.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let right = norm(crossUp(base, up));
  const realUp = norm(crossUp(right, base));
  const d = norm({
    x: base.x + right.x * Math.cos(a) * r + realUp.x * Math.sin(a) * r,
    y: base.y + right.y * Math.cos(a) * r + realUp.y * Math.sin(a) * r,
    z: base.z + right.z * Math.cos(a) * r + realUp.z * Math.sin(a) * r
  });
  return d;
}

function crossUp(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function raySphere(origin, dir, center, radius) {
  const oc = sub(origin, center);
  const b = oc.x * dir.x + oc.y * dir.y + oc.z * dir.z;
  const c = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

function worldProbe(world, box) {
  return collides(world, box);
}

function boxNormalFor(box, p) {
  const ex = Math.abs(p.x - box.x) - box.hx;
  const ey = Math.abs(p.y - box.y) - box.hy;
  const ez = Math.abs(p.z - box.z) - box.hz;
  const mx = Math.max(ex, ey, ez);
  if (mx === ex) return { x: Math.sign(p.x - box.x), y: 0, z: 0 };
  if (mx === ey) return { x: 0, y: Math.sign(p.y - box.y), z: 0 };
  return { x: 0, y: 0, z: Math.sign(p.z - box.z) };
}

function angDiffSmall(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(current, target, maxStep) {
  const d = angDiffSmall(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}
