/**
 * Connection abstraction. Two implementations with an identical interface:
 *   - ServerConnection: real WebSocket to the Node server (online matchmaking)
 *   - LocalConnection:  runs the shared simulation in the browser against bots
 * so the rest of the client never needs to know which one it is talking to.
 */
import { Sim } from '../shared/sim.js';
import { MODES } from '../shared/modes.js';
import { MAPS, getMap } from '../shared/maps.js';
import { applyMatchToProfile, levelFromXp, enforceUnlocks } from '../shared/progression.js';

const MODE_LIST = Object.values(MODES).map((m) => ({
  id: m.id, name: m.name, nameSv: m.nameSv, short: m.short, teams: m.teams,
  teamSize: m.teamSize, minPlayers: m.minPlayers, desc: m.desc, descSv: m.descSv
}));
const MAP_LIST = MAPS.map((m) => ({ id: m.id, name: m.name, subtitle: m.subtitle, size: m.size, players: m.players }));

export function serverUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  return `${proto}://${location.host}/ws`;
}

/* ------------------------------------------------------------------ */
/* Online                                                              */
/* ------------------------------------------------------------------ */

export class ServerConnection {
  constructor(url) {
    this.url = url;
    this.kind = 'server';
    this.connected = false;
    this.listeners = new Set();
    this.onStatus = null;
    this.ws = null;
    this.latency = 0;
    this._pingTimer = null;
  }

  connect(timeoutMs = 4000) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        try { this.ws?.close(); } catch { /* ignore */ }
        done(false);
      }, timeoutMs);

      try {
        this.ws = new WebSocket(this.url);
      } catch {
        done(false);
        return;
      }
      this.ws.onopen = () => {
        this.connected = true;
        this.onStatus?.('connected');
        done(true);
      };
      this.ws.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'pong') { this.latency = Math.max(0, Date.now() - msg.at); return; }
        for (const fn of this.listeners) fn(msg);
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.onStatus?.('closed');
        done(false);
      };
      this.ws.onerror = () => done(false);
    });
  }

  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  send(msg) {
    if (!this.connected || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
  }

  startPing() {
    this._pingTimer = setInterval(() => this.send({ t: 'ping', at: Date.now() }), 3000);
  }

  close() {
    clearInterval(this._pingTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
    this.connected = false;
  }
}

/* ------------------------------------------------------------------ */
/* Offline (bots)                                                      */
/* ------------------------------------------------------------------ */

const BOT_NAMES = ['Viper', 'Ghost', 'Nomad', 'Reaper', 'Havoc', 'Rogue', 'Echo', 'Titan',
  'Frost', 'Cobra', 'Wraith', 'Onyx', 'Blitz', 'Saber', 'Kilo', 'Raptor'];

function randomLoadout() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    primary: pick(['m4a1', 'ak47', 'mp5', 'vector', 'm249', 'ranger870', 'scarh', 'longshot']),
    primaryAttachments: [],
    secondary: pick(['m1911', 'deagle']),
    secondaryAttachments: [],
    lethal: pick(['frag', 'semtex', 'thermite']),
    tactical: pick(['flash', 'stun', 'smoke']),
    perk1: pick(['marathon', 'scavenger', 'sitrep']),
    perk2: pick(['sleight', 'stoppingpower', 'coldblooded']),
    perk3: pick(['steadyaim', 'commando', 'ninja']),
    killstreaks: ['uav', 'carepackage', 'helicopter']
  };
}

export class LocalConnection {
  constructor() {
    this.kind = 'local';
    this.connected = true;
    this.listeners = new Set();
    this.onStatus = null;
    this.localId = 'local-player';
    this.profile = null;
    this.sim = null;
    this.timer = null;
    this.snapshotAccum = 0;
    this.mapIndex = 0;
    this.pending = { mode: 'tdm', map: null, ruleset: 'hardcore', loadout: null };
    this.latency = 0;
    this.over = false;
  }

  connect() {
    return Promise.resolve(true);
  }

  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(msg) {
    // Deliver asynchronously so callers behave like the network path.
    setTimeout(() => { for (const fn of this.listeners) fn(msg); }, 0);
  }

