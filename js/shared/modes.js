/**
 * Game modes. Each mode is a small plugin the simulation calls into.
 */
import { gunGameWeapon, GUN_GAME_LADDER } from './weapons.js';

function teamSpawns(sim, team) {
  return team === 'a' ? sim.map.spawns.a : sim.map.spawns.b;
}
function allSpawns(sim) {
  return [...sim.map.spawns.a, ...sim.map.spawns.b];
}

/* ------------------------------------------------------------------ */
/* Team Deathmatch                                                     */
/* ------------------------------------------------------------------ */

const tdm = {
  id: 'tdm',
  name: 'Team Deathmatch',
  nameSv: 'Team Deathmatch',
  short: 'TDM',
  teams: true,
  respawn: true,
  usesTimer: true,
  teamSize: 6,
  minPlayers: 2,
  desc: 'Two teams race to the score limit.',
  descSv: 'Två lag jagar poänggränsen.',

  scoreLimit: (sim) => sim.rules.scoreLimits.tdm,
  timeLimit: () => 600,
  init(sim) { sim.teams.a.score = 0; sim.teams.b.score = 0; },
  spawnsFor: teamSpawns,

  onKill(sim, killer, victim) {
    if (!killer) return;
    if (sim.mode.teams && killer.team === victim.team) {
      sim.teams[killer.team].score = Math.max(0, sim.teams[killer.team].score - 1);
    } else {
      sim.teams[killer.team].score++;
    }
  },

  isOver(sim) {
    return sim.teams.a.score >= sim.scoreLimit || sim.teams.b.score >= sim.scoreLimit;
  },

  winner(sim) {
    if (sim.teams.a.score === sim.teams.b.score) return 'draw';
    return sim.teams.a.score > sim.teams.b.score ? 'a' : 'b';
  },

  hud(sim) {
    return { left: sim.teams.a.score, right: sim.teams.b.score, limit: sim.scoreLimit };
  }
};

/* ------------------------------------------------------------------ */
/* Free-for-all                                                        */
/* ------------------------------------------------------------------ */

const ffa = {
  id: 'ffa',
  name: 'Free-for-All',
  nameSv: 'Alla mot alla',
  short: 'FFA',
  teams: false,
  respawn: true,
  usesTimer: true,
  teamSize: 12,
  minPlayers: 2,
  desc: 'Every soldier for themselves.',
  descSv: 'Var och en för sig själv.',

  scoreLimit: (sim) => sim.rules.scoreLimits.ffa,
  timeLimit: () => 480,
  init() {},
  spawnsFor: allSpawns,
  onJoin(sim, p) { p.team = 'ffa'; },

  onKill(sim, killer) {
    if (killer) killer.score += 0; // score already granted in kill()
  },

  isOver(sim) {
    return [...sim.players.values()].some((p) => p.kills >= sim.scoreLimit);
  },

  winner(sim) {
    const list = [...sim.players.values()].sort((a, b) => b.kills - a.kills || b.score - a.score);
    return list.length ? list[0].id : null;
  },

  hud(sim) {
    const leader = [...sim.players.values()].sort((a, b) => b.kills - a.kills)[0];
    return { left: leader ? leader.kills : 0, right: null, limit: sim.scoreLimit, label: leader?.name };
  }
};

/* ------------------------------------------------------------------ */
/* Domination                                                          */
/* ------------------------------------------------------------------ */

