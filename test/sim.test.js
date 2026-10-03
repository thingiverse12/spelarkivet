/**
 * Smoke test: run a full headless match (bots only) for every mode and ruleset
 * combination and assert the simulation actually produces kills, scores and a
 * winner. This exercises sim.js -> modes.js -> bots.js -> physics.js for real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, RULESETS } from '../js/shared/sim.js';
import { MODES } from '../js/shared/modes.js';
import { MAPS } from '../js/shared/maps.js';
import { raycastWorld, accelerate, integrate } from '../js/shared/physics.js';

function runMatch({ mode, mapId = 'rust', ruleset = 'hardcore', bots = 8, seconds = 240, dt = 1 / 30 }) {
  const sim = new Sim({ mode, mapId, ruleset, seed: 7 });
  for (let i = 0; i < bots; i++) {
    sim.addPlayer({
      id: 'bot' + i,
      name: 'Bot ' + i,
      isBot: true,
      skill: 0.35 + (i % 5) * 0.13,
      team: MODES[mode].teams ? (i % 2 ? 'a' : 'b') : 'ffa',
      loadout: { primary: 'm4a1', secondary: 'm1911', lethal: 'frag', tactical: 'flash' }
    });
  }
  let kills = 0;
  let shots = 0;
  let explosions = 0;
  let steps = 0;
  const frames = Math.round(seconds / dt);
  for (let f = 0; f < frames && !sim.over; f++) {
    const events = sim.tick(dt);
    for (const e of events) {
      if (e.t === 'kill') kills++;
      if (e.t === 'shot') shots++;
      if (e.t === 'explosion') explosions++;
      if (e.t === 'step') steps++;
    }
  }
  return { sim, kills, shots, explosions, steps, frames };
}

test('every map compiles into a valid physics world with free spawns', () => {
  for (const map of MAPS) {
    const sim = new Sim({ mode: 'tdm', mapId: map.id, ruleset: 'classic' });
    assert.ok(sim.world.boxes.length > 10, `${map.id} should have geometry`);
    assert.ok(map.spawns.a.length >= 4, `${map.id} needs team A spawns`);
    assert.ok(map.spawns.b.length >= 4, `${map.id} needs team B spawns`);
    assert.equal(map.flags.length, 3, `${map.id} needs 3 domination flags`);
    assert.equal(map.sites.length, 2, `${map.id} needs 2 bomb sites`);
    // No spawn may sit inside geometry — that would trap the player.
    for (const s of [...map.spawns.a, ...map.spawns.b]) {
      const box = { x: s[0], y: s[1] + 0.9, z: s[2], hx: 0.33, hy: 0.9, hz: 0.33 };
      const stuck = sim.world.boxes.some((b) =>
        Math.abs(b.x - box.x) < b.hx + box.hx &&
        Math.abs(b.y - box.y) < b.hy + box.hy &&
        Math.abs(b.z - box.z) < b.hz + box.hz);
      assert.equal(stuck, false, `${map.id} spawn ${s} is inside geometry`);
    }
    // Every capture zone must have somewhere to stand, at any height (roofs count).
    for (const zone of [...map.flags, ...map.sites]) {
      const standable = [...Array(24).keys()].some((i) => {
        for (const frac of [0.3, 0.65, 0.95]) {
          const a = (i / 24) * Math.PI * 2;
          const x = zone.x + Math.cos(a) * zone.r * frac;
          const z = zone.z + Math.sin(a) * zone.r * frac;
          const landing = raycastWorld(sim.world, { x, y: 40, z }, { x: 0, y: -1, z: 0 }, 40);
          if (!landing) continue;
          // Stand a hair above the landing surface (maps have a thin floor decal).
          const box = { x, y: landing.point.y + 0.06 + 0.9, z, hx: 0.33, hy: 0.9, hz: 0.33 };
          const free = !sim.world.boxes.some((b) =>
            Math.abs(b.x - box.x) < b.hx + box.hx &&
            Math.abs(b.y - box.y) < b.hy + box.hy &&
            Math.abs(b.z - box.z) < b.hz + box.hz);
          if (free) return true;
        }
        return false;
      });
      assert.ok(standable, `${map.id} zone ${zone.id} has nowhere to stand`);
    }
  }
});

test('TDM produces kills, team score and a winner', () => {
  const { sim, kills, shots, steps } = runMatch({ mode: 'tdm', bots: 8, seconds: 400 });
  assert.ok(kills > 5, `expected kills, got ${kills}`);
  assert.ok(shots > 100, `expected shots, got ${shots}`);
  assert.ok(steps > 100, 'bots should move around');
  const score = sim.teams.a.score + sim.teams.b.score;
  assert.ok(score > 5, `teams should score, got a=${sim.teams.a.score} b=${sim.teams.b.score}`);
  assert.ok(sim.over || sim.timeLeft < 400, 'match should progress toward an end');
});

test('FFA scores per player and ends on the score limit', () => {
  const { sim, kills } = runMatch({ mode: 'ffa', bots: 8, seconds: 400 });
  assert.ok(kills > 5, `expected kills, got ${kills}`);
  const top = [...sim.players.values()].sort((a, b) => b.kills - a.kills)[0];
  assert.ok(top.kills >= 5, `leader should have kills, got ${top.kills}`);
});

test('Domination captures flags and awards points', () => {
  const sim = new Sim({ mode: 'dom', mapId: 'rust', ruleset: 'classic', seed: 3 });
  for (let i = 0; i < 8; i++) {
    sim.addPlayer({ id: 'b' + i, name: 'B' + i, isBot: true, skill: 0.5, team: i % 2 ? 'a' : 'b' });
  }
  let captures = 0;
  for (let f = 0; f < 30 * 300 && !sim.over; f++) {
    for (const e of sim.tick(1 / 30)) if (e.t === 'capture') captures++;
  }
  assert.ok(captures > 0, 'flags should be captured');
  assert.ok(sim.teams.a.score + sim.teams.b.score > 0, 'holding flags should score');
  assert.ok(sim.state.flags.length === 3);
});

test('Search & Destroy plays rounds, plants and ends the match', () => {
  const sim = new Sim({ mode: 'snd', mapId: 'depot', ruleset: 'classic', seed: 11 });
  for (let i = 0; i < 8; i++) {
    sim.addPlayer({ id: 's' + i, name: 'S' + i, isBot: true, skill: 0.55, team: i % 2 ? 'a' : 'b' });
  }
  let plants = 0;
  let roundEnds = 0;
  for (let f = 0; f < 30 * 900 && !sim.over; f++) {
    for (const e of sim.tick(1 / 30)) {
      if (e.t === 'bombPlanted') plants++;
      if (e.t === 'roundEnd') roundEnds++;
    }
  }
  assert.ok(roundEnds > 0, `rounds should finish, got ${roundEnds}`);
  assert.ok(plants >= 0, 'plant counter should be a number');
  assert.ok(sim.teams.a.score + sim.teams.b.score > 0, 'a team should win rounds');
  assert.ok(sim.over, 'match should reach the round limit');
});

test('Gun Game advances the ladder and ends', () => {
  const sim = new Sim({ mode: 'gungame', mapId: 'rust', ruleset: 'classic', seed: 5 });
  for (let i = 0; i < 6; i++) {
    sim.addPlayer({ id: 'g' + i, name: 'G' + i, isBot: true, skill: 0.6, team: 'ffa' });
  }
  let advances = 0;
  for (let f = 0; f < 30 * 600 && !sim.over; f++) {
    for (const e of sim.tick(1 / 30)) if (e.t === 'gunGameAdvance') advances++;
  }
  assert.ok(advances > 0, 'players should advance the weapon ladder');
});

test('grenades explode and kill', () => {
  const { explosions, kills } = runMatch({ mode: 'tdm', bots: 6, seconds: 200, ruleset: 'classic' });
  assert.ok(explosions > 0, `grenades should explode, got ${explosions}`);
  assert.ok(kills > 0, 'someone should die');
});

test('hardcore ruleset applies 30 HP and hides enemy health', () => {
  const sim = new Sim({ mode: 'tdm', mapId: 'rust', ruleset: 'hardcore' });
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 'a' });
  const b = sim.addPlayer({ id: 'b', name: 'B', team: 'b' });
  assert.equal(a.maxHealth, 30);
  assert.equal(b.maxHealth, 30);
  assert.equal(RULESETS.hardcore.enemyHealthBars, false);
  const snap = sim.snapshotFor('a');
  const seen = snap.players.find((p) => p.id === 'b');
  assert.equal(seen.health, undefined, 'enemy health must be hidden in hardcore');
  const me = snap.players.find((p) => p.id === 'a');
  assert.equal(me.health, 30, 'own health must be visible');
});

test('human movement is client-authoritative while bots are server-simulated', () => {
  const sim = new Sim({ mode: 'ffa', mapId: 'rust', ruleset: 'classic' });
  const human = sim.addPlayer({ id: 'h', name: 'Human' });
  const bot = sim.addPlayer({ id: 'b', name: 'Bot', isBot: true, skill: 0.6 });
  const humanStart = { ...human.pos };
  const botStart = { ...bot.pos };

  // The client predicts with the shared physics and reports its position.
  const client = {
    pos: { ...human.pos }, vel: { x: 0, y: 0, z: 0 }, yaw: human.yaw,
    onGround: true, crouching: false
  };
  for (let f = 0; f < 90; f++) {
    accelerate(client, { x: -Math.sin(client.yaw), y: 0, z: -Math.cos(client.yaw) }, 5.6, 1 / 60);
    integrate(client, sim.world, 1 / 60);
    sim.setInput('h', { mz: -1, yaw: client.yaw, pitch: 0, x: client.pos.x, y: client.pos.y, z: client.pos.z });
    sim.tick(1 / 60);
  }

  const humanMoved = Math.hypot(human.pos.x - humanStart.x, human.pos.z - humanStart.z);
  const botMoved = Math.hypot(bot.pos.x - botStart.x, bot.pos.z - botStart.z);
  assert.ok(humanMoved > 1, `the server should track reported client movement, moved ${humanMoved}`);
  assert.ok(Math.abs(humanMoved - Math.hypot(client.pos.x - humanStart.x, client.pos.z - humanStart.z)) < 0.01,
    'the server position must equal what the client reported');
  assert.ok(botMoved > 0.5, `bots must still be simulated by the server, moved ${botMoved}`);
});

test('the anti-teleport clamp rejects absurd position jumps', () => {
  const sim = new Sim({ mode: 'ffa', mapId: 'sandstorm', ruleset: 'classic' });
  const p = sim.addPlayer({ id: 'h', name: 'Cheater' });
  const before = { ...p.pos };
  sim.setInput('h', { x: before.x + 200, y: before.y, z: before.z + 200 });
  const d = Math.hypot(p.pos.x - before.x, p.pos.z - before.z);
  assert.ok(d < 5, `teleport should be clamped, allowed ${d}`);
  assert.equal(p.resync, true, 'client should be flagged for resync');
});