  send(msg) {
    switch (msg.t) {
      case 'hello':
        this.profile = msg.profile;
        this.localName = String(msg.name || 'Soldier').slice(0, 18);
        this.emit({
          t: 'welcome', id: this.localId,
          server: { name: 'Local (bots)', version: '1.0', tickRate: 30 },
          modes: MODE_LIST, maps: MAP_LIST,
          rulesets: [], online: 1
        });
        this.emit({ t: 'profile', profile: this.profile, level: levelFromXp(this.profile.xp).level, online: 1 });
        break;
      case 'queue':
        this.pending = { mode: msg.mode, map: msg.map, ruleset: msg.ruleset, loadout: msg.loadout };
        this.emit({ t: 'queued', mode: msg.mode, position: 1, waitMs: 0 });
        setTimeout(() => this.startMatch(), 900);
        break;
      case 'leaveQueue':
        this.emit({ t: 'queueLeft' });
        break;
      case 'i':
        if (this.sim) this.sim.setInput(this.localId, msg);
        break;
      case 'leaveMatch':
        this.stopMatch();
        this.emit({ t: 'leftMatch' });
        break;
      case 'chat':
        this.emit({ t: 'chat', from: this.localName, text: msg.text, team: 'a' });
        break;
      default:
        break;
    }
  }

  startMatch() {
    const { mode, map, ruleset, loadout } = this.pending;
    const mapId = map && MAPS.some((m) => m.id === map) ? map : MAPS[this.mapIndex % MAPS.length].id;
    const modeDef = MODES[mode] || MODES.tdm;
    const sim = new Sim({ mode, mapId, ruleset, seed: (Math.random() * 1e9) | 0 });

    const team = modeDef.teams ? 'a' : 'ffa';
    sim.addPlayer({
      id: this.localId,
      name: this.localName,
      team,
      isBot: false,
      loadout: enforceUnlocks(this.profile, loadout)
    });

    const total = Math.min(modeDef.teamSize, modeDef.teams ? 12 : 10);
    for (let i = 0; i < total - 1; i++) {
      const botTeam = modeDef.teams ? (i % 2 ? 'b' : 'a') : 'ffa';
      sim.addPlayer({
        id: 'bot' + i,
        name: BOT_NAMES[i % BOT_NAMES.length],
        team: botTeam,
        isBot: true,
        skill: 0.3 + Math.random() * 0.6,
        loadout: randomLoadout()
      });
    }
    // Keep teams even with the human on one side.
    sim.balanceTeams();

    this.sim = sim;
    this.over = false;
    this.emit({
      t: 'matchStart',
      room: 'local',
      mode, map: mapId, mapName: getMap(mapId).name,
      ruleset, team, you: this.localId, teams: modeDef.teams,
      scoreLimit: sim.scoreLimit,
      initial: sim.snapshotFor(this.localId)
    });

    clearInterval(this.timer);
    this.snapshotAccum = 0;
    let last = performance.now();
    this.timer = setInterval(() => {
      if (!this.sim) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const events = this.sim.tick(1 / 30);
      if (events.length) this.emit({ t: 'ev', e: events });
      this.snapshotAccum += dt;
      if (this.snapshotAccum >= 1 / 20) {
        this.snapshotAccum = 0;
        const snap = this.sim.snapshotFor(this.localId);
        snap.t = 'snap';
        snap.id = this.localId;
        this.emit(snap);
      }
      if (this.sim.over && !this.over) {
        this.over = true;
        this.finishMatch();
      }
    }, 1000 / 30);
  }

  finishMatch() {
    const sim = this.sim;
    const me = sim.players.get(this.localId);
    if (!me) return;
    const won = sim.mode.teams ? sim.winner === me.team : sim.winner === this.localId;
    let reward = { xp: 0, levelUps: [], weaponUnlocks: [], weaponLevelUps: {}, level: 1, totalXp: this.profile?.xp || 0 };
    if (this.profile) reward = applyMatchToProfile(this.profile, me, { won: !!won, mode: sim.modeId });
    this.emit({
      t: 'matchEnd',
      winner: sim.winner,
      won: !!won,
      mode: sim.modeId,
      map: sim.mapId,
      scoreboard: sim.scoreboard(),
      xp: reward.xp,
      totalXp: reward.totalXp,
      level: reward.level,
      levelUps: reward.levelUps,
      weaponUnlocks: reward.weaponUnlocks,
      weaponLevelUps: reward.weaponLevelUps,
      profile: this.profile,
      stats: { kills: me.kills, deaths: me.deaths, assists: me.assists, headshots: me.headshots, score: me.score, objectives: me.objective },
      nextIn: 12
    });
    setTimeout(() => {
      if (!this.sim) return;
      this.stopMatch();
      this.mapIndex++;
      this.emit({ t: 'rotating', mapId: MAPS[this.mapIndex % MAPS.length].id, mode: this.pending.mode });
      this.emit({ t: 'queued', mode: this.pending.mode, position: 1, waitMs: 0 });
      setTimeout(() => this.startMatch(), 800);
    }, 12000);
  }

  stopMatch() {
    clearInterval(this.timer);
    this.timer = null;
    this.sim = null;
  }

  close() { this.stopMatch(); this.connected = false; }
}