const dom = {
  id: 'dom',
  name: 'Domination',
  nameSv: 'Dominering',
  short: 'DOM',
  teams: true,
  respawn: true,
  usesTimer: true,
  teamSize: 6,
  minPlayers: 2,
  desc: 'Capture and hold three flags.',
  descSv: 'Ta och håll tre flaggor.',

  scoreLimit: (sim) => sim.rules.scoreLimits.dom,
  timeLimit: () => 720,

  init(sim) {
    sim.state.flags = sim.map.flags.map((f) => ({ id: f.id, x: f.x, z: f.z, r: f.r, owner: null, progress: 0, team: null }));
    sim.state.domAccum = { a: 0, b: 0 };
  },

  spawnsFor(sim, p) {
    // Spawn near a flag your team owns when possible.
    const owned = sim.state.flags.filter((f) => f.owner === p.team);
    if (owned.length) {
      const f = owned[Math.floor(sim.rng.next() * owned.length)];
      const a = sim.rng.next() * Math.PI * 2;
      const r = 6 + sim.rng.next() * 5;
      return [[f.x + Math.cos(a) * r, 0.2, f.z + Math.sin(a) * r]];
    }
    return teamSpawns(sim, p.team);
  },

  tick(sim, dt) {
    for (const flag of sim.state.flags) {
      const inside = { a: 0, b: 0 };
      for (const p of sim.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.pos.x - flag.x, p.pos.z - flag.z) <= flag.r) inside[p.team] = (inside[p.team] || 0) + 1;
      }
      const contest = inside.a > 0 && inside.b > 0;
      const holders = inside.a > 0 ? 'a' : (inside.b > 0 ? 'b' : null);
      if (contest || !holders) {
        flag.team = null;
        continue;
      }
      flag.team = holders;
      if (flag.owner === holders) { flag.progress = 0; continue; }
      const capturers = inside[holders];
      flag.progress += dt * (0.35 + 0.25 * Math.min(3, capturers));
      if (flag.progress >= 1) {
        const previous = flag.owner;
        flag.owner = holders;
        flag.progress = 0;
        sim.events.push({ t: 'capture', flag: flag.id, team: holders, previous });
        for (const p of sim.players.values()) {
          if (p.alive && p.team === holders && Math.hypot(p.pos.x - flag.x, p.pos.z - flag.z) <= flag.r + 1) {
            p.objective++;
            p.score += 150;
          }
        }
      }
    }
    // Points for holding flags: 1 point per flag per 2 seconds.
    for (const team of ['a', 'b']) {
      const held = sim.state.flags.filter((f) => f.owner === team).length;
      if (!held) continue;
      sim.state.domAccum[team] += dt * held * 0.5;
      while (sim.state.domAccum[team] >= 1) {
        sim.state.domAccum[team] -= 1;
        sim.teams[team].score++;
        sim.events.push({ t: 'domPoint', team });
      }
    }
  },

  isOver(sim) {
    return sim.teams.a.score >= sim.scoreLimit || sim.teams.b.score >= sim.scoreLimit;
  },

  winner(sim) {
    if (sim.teams.a.score === sim.teams.b.score) return 'draw';
    return sim.teams.a.score > sim.teams.b.score ? 'a' : 'b';
  },

  hud(sim) {
    return { left: sim.teams.a.score, right: sim.teams.b.score, limit: sim.scoreLimit };
  }
};

/* ------------------------------------------------------------------ */
/* Gun Game (FFA weapon ladder)                                        */
/* ------------------------------------------------------------------ */

const gungame = {
  id: 'gungame',
  name: 'Gun Game',
  nameSv: 'Vapenrace',
  short: 'GG',
  teams: false,
  respawn: true,
  usesTimer: true,
  teamSize: 10,
  minPlayers: 2,
  desc: 'Advance the weapon ladder — final kill wins.',
  descSv: 'Klättra på vapenstegen — sista skottet vinner.',

  scoreLimit: (sim) => GUN_GAME_LADDER.length,
  timeLimit: () => 600,

  init() {},
  spawnsFor: allSpawns,
  onJoin(sim, p) { p.team = 'ffa'; p.ggIndex = 0; },
  startingWeapon(p) { return gunGameWeapon(p.ggIndex || 0); },

  onSpawn(sim, p) { p.ggIndex = p.ggIndex || 0; },

  onKill(sim, killer, victim) {
    if (!killer || killer === victim) return;
    killer.ggIndex = Math.min(GUN_GAME_LADDER.length, (killer.ggIndex || 0) + 1);
    killer.score = 1000 - killer.ggIndex * 10;
    sim.events.push({ t: 'gunGameAdvance', id: killer.id, index: killer.ggIndex, weapon: gunGameWeapon(killer.ggIndex) });
    sim.buildLoadout(killer, gunGameWeapon(killer.ggIndex));
  },

  isOver(sim) {
    return [...sim.players.values()].some((p) => (p.ggIndex || 0) >= GUN_GAME_LADDER.length);
  },

  winner(sim) {
    const list = [...sim.players.values()].sort((a, b) => (b.ggIndex || 0) - (a.ggIndex || 0));
    return list.length ? list[0].id : null;
  },

  hud(sim) {
    const leader = [...sim.players.values()].sort((a, b) => (b.ggIndex || 0) - (a.ggIndex || 0))[0];
    return { left: leader ? (leader.ggIndex || 0) : 0, right: null, limit: GUN_GAME_LADDER.length, label: leader?.name };
  }
};

