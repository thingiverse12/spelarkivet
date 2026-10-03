/**
 * Duty Calls multiplayer server.
 *
 *   - serves the static client (so one process is enough to play)
 *   - runs matchmaking queues per game mode
 *   - hosts authoritative matches using the shared simulation
 *   - persists XP profiles between sessions
 *
 * Zero npm dependencies. Start with: node server/server.js
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocketServer } from './ws.js';
import { Sim, RULESETS } from '../js/shared/sim.js';
import { MODES, MODE_LIST } from '../js/shared/modes.js';
import { MAPS, MAP_LIST, getMap } from '../js/shared/maps.js';
import {
  createProfile, normalizeProfile, levelFromXp,
  applyMatchToProfile, enforceUnlocks
} from '../js/shared/progression.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.data');
const PROFILE_FILE = path.join(DATA_DIR, 'profiles.json');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const TICK_HZ = 30;
const SNAPSHOT_HZ = 20;
const QUEUE_TIMEOUT_MS = 6000;      // how long a lone player waits before bots fill in
const BOT_FILL = process.env.BOT_FILL !== '0';
const MAX_BOTS_PER_TEAM = Number(process.env.MAX_BOTS || 5);
const POST_MATCH_DELAY_MS = 14000;

/* ------------------------------------------------------------------ */
/* Static file serving                                                 */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

const INDEX_FALLBACKS = ['/index.html'];

// Never expose these over HTTP.
const DENY = ['/.git', '/.data', '/server', '/node_modules', '/test', '/package.json', '/.github'];

function serveStatic(req, res) {
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/') pathname = '/index.html';

  if (DENY.some((d) => pathname === d || pathname.startsWith(d + '/'))) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const resolved = path.normalize(path.join(ROOT, pathname));
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (!err && stat.isDirectory()) {
      for (const candidate of INDEX_FALLBACKS) {
        const p = path.join(resolved, candidate);
        if (fs.existsSync(p)) return sendFile(p, res, req);
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 Not Found: ' + pathname);
      return;
    }
    sendFile(resolved, res, req);
  });
}

function sendFile(file, res, req) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // Always revalidate: a stale main.js means the player keeps running yesterday's
  // code. The ETag makes that a cheap 304 instead of a re-download.
  const cache = 'public, max-age=0, must-revalidate';
  fs.stat(file, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 Not Found');
      return;
    }
    const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
    if (req && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': cache }).end();
      return;
    }
    res.writeHead(200, {
      'content-type': type,
      'cache-control': cache,
      etag,
      'x-content-type-options': 'nosniff'
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* Profile persistence                                                 */
/* ------------------------------------------------------------------ */

const profiles = new Map();
let saveTimer = null;

async function loadProfiles() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const raw = await fsp.readFile(PROFILE_FILE, 'utf8');
    const data = JSON.parse(raw);
    for (const [id, p] of Object.entries(data)) profiles.set(id, normalizeProfile(p));
    console.log(`[profiles] loaded ${profiles.size}`);
  } catch {
    // first run — nothing to load
  }
}

function saveProfiles() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const obj = Object.fromEntries(profiles);
      await fsp.writeFile(PROFILE_FILE, JSON.stringify(obj));
    } catch (err) {
      console.error('[profiles] save failed', err.message);
    }
  }, 1500);
  saveTimer.unref?.();
}

function getOrCreateProfile(clientId, submitted) {
  const stored = profiles.get(clientId);
  if (stored) {
    // Merge offline progress: keep whichever XP is higher so playing
    // without a server never throws away progress.
    if (submitted && Number(submitted.xp) > stored.xp) stored.xp = Math.floor(Number(submitted.xp));
    if (submitted?.stats) {
      for (const k of Object.keys(stored.stats)) {
        stored.stats[k] = Math.max(stored.stats[k] || 0, Number(submitted.stats[k]) || 0);
      }
    }
    if (submitted?.weaponXp) {
      for (const [w, xp] of Object.entries(submitted.weaponXp)) {
        stored.weaponXp[w] = Math.max(stored.weaponXp[w] || 0, Number(xp) || 0);
      }
    }
    if (submitted?.name) stored.name = String(submitted.name).slice(0, 18);
    saveProfiles();
    return stored;
  }
  const fresh = normalizeProfile(submitted || createProfile('Soldier'));
  profiles.set(clientId, fresh);
  saveProfiles();
  return fresh;
}

/* ------------------------------------------------------------------ */
/* Matchmaking                                                         */
/* ------------------------------------------------------------------ */

