/**
 * End-to-end test of the multiplayer server: spins up the real server process,
 * connects two real WebSocket clients, has them queue, and asserts that
 * matchmaking forms a room, snapshots stream, and inputs move players.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---------------- tiny WebSocket client (masked, RFC6455) ---------------- */

class MiniClient {
  constructor(port) {
    this.port = port;
    this.messages = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      this.sock = net.connect(this.port, '127.0.0.1', () => {
        this.sock.write(
          'GET /ws HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      this.buf = Buffer.alloc(0);
      this.handshaked = false;
      this.sock.on('data', (chunk) => this._onData(chunk, resolve));
      this.sock.on('error', reject);
      setTimeout(() => reject(new Error('ws connect timeout')), 5000);
    });
  }

  _onData(chunk, resolve) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (!this.handshaked) {
      const idx = this.buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const head = this.buf.subarray(0, idx).toString();
      if (!/101/.test(head)) { resolve(); return; }
      this.buf = this.buf.subarray(idx + 4);
      this.handshaked = true;
      resolve();
    }
    while (this._parse());
  }

  _parse() {
    const b = this.buf;
    if (b.length < 2) return false;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < 4) return false; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return false; len = b.readUInt32BE(6); off = 10; }
    if (b.length < off + len) return false;
    const payload = b.subarray(off, off + len).toString('utf8');
    this.buf = b.subarray(off + len);
    if ((b[0] & 0x0f) === 0x1) {
      try {
        const msg = JSON.parse(payload);
        this.messages.push(msg);
        for (const w of this.waiters) w(msg);
      } catch { /* ignore */ }
    }
    return true;
  }

  send(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
    header[0] = 0x81;
    const mask = crypto.randomBytes(4);
    const masked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }

  /** Resolve with the first message matching pred (searching history first). */
  waitFor(pred, timeout = 12000, label = 'message') {
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(check);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timeout waiting for ${label}; got ${this.messages.map((m) => m.t).join(',')}`));
      }, timeout);
      const check = (msg) => {
        if (pred(msg)) {
          clearTimeout(timer);
          const i = this.waiters.indexOf(check);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(msg);
        }
      };
      this.waiters.push(check);
    });
  }

  close() { try { this.sock.destroy(); } catch { /* ignore */ } }
}

/* ---------------- server lifecycle ---------------- */

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

async function withServer(fn) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BOT_FILL: '1', MAX_BOTS: '3' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (d) => logs += d);
  child.stderr.on('data', (d) => logs += d);
  try {
    // wait for /health
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        const r = await getJson(port, '/health');
        if (r.status === 200) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('server did not start:\n' + logs);
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn(port);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
  }
}

test('server serves the client and hides internal paths', async () => {
  await withServer(async (port) => {
    const health = await getJson(port, '/health');
    assert.equal(health.status, 200);
    const h = JSON.parse(health.body);
    assert.equal(h.ok, true);
    assert.equal(h.maps, 6);
    assert.equal(h.modes, 5);

    const root = await getJson(port, '/index.html');
    assert.equal(root.status, 200, 'client should be served at /index.html');
    assert.match(root.headers['content-type'], /text\/html/);

    const denied = await getJson(port, '/server/server.js');
    assert.equal(denied.status, 404, 'server source must not be served');
    const denied2 = await getJson(port, '/.data/profiles.json');
    assert.equal(denied2.status, 404, 'profile data must not be served');
  });
});

test('two players queue, get matched, and play an authoritative match', async () => {
  await withServer(async (port) => {
    const a = new MiniClient(port);
    const b = new MiniClient(port);
    await a.connect();
    await b.connect();

    const welcomeA = await a.waitFor((m) => m.t === 'welcome', 5000, 'welcome');
    assert.ok(welcomeA.id);
    assert.equal(welcomeA.modes.length, 5);
    assert.equal(welcomeA.maps.length, 6);

    a.send({ t: 'hello', name: 'Alpha', profileId: 'test-alpha', profile: { xp: 5000, name: 'Alpha' } });
    b.send({ t: 'hello', name: 'Bravo', profileId: 'test-bravo', profile: { xp: 0, name: 'Bravo' } });

    const profileA = await a.waitFor((m) => m.t === 'profile', 5000, 'profile');
    assert.ok(profileA.profile.xp >= 5000, 'stored profile should keep submitted XP');
    assert.ok(profileA.level >= 2, `level should be derived from xp, got ${profileA.level}`);

    a.send({ t: 'queue', mode: 'tdm', ruleset: 'classic' });
    const queued = await a.waitFor((m) => m.t === 'queued', 5000, 'queued');
    assert.equal(queued.mode, 'tdm');

    b.send({ t: 'queue', mode: 'tdm', ruleset: 'classic' });

    const startA = await a.waitFor((m) => m.t === 'matchStart', 8000, 'matchStart');
    const startB = await b.waitFor((m) => m.t === 'matchStart', 8000, 'matchStart');
    assert.equal(startA.mode, 'tdm');
    assert.notEqual(startA.team, startB.team, 'players should be on opposite teams');
    assert.ok(startA.initial.players.length >= 2, 'match should contain both players');

    // Drive inputs for a couple of seconds and confirm snapshots stream back.
    const before = startA.initial.players.find((p) => p.id === startA.you);
    for (let i = 0; i < 90; i++) {
      a.send({ t: 'i', mx: 0, mz: -1, yaw: before.yaw, pitch: 0, x: before.x, y: before.y, z: before.z, fire: false });
      await new Promise((r) => setTimeout(r, 16));
    }
    const snap = await a.waitFor((m) => m.t === 'snap' && m.players.length >= 2, 5000, 'snapshot');
    assert.equal(snap.mode, 'tdm');
    assert.ok(Number.isFinite(snap.timeLeft), 'timeLeft must be finite');
    assert.ok(snap.scoreboard.players.length >= 2, 'scoreboard should list everyone');

    const events = await a.waitFor((m) => m.t === 'ev', 5000, 'events');
    assert.ok(Array.isArray(events.e) && events.e.length > 0, 'events should stream');

    a.close();
    b.close();
  });
});

test('a lone player still gets a match (bot fill)', async () => {
  await withServer(async (port) => {
    const a = new MiniClient(port);
    await a.connect();
    a.send({ t: 'hello', name: 'Solo', profileId: 'test-solo' });
    await a.waitFor((m) => m.t === 'profile', 5000, 'profile');
    a.send({ t: 'queue', mode: 'ffa', ruleset: 'hardcore' });
    const start = await a.waitFor((m) => m.t === 'matchStart', 12000, 'matchStart (bot fill)');
    assert.equal(start.mode, 'ffa');
    const bots = start.initial.players.filter((p) => p.isBot);
    assert.ok(bots.length > 0, 'lobby should be filled with bots');
    a.close();
  });
});
