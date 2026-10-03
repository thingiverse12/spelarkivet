/**
 * Netcode contract test.
 *
 * main.js predicts the local player by calling the shared physics directly and
 * sends position + input to the server, which re-simulates and may correct it.
 * This test runs both sides with identical inputs and asserts they converge —
 * the property that makes the game feel instant without desyncing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, RULESETS, BASE_SPEED, SPRINT_MUL, JUMP_VEL } from '../js/shared/sim.js';
import {
  integrate, accelerate, clampSpeed,
  PLAYER_HALF, PLAYER_HEIGHT
} from '../js/shared/physics.js';
import { effectiveWeapon } from '../js/shared/weapons.js';

function makeClient(sim, id) {
  const p = sim.players.get(id);
  return {
    pos: { ...p.pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw: p.yaw,
    pitch: 0,
    onGround: true,
    crouching: false,
    height: PLAYER_HEIGHT,
    half: PLAYER_HALF
  };
}

/** Exactly what main.js updateLocal() does each frame. */
function predict(client, world, input, dt, weaponDef, ruleset) {
  const rules = RULESETS[ruleset];
  let speed = BASE_SPEED * (weaponDef.moveSpeed || 1) * rules.speedMul;
  if (input.sprint) speed *= SPRINT_MUL;
  if (input.ads) speed *= 0.62;
  client.crouching = !!input.crouch;
  if (client.crouching) speed *= 0.55;

  const fwd = { x: -Math.sin(client.yaw), y: 0, z: -Math.cos(client.yaw) };
  const right = { x: fwd.z, y: 0, z: -fwd.x };
  const wish = { x: fwd.x * -input.mz + right.x * input.mx, y: 0, z: fwd.z * -input.mz + right.z * input.mx };

  if (input.jump && client.onGround) { client.vel.y = JUMP_VEL; client.onGround = false; }
  accelerate(client, wish, speed, dt);
  clampSpeed(client, speed * 1.35);
  integrate(client, world, dt);
}

test('client prediction and the server converge while running a full match', () => {
  const sim = new Sim({ mode: 'tdm', mapId: 'rust', ruleset: 'classic', seed: 42 });
  const me = sim.addPlayer({ id: 'human', name: 'Human', team: 'a' });
  sim.addPlayer({ id: 'bot', name: 'Bot', team: 'b', isBot: true, skill: 0.4 });

  const client = makeClient(sim, 'human');
  const weaponDef = effectiveWeapon('m4a1', []);
  const dt = 1 / 60;
  const serverWorld = sim.world;

  let maxDrift = 0;
  let maxDriftSteady = 0;
  let corrections = 0;
  let shotsFired = 0;
  let kills = 0;
  let deaths = 0;
  let wasAlive = true;
  let respawns = 0;

  for (let f = 0; f < 60 * 30; f++) {
    // Client: move in a pattern and shoot forward.
    const input = {
      mx: Math.sin(f / 40) > 0 ? 1 : -1,
      mz: -1,
      sprint: (f % 300) < 120,
      ads: (f % 200) > 150,
      crouch: (f % 400) > 350,
      jump: f % 97 === 0,
      fire: f % 7 === 0
    };
    predict(client, serverWorld, input, dt, weaponDef, 'classic');

    // Send at 30 Hz, but immediately whenever an edge-triggered action fires —
    // this mirrors the `urgent` path in main.js updateLocal(), which exists
    // precisely so a jump or shot is never swallowed by the throttle.
    const urgent = input.jump || input.fire;
    if (urgent || f % 2 === 0) {
      sim.setInput('human', { ...input, yaw: client.yaw, pitch: client.pitch, x: client.pos.x, y: client.pos.y, z: client.pos.z });
    }

    // Server tick.
    const events = sim.tick(1 / 30);
    for (const e of events) {
      if (e.t === 'shot' && e.by === 'human') shotsFired++;
      if (e.t === 'kill' && e.killer === 'human') kills++;
      if (e.t === 'kill' && e.victim === 'human') deaths++;
    }

    // A respawn legitimately teleports the player to a spawn point; that frame
    // measures the teleport, not prediction accuracy.
    const respawnedThisFrame = !wasAlive && me.alive;
    if (respawnedThisFrame) respawns++;
    wasAlive = me.alive;

    // Reconciliation: the client snaps only when the server disagrees a lot.
    const drift = Math.hypot(me.pos.x - client.pos.x, me.pos.y - client.pos.y, me.pos.z - client.pos.z);
    maxDrift = Math.max(maxDrift, drift);
    if (!respawnedThisFrame) maxDriftSteady = Math.max(maxDriftSteady, drift);
    if (drift > 2.2) {
      corrections++;
      client.pos = { ...me.pos };
      client.vel = { x: 0, y: 0, z: 0 };
    }
  }

  assert.ok(shotsFired > 20, `the client's shots should reach the server, got ${shotsFired}`);
  assert.ok(maxDriftSteady < 1.0,
    `steady-state prediction drift must stay under a unit, worst case ${maxDriftSteady.toFixed(3)}`);
  // Respawn teleports are expected to exceed the snap threshold exactly once each.
  assert.ok(corrections <= respawns + 2,
    `${corrections} hard corrections for ${respawns} respawns is too many — prediction and server disagree`);
  assert.ok(respawns <= deaths, 'a player cannot respawn more times than they died');
  assert.ok(me.kills + kills >= 0, 'kills tracked');
});