const clients = new Map();   // connId -> client
const queues = new Map();   // modeId -> [client]
const rooms = new Set();
let connSeq = 1;
let roomSeq = 1;

class Client {
  constructor(conn, id) {
    this.conn = conn;
    this.id = id;
    this.name = 'Soldier';
    this.profileId = null;
    this.profile = null;
    this.room = null;
    this.queuedMode = null;
    this.queuedAt = 0;
    this.pendingEvents = [];
    this.lastInputAt = 0;
    this.connectedAt = Date.now();
  }
  send(obj) {
    try { this.conn.send(obj); } catch { /* dropped */ }
  }
}

function enqueue(client, mode) {
  if (!MODES[mode]) mode = 'tdm';
  client.queuedMode = mode;
  client.queuedAt = Date.now();
  let q = queues.get(mode);
  if (!q) { q = []; queues.set(mode, q); }
  if (!q.includes(client)) q.push(client);
  client.send({ t: 'queued', mode, position: q.length, waitMs: Date.now() - client.queuedAt });
}

function dequeue(client) {
  if (!client.queuedMode) return;
  const q = queues.get(client.queuedMode);
  if (q) {
    const i = q.indexOf(client);
    if (i >= 0) q.splice(i, 1);
  }
  client.queuedMode = null;
}

function processQueues() {
  const now = Date.now();
  for (const [mode, q] of queues) {
    if (!q.length) continue;
    const ready = q.filter((c) => c.conn && !c.conn.closed && !c.room);
    queues.set(mode, ready);
    if (ready.length < 2) {
      const oldest = ready[0];
      if (oldest && BOT_FILL && now - oldest.queuedAt > QUEUE_TIMEOUT_MS) {
        startMatch(mode, [oldest]);
      }
      continue;
    }
    const modeDef = MODES[mode];
    const wanted = Math.min(ready.length, modeDef.teams ? modeDef.teamSize * 2 : modeDef.teamSize);
    startMatch(mode, ready.slice(0, wanted));
  }
}

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

class Room {
  constructor(mode, mapId, ruleset, humanClients) {
    this.id = 'room' + (roomSeq++);
    this.modeId = mode;
    this.mapId = mapId;
    this.ruleset = ruleset;
    this.clients = [];
    this.sim = new Sim({ mode, mapId, ruleset, seed: (Math.random() * 1e9) | 0 });
    this.over = false;
    this.overAt = 0;
    this.tickAccum = 0;
    this.snapshotAccum = 0;
    this.rotationIndex = MAPS.findIndex((m) => m.id === mapId);
    this.finished = false;

    const modeDef = MODES[mode];
    const teamSize = Math.min(modeDef.teamSize, 6);
    humanClients.forEach((c, i) => {
      const team = modeDef.teams ? (i % 2 ? 'a' : 'b') : 'ffa';
      this.addHuman(c, team);
    });

    if (BOT_FILL) {
      const humans = this.clients.length;
      if (modeDef.teams) {
        for (const team of ['a', 'b']) {
          const onTeam = this.clients.filter((c) => c.team === team).length;
          const target = Math.min(teamSize, onTeam + MAX_BOTS_PER_TEAM);
          for (let i = onTeam; i < target; i++) this.addBot(team);
        }
      } else {
        const target = Math.min(modeDef.teamSize, 8, humans + MAX_BOTS_PER_TEAM * 2);
        for (let i = humans; i < target; i++) this.addBot('ffa');
      }
    }

    this.timer = setInterval(() => this.frame(), 1000 / TICK_HZ);
    this.timer.unref?.();
    rooms.add(this);
    console.log(`[match] ${this.id} ${mode}/${mapId}/${ruleset} — ${this.clients.length} humans, ${this.sim.players.size} total`);
  }

  addHuman(client, team) {
    const profile = client.profile || createProfile(client.name);
    const loadout = enforceUnlocks(profile, client.loadout);
    const p = this.sim.addPlayer({
      id: client.id,
      name: client.name || profile.name,
      team,
      isBot: false,
      loadout
    });
    p.ping = 0;
    client.room = this;
    client.team = team;
    this.clients.push(client);
    dequeue(client);
  }

  addBot(team) {
    const idx = this.sim.players.size;
    const names = ['Viper', 'Ghost', 'Nomad', 'Reaper', 'Havoc', 'Rogue', 'Echo', 'Titan',
      'Frost', 'Cobra', 'Wraith', 'Onyx', 'Blitz', 'Saber', 'Kilo', 'Raptor'];
    const name = names[idx % names.length] + ' ' + (Math.floor(idx / names.length) + 1);
    this.sim.addPlayer({
      id: 'bot_' + this.id + '_' + idx,
      name: name.trim(),
      team,
      isBot: true,
      skill: 0.35 + Math.random() * 0.55,
      loadout: randomLoadout()
    });
  }

