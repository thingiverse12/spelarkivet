/**
 * Runs the real client (js/client/main.js + input.js + shared sim) inside
 * jsdom, with only the WebGL renderer, the 2D HUD and the audio engine stubbed
 * out. This is what proves the game is actually *playable* without a browser:
 * press W, the player moves.
 *
 * Pointer lock cannot be granted by jsdom, which is exactly the situation the
 * client hits when it is embedded in a frame that does not allow it — so this
 * test also pins the keyboard-look fallback that keeps the game controllable.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const STUBS = {
  './renderer.js': './harness/stub-renderer.js',
  './hud.js': './harness/stub-hud.js',
  './audio.js': './harness/stub-audio.js'
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/js/client/main.js') && STUBS[specifier]) {
      return { url: new URL(STUBS[specifier], import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8000/', pretendToBeVisual: true });
const { window } = dom;

for (const k of ['document', 'navigator', 'HTMLElement', 'Element', 'Event', 'MouseEvent',
  'KeyboardEvent', 'Node', 'getComputedStyle', 'cancelAnimationFrame', 'localStorage', 'location']) {
  // Some of these (navigator) are getter-only on Node's global, so define them.
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true });
}
globalThis.window = window;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

// Wrappable so the frame loop can be stopped at the end of the run.
let stopFrames = false;
let frameCount = 0;
globalThis.requestAnimationFrame = (cb) =>
  (stopFrames ? 0 : window.requestAnimationFrame((ts) => { frameCount++; cb(ts); }));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

// No server here: make the WebSocket fail instantly so the client falls back to
// the offline/bot connection, which is the path a static deploy uses.
globalThis.WebSocket = class { constructor() { throw new Error('no server in this test'); } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const key = (code, type = 'keydown') =>
  window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true }));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

await import('../js/client/main.js');
const G = await waitFor(() => window.__game, 10000, 'boot() to expose window.__game')
  .then(() => window.__game);

/**
 * Hold keys for a moment and report how far the player travelled. Hardcore bots
 * shoot back, so a dead player is not a failure — wait for a respawn and retry.
 */
async function travelWhileHolding(keys, holdMs = 700) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await waitFor(() => G.myState?.alive, 20000, 'a respawn');
    const start = { ...G.local.pos };
    for (const k of keys) key(k);
    await sleep(holdMs);
    for (const k of keys) key(k, 'keyup');
    const moved = Math.hypot(G.local.pos.x - start.x, G.local.pos.z - start.z);
    if (G.myState?.alive) return moved;
  }
  throw new Error('the player died during every measurement window');
}

test('the client boots into the menu without WebGL', () => {
  assert.equal(G.screen, 'menu');
  assert.ok(G.input, 'input should be constructed');
  assert.equal(G.input.locked, false, 'jsdom grants no pointer lock');
});

test('WASD moves the player even though pointer lock is unavailable', async () => {
  click(window.document.getElementById('btnDeploy'));
  await waitFor(() => G.screen === 'match', 15000, 'an offline match to start');
  assert.ok(G.local, 'the local prediction body should exist');
  assert.ok(frameCount > 10, 'the frame loop should be running');

  // The real user action: click the canvas ("CLICK TO DEPLOY"), which requests
  // pointer lock. jsdom never grants it, so the client must notice and switch
  // to the fallback instead of staying inert.
  click(window.document.getElementById('gl'));
  await waitFor(() => G.input.fallbackLook, 4000, 'the pointer-lock fallback to engage');
  assert.equal(G.input.controlling, true, 'the player must be in control');
  assert.equal(G.input.locked, false, 'still no real pointer lock');

  const moved = await travelWhileHolding(['KeyW']);
  assert.ok(moved > 1, `W should move the player, moved ${moved.toFixed(2)} m`);

  // The sim must agree with the client, otherwise the 2.2 m resync check would
  // snap the player back and it would feel like the keys do nothing.
  const mine = G.snap.players.find((p) => p.id === G.match.you);
  const lag = Math.hypot(mine.x - G.local.pos.x, mine.z - G.local.pos.z);
  assert.ok(lag < 2.2, `the sim must follow the client (lag ${lag.toFixed(2)} m)`);
});

test('sprint and strafe reach the sim while pointer lock is unavailable', async () => {
  // Sprinting needs forward motion, so hold W + Shift together.
  const moved = await travelWhileHolding(['KeyW', 'ShiftLeft']);
  assert.ok(moved > 1, `sprint should move the player, moved ${moved.toFixed(2)} m`);
  assert.equal(G.lastPacket.sprint, true, 'the sprint flag must be sent');

  await travelWhileHolding(['KeyD']);
  assert.ok(G.lastPacket.mx !== 0, 'the strafe axis must be sent');
});

test('arrow keys look around when pointer lock is missing', async () => {
  const yawBefore = G.local.yaw;
  key('ArrowRight');
  await sleep(500);
  key('ArrowRight', 'keyup');
  const turned = Math.abs(G.local.yaw - yawBefore);
  assert.ok(turned > 0.1, `arrow keys should turn the view, turned ${turned.toFixed(3)} rad`);
});

test('space jumps', async () => {
  await waitFor(() => G.myState?.alive, 20000, 'a respawn');
  let leftGround = false;
  const sample = setInterval(() => {
    if (!G.local.onGround || G.local.vel.y > 0.5) leftGround = true;
  }, 8);
  key('Space');
  await sleep(400);
  key('Space', 'keyup');
  clearInterval(sample);
  assert.ok(leftGround, 'space should have left the ground');
});

// jsdom's requestAnimationFrame loop and the local connection's tick timer
// would otherwise keep the process alive forever.
after(() => {
  stopFrames = true;
  G.conn?.close();
  dom.window.close();
});