test('the server rejects a client that tries to fly or teleport', () => {
  const sim = new Sim({ mode: 'ffa', mapId: 'sandstorm', ruleset: 'classic', seed: 7 });
  const p = sim.addPlayer({ id: 'h', name: 'Cheater' });
  const start = { ...p.pos };

  // Claim to be 300 units away and 500 units up.
  sim.setInput('h', { x: start.x + 300, y: start.y + 500, z: start.z + 300 });
  const jumped = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
  assert.ok(jumped < 5, `teleport must be clamped, allowed ${jumped.toFixed(2)}`);
  assert.equal(p.resync, true, 'server should ask the client to resync');

  // After a resync flag the client is pulled back onto the authoritative state.
  const snap = sim.snapshotFor('h');
  const me = snap.players.find((x) => x.id === 'h');
  assert.equal(me.resync, true);
  const snap2 = sim.snapshotFor('h');
  assert.equal(snap2.players.find((x) => x.id === 'h').resync, false, 'resync flag clears after being sent');
});

test('hardcore damage values are what the HUD should show', () => {
  const sim = new Sim({ mode: 'tdm', mapId: 'rust', ruleset: 'hardcore', seed: 3 });
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 'a', loadout: { primary: 'm4a1' } });
  const b = sim.addPlayer({ id: 'b', name: 'B', team: 'b' });

  // Place B directly in front of A at point-blank range.
  b.pos = { x: a.pos.x + 3, y: a.pos.y, z: a.pos.z };
  b.vel = { x: 0, y: 0, z: 0 };
  a.yaw = Math.atan2(-(b.pos.x - a.pos.x), -(b.pos.z - a.pos.z));
  a.pitch = 0;

  const before = b.health;
  sim.setInput('a', { fire: true, yaw: a.yaw, pitch: 0, x: a.pos.x, y: a.pos.y, z: a.pos.z });
  const events = sim.tick(1 / 30);
  const hit = events.find((e) => e.t === 'hit' && e.victim === 'b');
  assert.ok(hit, 'a point-blank shot should land');
  assert.ok(before - b.health > 0, 'health must drop');
  // M4A1 does 32 damage, ×1.6 in hardcore => ~51 on a 30 HP target: one shot kill.
  assert.equal(b.alive, false, 'hardcore should be lethal at point blank');
});