  frame() {
    if (this.finished) return;
    const now = Date.now();
    const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;

    const events = this.sim.tick(1 / TICK_HZ);
    if (events.length) {
      for (const c of this.clients) c.send({ t: 'ev', e: events });
    }

    this.snapshotAccum += dt;
    if (this.snapshotAccum >= 1 / SNAPSHOT_HZ) {
      this.snapshotAccum = 0;
      for (const c of this.clients) {
        const snap = this.sim.snapshotFor(c.id);
        snap.t = 'snap';
        snap.id = c.id;
        c.send(snap);
      }
    }

    if (this.sim.over && !this.over) {
      this.over = true;
      this.overAt = now;
      this.finish();
    }
    if (this.over && now - this.overAt > POST_MATCH_DELAY_MS) this.nextMap();
    if (!this.clients.length) this.destroy();
  }

  finish() {
    const scoreboard = this.sim.scoreboard();
    const winner = this.sim.winner;
    for (const c of this.clients) {
      const me = this.sim.players.get(c.id);
      if (!me) continue;
      const profile = c.profile;
      const won = this.sim.mode.teams ? winner === me.team : winner === c.id;
      let reward = { xp: 0, levelUps: [], weaponUnlocks: [], weaponLevelUps: {}, level: 1, totalXp: 0 };
      if (profile) {
        reward = applyMatchToProfile(profile, me, { won: !!won, mode: this.modeId });
        saveProfiles();
      }
      c.send({
        t: 'matchEnd',
        winner,
        won: !!won,
        mode: this.modeId,
        map: this.mapId,
        scoreboard,
        xp: reward.xp,
        totalXp: reward.totalXp,
        level: reward.level,
        levelUps: reward.levelUps,
        weaponUnlocks: reward.weaponUnlocks,
        weaponLevelUps: reward.weaponLevelUps,
        profile,
        stats: { kills: me.kills, deaths: me.deaths, assists: me.assists, headshots: me.headshots, score: me.score, objectives: me.objective },
        nextIn: POST_MATCH_DELAY_MS / 1000
      });
    }
  }

  nextMap() {
    if (this.finished) return;
    const active = this.clients.filter((c) => c.conn && !c.conn.closed);
    if (!active.length) { this.destroy(); return; }
    this.rotationIndex = (this.rotationIndex + 1) % MAPS.length;
    const mapId = MAPS[this.rotationIndex].id;
    for (const c of active) {
      c.room = null;
      c.send({ t: 'rotating', mapId, mode: this.modeId });
      enqueue(c, this.modeId);
    }
    this.destroy();
  }

  removeClient(client) {
    const i = this.clients.indexOf(client);
    if (i >= 0) this.clients.splice(i, 1);
    this.sim.removePlayer(client.id);
    client.room = null;
    if (!this.clients.length) this.destroy();
  }

  destroy() {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.timer);
    rooms.delete(this);
    console.log(`[match] ${this.id} closed`);
  }
}