/* ------------------------------------------------------------------ */
/* Search & Destroy                                                    */
/* ------------------------------------------------------------------ */

const PLANT_TIME = 5;
const DEFUSE_TIME = 5;
const BOMB_FUSE = 40;
const ROUND_TIME = 105;

const snd = {
  id: 'snd',
  name: 'Search & Destroy',
  nameSv: 'Sök & Förstör',
  short: 'S&D',
  teams: true,
  respawn: false,
  usesTimer: false,
  teamSize: 5,
  minPlayers: 2,
  desc: 'One life per round. Plant or defuse the bomb.',
  descSv: 'Ett liv per runda. Placera eller desarmera bomben.',

  scoreLimit: (sim) => sim.rules.scoreLimits.snd,
  timeLimit: () => Infinity,

  init(sim) {
    sim.state.round = {
      num: 0, phase: 'live', timer: ROUND_TIME, attackers: 'a', defenders: 'b',
      bomb: { carrier: null, planted: false, pos: null, fuse: 0, site: null },
      intermission: 5, winner: null
    };
  },

  spawnsFor(sim, p) {
    const r = sim.state.round;
    const attacking = p.team === r.attackers;
    return teamSpawns(sim, attacking ? r.attackers : r.defenders);
  },

  onSpawn(sim, p) {
    const r = sim.state.round;
    if (p.team === r.attackers && !r.bomb.carrier && !r.bomb.planted) {
      r.bomb.carrier = p.id;
      p.hasBomb = true;
      sim.events.push({ t: 'bombPickup', id: p.id });
    }
  },

  onDeath(sim, victim) {
    const r = sim.state.round;
    if (r.bomb.carrier === victim.id && !r.bomb.planted) {
      r.bomb.carrier = null;
      victim.hasBomb = false;
      r.bomb.dropped = { x: victim.pos.x, y: victim.pos.y, z: victim.pos.z };
      sim.events.push({ t: 'bombDrop', pos: r.bomb.dropped });
    }
    const aliveA = sim.alivePlayers(r.attackers).length;
    const aliveB = sim.alivePlayers(r.defenders).length;
    if (!r.bomb.planted) {
      if (aliveA === 0) sim.mode.endRound(sim, r.defenders, 'elim');
      else if (aliveB === 0) sim.mode.endRound(sim, r.attackers, 'elim');
    } else if (aliveB === 0) {
      sim.mode.endRound(sim, r.attackers, 'elim_planted');
    }
  },

  tick(sim, dt) {
    const r = sim.state.round;
    if (sim.over) return;

    if (r.phase === 'intermission') {
      r.intermission -= dt;
      r.timer = Math.max(0, r.intermission);
      if (r.intermission <= 0) sim.mode.startRound(sim);
      return;
    }

    if (r.phase === 'live') {
      r.timer -= dt;
      if (r.timer <= 0) { sim.mode.endRound(sim, r.defenders, 'time'); return; }
      // Pick up a dropped bomb.
      if (r.bomb.dropped) {
        for (const p of sim.players.values()) {
          if (!p.alive || p.team !== r.attackers) continue;
          if (Math.hypot(p.pos.x - r.bomb.dropped.x, p.pos.z - r.bomb.dropped.z) < 1.5) {
            r.bomb.dropped = null;
            r.bomb.carrier = p.id;
            p.hasBomb = true;
            sim.events.push({ t: 'bombPickup', id: p.id });
            break; // only one player can pick it up; the reference is now null
          }
        }
      }
      // Planting.
      const carrier = sim.players.get(r.bomb.carrier);
      if (carrier && carrier.alive && carrier.input.action) {
        const site = sim.map.sites.find((s) => Math.hypot(carrier.pos.x - s.x, carrier.pos.z - s.z) <= s.r);
        if (site) {
          r.plantProgress = (r.plantProgress || 0) + dt / PLANT_TIME;
          sim.events.push({ t: 'planting', id: carrier.id, progress: r.plantProgress });
          if (r.plantProgress >= 1) {
            r.plantProgress = 0;
            r.bomb.planted = true;
            r.bomb.pos = { ...carrier.pos };
            r.bomb.site = site.id;
            r.bomb.fuse = BOMB_FUSE;
            r.phase = 'planted';
            r.timer = BOMB_FUSE;
            carrier.hasBomb = false;
            carrier.objective++;
            carrier.score += 300;
            sim.events.push({ t: 'bombPlanted', pos: r.bomb.pos, by: carrier.id, site: site.id });
          }
        } else {
          r.plantProgress = 0;
        }
      } else if (r.phase === 'live') {
        r.plantProgress = 0;
      }
      return;
    }

    if (r.phase === 'planted') {
      r.timer -= dt;
      r.bomb.fuse -= dt;
      if (r.bomb.fuse <= 0) {
        sim.explosion(r.bomb.pos, 8, 160, sim.players.get(r.bomb.carrier) || null, 'bomb');
        sim.mode.endRound(sim, r.attackers, 'detonated');
        return;
      }
      // Defusing.
      for (const p of sim.players.values()) {
        if (!p.alive || p.team !== r.defenders) continue;
        const near = Math.hypot(p.pos.x - r.bomb.pos.x, p.pos.z - r.bomb.pos.z) < 2.2;
        if (near && p.input.action) {
          r.defuseProgress = (r.defuseProgress || 0) + dt / DEFUSE_TIME;
          sim.events.push({ t: 'defusing', id: p.id, progress: r.defuseProgress });
          if (r.defuseProgress >= 1) {
            r.defuseProgress = 0;
            p.objective++;
            p.score += 400;
            sim.mode.endRound(sim, r.defenders, 'defused');
            return;
          }
        }
      }
      if (sim.alivePlayers(r.defenders).length === 0) sim.mode.endRound(sim, r.attackers, 'elim_planted');
    }
  },

  endRound(sim, winnerTeam, reason) {
    const r = sim.state.round;
    if (r.phase === 'over') return;
    r.phase = 'over';
    r.winner = winnerTeam;
    sim.teams[winnerTeam].score++;
    for (const p of sim.players.values()) {
      if (p.team === winnerTeam) p.score += 200;
      p.hasBomb = false;
    }
    sim.events.push({ t: 'roundEnd', winner: winnerTeam, reason, round: r.num });
    if (sim.teams.a.score >= sim.scoreLimit || sim.teams.b.score >= sim.scoreLimit) {
      sim.endMatch('rounds');
      return;
    }
    r.intermission = 6;
    r.phase = 'intermission';
  },

  startRound(sim) {
    const r = sim.state.round;
    r.num++;
    r.phase = 'live';
    r.timer = ROUND_TIME;
    r.plantProgress = 0;
    r.defuseProgress = 0;
    r.bomb = { carrier: null, planted: false, pos: null, fuse: 0, site: null, dropped: null };
    // Swap sides every round.
    const swap = r.attackers;
    r.attackers = r.defenders;
    r.defenders = swap;
    for (const p of sim.players.values()) {
      sim.spawnPlayer(p);
    }
    sim.events.push({ t: 'roundStart', round: r.num, attackers: r.attackers, defenders: r.defenders });
  },

  isOver(sim) {
    return sim.teams.a.score >= sim.scoreLimit || sim.teams.b.score >= sim.scoreLimit;
  },

  winner(sim) {
    if (sim.teams.a.score === sim.teams.b.score) return 'draw';
    return sim.teams.a.score > sim.teams.b.score ? 'a' : 'b';
  },

  hud(sim) {
    return { left: sim.teams.a.score, right: sim.teams.b.score, limit: sim.scoreLimit, round: sim.state.round };
  }
};

export const MODES = { tdm, ffa, dom, gungame, snd };
export const MODE_LIST = Object.values(MODES).map((m) => ({
  id: m.id, name: m.name, nameSv: m.nameSv, short: m.short, teams: m.teams,
  teamSize: m.teamSize, minPlayers: m.minPlayers, desc: m.desc, descSv: m.descSv
}));
