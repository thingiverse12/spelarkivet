/**
 * Real-browser smoke test: boots the game in headless Chrome (SwiftShader WebGL),
 * plays a few seconds of an actual match and asserts there are no page errors,
 * that the renderer draws non-black frames and that the HUD tracks the match.
 *
 * Skips automatically when puppeteer/Chrome is not installed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let puppeteer = null;
try {
  puppeteer = (await import('puppeteer')).default;
  // executablePath() is sync in some versions and async in others.
  let exec = puppeteer.executablePath();
  if (exec && typeof exec.then === 'function') exec = await exec;
  if (!exec || !fs.existsSync(exec)) puppeteer = null;
} catch {
  puppeteer = null;
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function waitUp(port, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const ok = await new Promise((res) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/health' }, (r) => { r.resume(); res(r.statusCode === 200); });
        req.on('error', () => res(false));
      });
      if (ok) return true;
    } catch { /* retry */ }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

test('the game boots, matches and renders in a real browser', { skip: !puppeteer && 'puppeteer/Chrome not installed' }, async (t) => {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MAX_BOTS: '3' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', (d) => serverLog += d);
  server.stderr.on('data', (d) => serverLog += d);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,800'
    ]
  });

  try {
    assert.ok(await waitUp(port), 'server did not come up:\n' + serverLog);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const errors = [];
    const logs = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      logs.push(`${m.type()}: ${m.text()}`);
      if (m.type() === 'error') errors.push('console: ' + m.text());
    });
    page.on('requestfailed', (r) => {
      const url = r.url();
      if (url.startsWith(`http://127.0.0.1:${port}`)) errors.push('requestfailed: ' + url);
    });

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle2', timeout: 45000 });

    // Boot: loading screen must disappear and the main menu must show.
    await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 40000 });
    await page.waitForSelector('#screen-main:not(.hidden)', { timeout: 10000 });

    const boot = await page.evaluate(() => ({
      fatal: !document.getElementById('fatal').classList.contains('hidden'),
      fatalText: document.getElementById('fatalText').textContent,
      modes: document.querySelectorAll('#modePicker button').length,
      maps: document.querySelectorAll('#mapPicker button').length,
      rules: document.querySelectorAll('#rulesPicker button').length,
      net: document.getElementById('netStatusText').textContent,
      webgl: (() => {
        const c = document.getElementById('gl');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      })()
    }));
    assert.equal(boot.fatal, false, 'fatal error shown: ' + boot.fatalText);
    assert.equal(boot.modes, 5, 'all five modes should be pickable');
    assert.equal(boot.maps, 7, 'six maps plus a random option');
    assert.equal(boot.rules, 3, 'three rulesets');
    assert.match(boot.net, /ONLINE/i, 'should connect to the multiplayer server, got: ' + boot.net);
    assert.equal(boot.webgl, true, 'WebGL context must exist');

    // Menu panels render their data.
    await page.click('#btnBarracks');
    await page.waitForSelector('#screen-barracks:not(.hidden)');
    const barracks = await page.evaluate(() => ({
      level: document.getElementById('bkLevel').textContent,
      stats: document.querySelectorAll('#statsTable tr').length,
      unlocks: document.querySelectorAll('#unlockList .unlock-row').length,
      weapons: document.querySelectorAll('#weaponLevels #wlRow').length
    }));
    assert.ok(Number(barracks.level) >= 1);
    assert.equal(barracks.stats, 8, 'eight stat rows');
    assert.ok(barracks.unlocks > 20, 'unlock table should list every unlockable');
    assert.equal(barracks.weapons, 12, 'twelve weapons in the progression table');
    await page.click('#btnBarracksBack');

    await page.click('#btnLoadout');
    await page.waitForSelector('#screen-loadout:not(.hidden)');
    const loadout = await page.evaluate(() => ({
      primaries: document.querySelectorAll('#primaryList .item').length,
      secondaries: document.querySelectorAll('#secondaryList .item').length,
      lethals: document.querySelectorAll('#lethalList .item').length,
      tacticals: document.querySelectorAll('#tacticalList .item').length,
      streaks: document.querySelectorAll('#streakList .item').length,
      attachments: document.querySelectorAll('#attachList .item').length,
      locked: document.querySelectorAll('#primaryList .item.locked').length
    }));
    assert.equal(loadout.primaries, 9, 'nine non-pistol primaries');
    assert.equal(loadout.secondaries, 3, 'three pistols');
    assert.equal(loadout.lethals, 3);
    assert.equal(loadout.tacticals, 3);
    assert.equal(loadout.streaks, 6);
    assert.equal(loadout.attachments, 7);
    assert.ok(loadout.locked > 0, 'a level 1 profile should have locked weapons');
    await page.click('#btnLoadoutBack');

    // Deploy into a real match.
    await page.click('#btnDeploy');
    await page.waitForSelector('#screen-queue:not(.hidden)', { timeout: 5000 });
    await page.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'), { timeout: 25000 });

    // Pointer lock cannot be granted headlessly, so drive the game through the
    // same code path by faking the lock flag and issuing key events.
    await page.evaluate(() => {
      const input = window.__game?.input;
      if (input) input.locked = true;
    });

    // Let the match run and simulate movement + firing.
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(640 + i * 3, 400);
      await page.mouse.down();
      await new Promise((r) => setTimeout(r, 90));
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 90));
    }
    await page.keyboard.up('KeyW');
    await new Promise((r) => setTimeout(r, 1200));

    const inMatch = await page.evaluate(() => {
      const c = document.getElementById('gl');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const px = new Uint8Array(4 * 200);
      gl.readPixels(Math.floor(c.width / 2) - 10, Math.floor(c.height / 2) - 5, 20, 10, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let nonBlack = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) nonBlack++;
      return {
        hudVisible: !document.getElementById('hud').classList.contains('hidden'),
        weapon: document.getElementById('weaponName').textContent,
        ammo: document.getElementById('ammoValue').textContent,
        timer: document.getElementById('timer').textContent,
        mode: document.getElementById('modeLabel').textContent,
        nonBlackPixels: nonBlack,
        fps: document.getElementById('fpsCounter').textContent,
        net: window.__game?.online
      };
    });

    assert.equal(inMatch.hudVisible, true, 'HUD should be visible in a match');
    assert.ok(inMatch.weapon.length > 0, 'weapon name should be shown');
    assert.ok(/^\d+$/.test(inMatch.ammo), 'ammo should be a number, got ' + inMatch.ammo);
    assert.match(inMatch.timer, /^\d+:\d\d$/, 'timer should count down, got ' + inMatch.timer);
    assert.equal(inMatch.mode, 'TDM');
    assert.ok(inMatch.nonBlackPixels > 40, `renderer should draw a real scene, got ${inMatch.nonBlackPixels}/200 lit pixels`);
    assert.match(inMatch.fps, /FPS/, 'FPS counter should be running');
    assert.equal(inMatch.net, true, 'should be playing over the real server');

    // Scoreboard
    await page.keyboard.down('Tab');
    await new Promise((r) => setTimeout(r, 400));
    const sb = await page.evaluate(() => ({
      visible: !document.getElementById('scoreboard').classList.contains('hidden'),
      rows: document.querySelectorAll('#sbTeamA .sb-row, #sbTeamB .sb-row').length
    }));
    await page.keyboard.up('Tab');
    assert.equal(sb.visible, true, 'Tab should open the scoreboard');
    assert.ok(sb.rows >= 6, 'scoreboard should list the lobby, got ' + sb.rows);

    const shot = path.join(ROOT, '.data', 'browser-match.png');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });

    assert.deepEqual(errors, [], 'no page errors allowed:\n' + errors.join('\n') + '\nlogs:\n' + logs.slice(-25).join('\n'));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
  }
});