function randomLoadout() {
  const primaries = ['m4a1', 'ak47', 'mp5', 'vector', 'm249', 'ranger870', 'scarh'];
  const secondaries = ['m1911', 'deagle'];
  const lethals = ['frag', 'semtex', 'thermite'];
  const tacticals = ['flash', 'stun', 'smoke'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return {
    primary: pick(primaries),
    primaryAttachments: [],
    secondary: pick(secondaries),
    secondaryAttachments: [],
    lethal: pick(lethals),
    tactical: pick(tacticals),
    perk1: pick(['marathon', 'scavenger', 'sitrep']),
    perk2: pick(['sleight', 'stoppingpower', 'coldblooded']),
    perk3: pick(['steadyaim', 'commando', 'ninja']),
    killstreaks: ['uav', 'carepackage', 'helicopter']
  };
}

function startMatch(mode, clientList) {
  const clients2 = clientList.filter((c) => c.conn && !c.conn.closed);
  if (!clients2.length) return;
  for (const c of clients2) dequeue(c);

  const mapId = pickMapFor(mode, clients2);
  const ruleset = clients2[0].ruleset && RULESETS[clients2[0].ruleset] ? clients2[0].ruleset : 'hardcore';
  const room = new Room(mode, mapId, ruleset, clients2);
  for (const c of clients2) {
    const snap = room.sim.snapshotFor(c.id);
    c.send({
      t: 'matchStart',
      room: room.id,
      mode,
      map: mapId,
      mapName: getMap(mapId).name,
      ruleset,
      team: c.team,
      you: c.id,
      teams: MODES[mode].teams,
      scoreLimit: room.sim.scoreLimit,
      initial: snap
    });
  }
  return room;
}

function pickMapFor(mode, clients2) {
  const requested = clients2.map((c) => c.requestedMap).find(Boolean);
  if (requested && MAPS.some((m) => m.id === requested)) return requested;
  return MAPS[Math.floor(Math.random() * MAPS.length)].id;
}

/* ------------------------------------------------------------------ */
/* Connection handling                                                 */
/* ------------------------------------------------------------------ */

function handle(conn, req) {
  const client = new Client(conn, 'c' + (connSeq++));
  clients.set(client.id, client);
  wsTracker.track(conn);

  conn.on('message', (msg) => onMessage(client, msg));
  conn.on('close', () => {
    if (client.room) client.room.removeClient(client);
    dequeue(client);
    clients.delete(client.id);
  });
  conn.on('error', () => { /* socket level, ignore */ });

  client.send({
    t: 'welcome',
    id: client.id,
    server: { name: 'Duty Calls', version: '1.0', tickRate: TICK_HZ },
    modes: MODE_LIST,
    maps: MAP_LIST,
    rulesets: Object.values(RULESETS).map((r) => ({
      id: r.id, name: r.name, nameSv: r.nameSv, desc: r.desc, descSv: r.descSv
    })),
    online: clients.size
  });
}

function onMessage(client, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'hello': {
      client.profileId = String(msg.profileId || '').slice(0, 64) || client.id;
      client.name = String(msg.name || 'Soldier').slice(0, 18);
      client.profile = getOrCreateProfile(client.profileId, msg.profile);
      client.profile.name = client.name;
      client.loadout = msg.loadout || client.loadout;
      client.send({
        t: 'profile',
        profile: client.profile,
        level: levelFromXp(client.profile.xp).level,
        online: clients.size
      });
      break;
    }
    case 'queue': {
      if (client.room) { client.send({ t: 'error', msg: 'already in a match' }); return; }
      client.requestedMap = msg.map && MAPS.some((m) => m.id === msg.map) ? msg.map : null;
      client.ruleset = RULESETS[msg.ruleset] ? msg.ruleset : 'hardcore';
      if (msg.loadout) client.loadout = msg.loadout;
      enqueue(client, msg.mode);
      break;
    }
    case 'leaveQueue':
      dequeue(client);
      client.send({ t: 'queueLeft' });
      break;
    case 'i': {
      if (!client.room) return;
      client.room.sim.setInput(client.id, msg);
      break;
    }
    case 'chat': {
      const text = String(msg.text || '').slice(0, 120);
      if (!text) return;
      const targets = client.room ? client.room.clients : [...clients.values()];
      for (const c of targets) c.send({ t: 'chat', from: client.name, text, team: client.team });
      break;
    }
    case 'leaveMatch': {
      if (client.room) client.room.removeClient(client);
      client.send({ t: 'leftMatch' });
      break;
    }
    case 'ping': {
      client.send({ t: 'pong', at: msg.at });
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      online: clients.size,
      rooms: rooms.size,
      queued: [...queues.values()].reduce((n, q) => n + q.length, 0),
      maps: MAP_LIST.length,
      modes: MODE_LIST.length
    }));
    return;
  }
  serveStatic(req, res);
});

const wsTracker = attachWebSocketServer(server, '/ws', handle);

setInterval(processQueues, 250).unref?.();

await loadProfiles();

server.listen(PORT, HOST, () => {
  console.log(`
  ┌─────────────────────────────────────────────────────────┐
  │  DUTY CALLS — multiplayer server                        │
  ├─────────────────────────────────────────────────────────┤
  │  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}                             │
  │  WebSocket: ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/ws                        │
  │  Tick rate: ${TICK_HZ} Hz    snapshots: ${SNAPSHOT_HZ} Hz                   │
  │  Bot fill: ${BOT_FILL ? 'on' : 'off'}   profiles: ${String(profiles.size).padEnd(28)}│
  └─────────────────────────────────────────────────────────┘
  `);
});

process.on('SIGTERM', () => { wsTracker.shutdown(); server.close(); process.exit(0); });
process.on('SIGINT', () => { wsTracker.shutdown(); server.close(); process.exit(0); });
