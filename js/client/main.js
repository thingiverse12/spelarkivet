/**
 * Duty Calls — client entry point.
 * Owns the state machine (menu → queue → match → results), local prediction,
 * snapshot interpolation and all DOM/HUD wiring.
 */
import { loadThree, Renderer } from './renderer.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { audio } from './audio.js';
import { setLang, t, tn } from './i18n.js';
import { ServerConnection, LocalConnection, serverUrl } from './net.js';

import { getMap, MAP_LIST } from '../shared/maps.js';
import { MODES } from '../shared/modes.js';
import {
  WEAPONS, WEAPON_MAP, ATTACHMENTS, LETHALS, TACTICALS,
  effectiveWeapon, DEFAULT_LOADOUT, CLASSES
} from '../shared/weapons.js';
import { perksBySlot } from '../shared/perks.js';
import { KILLSTREAKS } from '../shared/killstreaks.js';
import {
  createProfile, normalizeProfile, levelFromXp, weaponLevelFromXp,
  isUnlocked, UNLOCKABLES, attachmentsUnlockedFor, kd
} from '../shared/progression.js';
import { RULESETS, BASE_SPEED, SPRINT_MUL, CROUCH_MUL, JUMP_VEL } from '../shared/sim.js';
import {
  integrate, accelerate, clampSpeed, horizontalSpeed, raycastWorld,
  PLAYER_HALF, PLAYER_HEIGHT, EYE_HEIGHT, EYE_HEIGHT_CROUCH
} from '../shared/physics.js';
import { clamp } from '../shared/math3.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'dutycalls.profile.v2';
const INPUT_HZ = 30;

/* ============================ state ============================ */

const G = {
  screen: 'loading',
  THREE: null,
  renderer: null,
  hud: null,
  input: null,
  conn: null,
  online: false,
  profile: null,
  profileId: null,
  selection: { mode: 'tdm', map: null, ruleset: 'hardcore' },
  match: null,
  local: null,
  remote: new Map(),
  snap: null,
  entities: [],
  lastInputSent: 0,
  bloom: 0,
  viewKick: 0,
  bobPhase: 0,
  sway: { x: 0, y: 0 },
  ads: 0,
  reloadAnim: 0,
  lastSnapshotAt: 0,
  fps: 0,
  fpsAccum: 0,
  fpsFrames: 0,
  chatOpen: false,
  respawnAt: 0,
  damageFlash: 0,
  toasts: [],
  resultTimer: 0,
  pendingReloadSound: false
};

/* ============================ boot ============================ */

function setStatus(text, pct) {
  $('loadStatus').textContent = text;
  if (pct != null) $('loadFill').style.width = pct + '%';
}

async function boot() {
  try {
    setStatus('LOADING ENGINE', 15);
    G.THREE = await loadThree();
    setStatus('BUILDING RENDERER', 35);
    G.renderer = new Renderer($('gl'), G.THREE);
    G.input = new Input($('gl'));
    G.hud = new Hud($('overlay'), {
      banner: $('banner'), killfeed: $('killfeed')
    });
    setStatus('LOADING PROFILE', 55);
    loadProfile();
    setLang(G.profile.settings.lang || 'en');
    applySettings();
    buildMenus();
    setStatus('CONNECTING', 70);
    await connect();
    setStatus('READY', 100);
    wireEvents();
    $('loading').classList.add('hidden');
    showScreen('main');
    // Exposed for debugging and for the automated browser test.
    window.__game = G;
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    $('loading').classList.add('hidden');
    $('fatal').classList.remove('hidden');
    $('fatalText').textContent = err && err.message ? err.message : String(err);
  }
}

function loadProfile() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { stored = null; }
  G.profile = normalizeProfile(stored || createProfile('Soldier'));
  if (!G.profile.loadouts.length) {
    G.profile.loadouts = [structuredClone(DEFAULT_LOADOUT)];
  }
  G.profileId = localStorage.getItem(STORE_KEY + '.id');
  if (!G.profileId) {
    G.profileId = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(STORE_KEY + '.id', G.profileId);
  }
  saveProfile();
}

function saveProfile() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(G.profile)); } catch { /* quota */ }
}

function currentLoadout() {
  const list = G.profile.loadouts;
  const idx = clamp(G.profile.selectedLoadout || 0, 0, list.length - 1);
  return list[idx] || DEFAULT_LOADOUT;
}

async function connect() {
  const conn = new ServerConnection(serverUrl());
  const ok = await conn.connect(3500);
  if (ok) {
    G.conn = conn;
    G.online = true;
    setNetStatus(true, t('serverFound'));
  } else {
    G.conn = new LocalConnection();
    G.online = false;
    setNetStatus(false, t('serverMissing'));
  }
  G.conn.onMessage(onMessage);
  if (G.conn.startPing) G.conn.startPing();
  G.conn.send({
    t: 'hello',
    name: G.profile.name,
    profileId: G.profileId,
    profile: G.profile,
    loadout: currentLoadout()
  });
}

function setNetStatus(ok, text) {
  const el = $('netStatus');
  el.className = ok ? 'ok' : 'bad';
  $('netStatusText').textContent = `${ok ? t('online') : t('offline')} — ${text}`;
}

/* ============================ network ============================ */

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      if (msg.rulesets?.length) G.rulesets = msg.rulesets;
      break;
    case 'profile':
      if (msg.profile) {
        const xp = Math.max(msg.profile.xp || 0, G.profile.xp);
        G.profile = normalizeProfile({ ...G.profile, ...msg.profile, xp });
        saveProfile();
        refreshIdentity();
      }
      break;
    case 'queued':
      $('queueInfo').textContent = `${msg.mode.toUpperCase()} · ${msg.position || 1} ${t('playersInQueue')}`;
      break;
    case 'matchStart':
      startMatch(msg);
      break;
    case 'snap':
      applySnapshot(msg);
      break;
    case 'ev':
      handleEvents(msg.e || []);
      break;
    case 'matchEnd':
      showResults(msg);
      break;
    case 'rotating':
      break;
    case 'chat':
      pushToast(`${msg.from}: ${msg.text}`);
      break;
    case 'leftMatch':
    case 'queueLeft':
      showScreen('main');
      break;
    case 'error':
      pushToast(msg.msg);
      break;
    default:
      break;
  }
}

/* ============================ match ============================ */

function startMatch(msg) {
  const map = getMap(msg.map);
  G.match = {
    mode: msg.mode,
    mapId: msg.map,
    mapName: msg.mapName || map.name,
    teams: !!msg.teams,
    you: msg.you,
    team: msg.team,
    scoreLimit: msg.scoreLimit,
    ruleset: msg.ruleset,
    startedAt: performance.now()
  };
  G.renderer.loadMap(map);
  G.hud.setMap(map);
  G.hud.clear();
  G.remote.clear();
  G.bloom = 0;
  G.viewKick = 0;
  G.renderer.clearPlayers();
  audio.heliLoop(false);

  // Prime the local prediction body from the initial snapshot.
  const initial = msg.initial;
  const me = initial.players.find((p) => p.id === msg.you);
  G.local = {
    pos: { x: me.x, y: me.y, z: me.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: me.yaw, pitch: me.pitch,
    onGround: true, crouching: false,
    height: PLAYER_HEIGHT, half: PLAYER_HALF,
    health: me.health ?? RULESETS[msg.ruleset]?.health ?? 30,
    maxHealth: me.maxHealth ?? 30
  };
  G.snap = initial;
  applySnapshot(initial);

  // Viewmodel
  const lo = currentLoadout();
  const def = effectiveWeapon(lo.primary, lo.primaryAttachments);
  G.renderer.setViewModel(def, lo.primaryAttachments);
  $('slot0').querySelector('.slot-name').textContent = def.name.toUpperCase();
  $('slot1').querySelector('.slot-name').textContent = effectiveWeapon(lo.secondary, lo.secondaryAttachments).name.toUpperCase();

  $('modeLabel').textContent = (MODES[msg.mode]?.short || msg.mode).toUpperCase();
  $('scoreLimit').textContent = msg.scoreLimit ? `/ ${msg.scoreLimit}` : '';
  document.querySelector('#topbar .team-a .team-label').textContent = msg.teams ? t('teamA') : t('player');
  document.querySelector('#topbar .team-b .team-label').textContent = msg.teams ? t('teamB') : '';
  document.querySelector('#topbar .team-b').style.visibility = msg.teams ? 'visible' : 'hidden';

  showScreen(null);
  $('hud').classList.remove('hidden');
  $('pauseHint').classList.remove('hidden');
  $('resumeHint').textContent = t('clickToPlay');
  G.screen = 'match';
  audio.matchFound();
}

function leaveMatch() {
  G.conn.send({ t: 'leaveMatch' });
  G.conn.send({ t: 'leaveQueue' });
  G.screen = 'menu';
  G.match = null;
  G.renderer.clearPlayers();
  audio.heliLoop(false);
  $('hud').classList.add('hidden');
  G.input.releaseLock();
  showScreen('main');
}

/* --------------------------- snapshots --------------------------- */

function applySnapshot(snap) {
  G.snap = snap;
  G.lastSnapshotAt = performance.now();
  if (!G.match) return;
  const me = snap.players.find((p) => p.id === G.match.you);
  if (!me) return;

  // Authoritative state the client must not predict.
  if (G.local) {
    G.local.health = me.health ?? G.local.health;
    G.local.maxHealth = me.maxHealth ?? G.local.maxHealth;
    if (me.resync) {
      G.local.pos = { x: me.x, y: me.y, z: me.z };
      G.local.vel = { x: 0, y: 0, z: 0 };
    } else {
      const d = Math.hypot(me.x - G.local.pos.x, me.y - G.local.pos.y, me.z - G.local.pos.z);
      if (d > 2.2) {
        G.local.pos = { x: me.x, y: me.y, z: me.z };
        G.local.vel = { x: 0, y: 0, z: 0 };
      }
    }
    if (!me.alive && G.respawnAt === 0) G.respawnAt = performance.now() + 3000;
    if (me.alive) G.respawnAt = 0;
  }
  G.myState = me;

  // Remote players: smooth toward the snapshot position.
  const seen = new Set();
  for (const p of snap.players) {
    if (p.id === G.match.you) continue;
    seen.add(p.id);
    let r = G.remote.get(p.id);
    if (!r) {
      r = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, vx: 0, vz: 0, lastT: performance.now() };
      G.remote.set(p.id, r);
    }
    const now = performance.now();
    const dt = Math.max(0.016, (now - r.lastT) / 1000);
    r.vx = (p.x - r.x) / dt;
    r.vz = (p.z - r.z) / dt;
    r.tx = p.x; r.ty = p.y; r.tz = p.z;
    r.tyaw = p.yaw; r.tpitch = p.pitch;
    r.lastT = now;
    r.state = p;
  }
  for (const id of [...G.remote.keys()]) if (!seen.has(id)) G.remote.delete(id);

  G.entities = snap.entities || [];
  const heli = G.entities.some((e) => e.kind === 'heli');
  audio.heliLoop(heli);
}

function interpolateRemotes(dt) {
  const k = Math.min(1, dt / 0.055);
  for (const r of G.remote.values()) {
    if (r.tx == null) continue;
    r.x += (r.tx - r.x) * k;
    r.y += (r.ty - r.y) * k;
    r.z += (r.tz - r.z) * k;
    r.yaw += shortAngle(r.tyaw - r.yaw) * k;
    r.pitch += (r.tpitch - r.pitch) * k;
  }
}

function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* --------------------------- events --------------------------- */

function handleEvents(events) {
  if (!G.match) return;
  const me = G.match.you;
  const listener = G.local;
  for (const e of events) {
    switch (e.t) {
      case 'shot': {
        const own = e.by === me;
        const def = WEAPON_MAP[e.weapon] || null;
        const sp = audio.spatial(e.pos, listener, listener?.yaw || 0);
        if (!e.silent) audio.shot(e.weapon === 'sentry' || e.weapon === 'heli' ? e.weapon : (def?.sfx || 'ar'), { gain: own ? 1 : sp.gain, pan: own ? 0 : sp.pan });
        if (own) {
          G.renderer.setMuzzleFlash(true);
          setTimeout(() => G.renderer.setMuzzleFlash(false), 45);
          applyRecoil(def);
        }
        for (const end of e.ends || []) G.renderer.addTracer(e.pos, end);
        break;
      }
      case 'impact':
        if (near(e.pos, 60)) G.renderer.addImpact(e.pos, e.normal);
        break;
      case 'hit': {
        if (e.by === me) {
          G.hud.hitmarker({ head: e.head });
          audio.hitmarker(e.head);
          const victim = G.remote.get(e.victim);
          if (victim) G.hud.damageNumber(e.dmg, G.renderer.project({ x: victim.x, y: victim.y + 1.4, z: victim.z }), e.head);
        }
        if (e.victim === me) {
          G.damageFlash = 1;
          showHitDirection(e.by);
          if (e.cause === 'bullet') audio.tone(120, 0.1, 'sine', 0.12, 60);
        }
        break;
      }
      case 'kill': {
        G.hud.pushKill({
          killer: e.killerName, victim: e.victimName, head: e.head, cause: e.cause,
          killerTeam: G.match.teams ? e.killerTeam : null,
          victimTeam: G.match.teams ? e.victimTeam : null,
          suicide: e.suicide
        });
        if (e.killer === me) {
          audio.killConfirm();
          G.hud.hitmarker({ kill: true, head: e.head });
        }
        if (e.victim === me) {
          audio.death();
          showDeath(e);
        }
        if (e.killerTeam && e.killer !== me && e.victim !== me) {
          // positional kill sound cue could go here
        }
        break;
      }
      case 'explosion': {
        const sp = audio.spatial(e.pos, listener, listener?.yaw || 0);
        audio.explosion({ gain: Math.max(0.15, sp.gain), pan: sp.pan });
        G.renderer.addExplosion(e.pos, e.radius || 6);
        break;
      }
      case 'throw':
        if (e.by === me) audio.grenadeThrow();
        break;
      case 'bounce':
        if (near(e.pos, 30)) audio.bounce();
        break;
      case 'flash': {
        const mine = (e.affected || []).find((a) => a.id === me);
        if (mine) {
          $('flashOverlay').style.opacity = String(Math.min(0.95, 0.35 + mine.strength * 0.6));
          setTimeout(() => { $('flashOverlay').style.opacity = '0'; }, 260);
          audio.flash();
        }
        break;
      }
      case 'smoke':
        break;
      case 'reload':
        if (e.id === me) { audio.reload(0); G.reloadAnim = 0.001; }
        break;
      case 'reloadDone':
        if (e.id === me) audio.reload(1);
        break;
      case 'swap':
        if (e.id === me) audio.swap();
        break;
      case 'dryfire':
        if (e.id === me) audio.dryfire();
        break;
      case 'step': {
        const sp = audio.spatial(e.pos, listener, listener?.yaw || 0);
        if (e.id === me || sp.gain > 0.12) audio.footstep(e.kind === 'run', { gain: e.id === me ? 1 : sp.gain, pan: e.id === me ? 0 : sp.pan });
        break;
      }
      case 'streakReady':
        if (e.id === me) { audio.streakReady(); pushToast(t('streakReady') + ': ' + streakName(e.streak)); }
        break;
      case 'streak': {
        if (e.by === me) {
          G.hud.setBanner(streakName(e.id).toUpperCase(), e.team === 'ffa' ? '' : (e.team === 'a' ? t('teamA') : t('teamB')), 2);
          if (e.id === 'uav' || e.id === 'counteruav') audio.uav();
        }
        break;
      }
      case 'capture':
        G.hud.setBanner(`${e.flag} ${e.team === (G.match.team) ? t('captured') : t('neutralized')}`, '', 1.8);
        audio.capture();
        break;
      case 'roundStart':
        G.hud.setBanner(`${t('roundStart')} ${e.round}`, e.attackers === G.match.team ? t('attackers') : t('defenders'), 2.4);
        break;
      case 'roundEnd':
        G.hud.setBanner(e.winner === G.match.team ? t('victory') : t('defeat'), '', 2.4);
        break;
      case 'bombPlanted':
        G.hud.setBanner(t('bombPlanted'), '', 2.4);
        audio.plant();
        break;
      case 'gunGameAdvance':
        if (e.id === me) G.hud.setBanner('WEAPON UP', WEAPON_MAP[e.weapon]?.name || '', 1.6);
        break;
      case 'end':
        break;
      default:
        break;
    }
  }
}

function near(pos, max) {
  if (!G.local || !pos) return true;
  return Math.hypot(pos.x - G.local.pos.x, pos.z - G.local.pos.z) < max;
}

function applyRecoil(def) {
  if (!def || !G.local) return;
  const ads = G.ads > 0.5;
  const mul = ads ? 0.75 : 1;
  G.local.pitch = clamp(G.local.pitch + def.recoil.vert * 0.011 * mul, -1.55, 1.55);
  G.local.yaw += (Math.random() - 0.5) * def.recoil.horz * 0.016;
  G.viewKick += def.recoil.vert * 0.008;
  G.bloom = Math.min(7, G.bloom + def.spread.climb);
}

function showDeath(e) {
  const killer = e.killerName || (e.cause === 'fall' ? 'gravity' : null);
  $('killerLine').innerHTML = killer
    ? `${t('youDied')} <b>${escapeHtml(killer)}</b>${e.head ? ' ✸' : ''}`
    : (e.suicide ? 'YOU DIED' : t('youDied'));
  $('respawnOverlay').classList.remove('hidden');
}

function showHitDirection(attackerId) {
  const r = G.remote.get(attackerId);
  if (!r || !G.local) return;
  const dx = r.x - G.local.pos.x, dz = r.z - G.local.pos.z;
  const ang = Math.atan2(dx, -dz) - G.local.yaw;
  const el = document.createElement('div');
  el.className = 'hit-arrow';
  el.style.transform = `rotate(${ang}rad)`;
  $('hitDirection').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function streakName(id) {
  const s = KILLSTREAKS.find((k) => k.id === id);
  return s ? tn(s) : String(id);
}

/* ============================ frame ============================ */

let lastFrame = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (G.profile.settings.showFps) {
    G.fpsAccum += dt; G.fpsFrames++;
    if (G.fpsAccum > 0.5) {
      G.fps = Math.round(G.fpsFrames / G.fpsAccum);
      G.fpsAccum = 0; G.fpsFrames = 0;
      $('fpsCounter').textContent = `${G.fps} FPS · ${G.online ? 'NET' : 'LOCAL'}${G.conn?.latency ? ' · ' + G.conn.latency + 'ms' : ''}`;
    }
  }

  if (G.screen === 'match' && G.match && G.local) {
    updateLocal(dt, now);
    interpolateRemotes(dt);
    drawWorld(dt);
    updateHud(dt);
  } else if (G.screen === 'menu') {
    // Idle menu background: slowly orbit the currently selected map.
    if (G.renderer.mapLoadedFor !== G.selection.map) {
      const map = getMap(G.selection.map || 'rust');
      G.renderer.loadMap(map);
      G.renderer.mapLoadedFor = G.selection.map || 'rust';
    }
    const tsec = now / 1000;
    G.renderer.update(dt, { x: Math.cos(tsec * 0.08) * 26, y: 14, z: Math.sin(tsec * 0.08) * 26, yaw: -tsec * 0.08 + Math.PI, pitch: -0.28, fov: 70 });
    G.renderer.render(false);
  }

  G.input.endFrame();
}

function updateLocal(dt, now) {
  const input = G.input;
  const me = G.myState;
  const locked = input.locked;

  // ---- look -------------------------------------------------------
  if (locked && !G.chatOpen) {
    const sens = 0.0022 * (G.profile.settings.sensitivity || 1);
    G.local.yaw -= input.mouse.dx * sens;
    G.local.pitch -= input.mouse.dy * sens * (G.profile.settings.invertY ? -1 : 1);
    G.local.pitch = clamp(G.local.pitch, -1.55, 1.55);
    G.sway.x = clamp(G.sway.x - input.mouse.dx * 0.06, -1.4, 1.4);
    G.sway.y = clamp(G.sway.y - input.mouse.dy * 0.06, -1.4, 1.4);
  }
  G.sway.x += (0 - G.sway.x) * Math.min(1, dt * 9);
  G.sway.y += (0 - G.sway.y) * Math.min(1, dt * 9);
  G.viewKick += (0 - G.viewKick) * Math.min(1, dt * 7);
  G.bloom = Math.max(0, G.bloom - 7 * dt);
  G.damageFlash = Math.max(0, G.damageFlash - dt * 2.2);

  // ---- desired action state ---------------------------------------
  const stunned = (me?.stun || 0) > 0;
  const wantAds = locked && input.mouse.right && !stunned;
  G.ads += ((wantAds ? 1 : 0) - G.ads) * Math.min(1, dt * 12);

  // A dead player must not keep predicting movement, or the respawn snap
  // would yank the camera across the map.
  const alive = !me || me.alive;
  const mx = alive ? (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0) : 0;
  const mz = alive ? (input.down('back') ? 1 : 0) - (input.down('forward') ? 1 : 0) : 0;
  const sprint = alive && input.down('sprint') && mz < 0 && !stunned;
  const crouch = alive && input.down('crouch');
  if (!alive) { G.local.vel.x = 0; G.local.vel.z = 0; }

  // ---- movement (mirrors sim.updatePlayer exactly) ----------------
  const def = currentWeaponDef();
  const speedMul = (def?.moveSpeed ?? 1) * (RULESETS[G.match.ruleset]?.speedMul ?? 1) * (stunned ? 0.45 : 1);
  let speed = BASE_SPEED * speedMul;
  if (sprint) speed *= SPRINT_MUL;
  if (wantAds) speed *= 0.62;
  G.local.crouching = crouch;
  if (crouch) speed *= CROUCH_MUL;

  const fwd = { x: -Math.sin(G.local.yaw), y: 0, z: -Math.cos(G.local.yaw) };
  const right = { x: fwd.z, y: 0, z: -fwd.x };
  const wish = { x: fwd.x * -mz + right.x * mx, y: 0, z: fwd.z * -mz + right.z * mx };

  if (alive && locked && input.hit('jump') && G.local.onGround && !stunned) {
    G.local.vel.y = JUMP_VEL;
    G.local.onGround = false;
  }
  accelerate(G.local, wish, speed, dt);
  clampSpeed(G.local, speed * 1.35);
  integrate(G.local, G.renderer.worldFor(G.match.mapId), dt);

  // Head bob
  const hs = horizontalSpeed(G.local);
  if (G.local.onGround && hs > 0.6) G.bobPhase += dt * (hs * 1.5);

  // ---- build + send the input packet ------------------------------
  const jumpNow = alive && locked && input.hit('jump');
  const packet = {
    t: 'i',
    mx: locked ? mx : 0,
    mz: locked ? mz : 0,
    yaw: G.local.yaw,
    pitch: G.local.pitch,
    x: G.local.pos.x, y: G.local.pos.y, z: G.local.pos.z,
    ads: wantAds,
    sprint: locked && sprint,
    crouch,
    jump: jumpNow,
    fire: alive && fireHeld(def),
    reload: locked && input.hit('reload'),
    slot: currentSlot(),
    grenade: grenadeAction(),
    streak: streakAction(),
    action: locked && input.down('action'),
    target: predatorTarget()
  };
  // Edge-triggered actions must never be swallowed by the 30 Hz throttle.
  const urgent = packet.jump || packet.reload || packet.grenade || packet.streak !== null || packet.fire;
  if (urgent || now - G.lastInputSent > 1000 / INPUT_HZ) {
    G.lastInputSent = now;
    G.conn.send(packet);
  }
  G.lastPacket = packet;
}

let slotState = 0;
let grenadeLatch = { lethal: 0, tactical: 0 };
let streakLatch = [0, 0, 0];

function currentSlot() {
  const input = G.input;
  if (input.hit('primary')) slotState = 0;
  if (input.hit('secondary')) slotState = 1;
  if (input.consumeWheel()) slotState = (slotState + 1) % 2;
  return slotState;
}

function currentWeaponDef() {
  const lo = currentLoadout();
  const id = slotState === 0 ? lo.primary : lo.secondary;
  const att = slotState === 0 ? lo.primaryAttachments : lo.secondaryAttachments;
  return effectiveWeapon(id, att);
}

/** Semi-auto weapons fire on the click edge; the flag is latched so a click
 *  that lands between two 30 Hz packets is never dropped. */
function fireHeld(def) {
  if (!G.input.locked) { G.semiPending = false; return false; }
  if (def?.auto) return G.input.mouse.left;
  if (G.input.mouse.leftPressed) G.semiPending = true;
  if (G.semiPending) { G.semiPending = false; return true; }
  return false;
}

function grenadeAction() {
  const now = performance.now();
  if (G.input.hit('lethal') && now - grenadeLatch.lethal > 900) { grenadeLatch.lethal = now; return 'lethal'; }
  if (G.input.hit('tactical') && now - grenadeLatch.tactical > 900) { grenadeLatch.tactical = now; return 'tactical'; }
  return null;
}

function streakAction() {
  const now = performance.now();
  for (let i = 0; i < 3; i++) {
    if (G.input.hit('streak' + (i + 1)) && now - streakLatch[i] > 600) {
      streakLatch[i] = now;
      return i;
    }
  }
  return null;
}

function predatorTarget() {
  if (!G.local) return null;
  const world = G.renderer.worldFor(G.match.mapId);
  if (!world) return null;
  const yaw = G.local.yaw, pitch = G.local.pitch;
  const cp = Math.cos(pitch);
  const dir = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  const origin = { x: G.local.pos.x, y: G.local.pos.y + EYE_HEIGHT, z: G.local.pos.z };
  const hit = raycastWorld(world, origin, dir, 200);
  const p = hit ? hit.point : { x: origin.x + dir.x * 60, y: 0, z: origin.z + dir.z * 60 };
  return { x: p.x, z: p.z };
}

function drawWorld(dt) {
  const me = G.local;
  const eyeY = me.crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
  const def = currentWeaponDef();
  G.renderer.setViewModel(def, slotState === 0 ? currentLoadout().primaryAttachments : currentLoadout().secondaryAttachments);

  // Remote players
  for (const [id, r] of G.remote) {
    G.renderer.updatePlayer({
      id, x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch,
      crouch: r.state?.crouch, alive: r.state?.alive, team: r.state?.team,
      vx: r.vx, vz: r.vz
    }, false, dt);
  }
  // Local player body is hidden but the entry keeps the renderer consistent.
  G.renderer.updatePlayer({ id: G.match.you, alive: true, x: me.pos.x, y: me.pos.y, z: me.pos.z, yaw: me.yaw, team: G.match.team }, true, dt);

  G.renderer.syncEntities(G.entities, performance.now() / 1000);

  G.reloadAnim = G.myState?.reloading ? Math.min(1, G.reloadAnim + dt * 1.2) : 0;

  G.renderer.update(dt, {
    x: me.pos.x, y: me.pos.y + eyeY, z: me.pos.z,
    yaw: me.yaw, pitch: me.pitch + G.viewKick, roll: 0,
    fov: (G.profile.settings.fov || 80) / (1 + (def?.zoom ? (def.zoom - 1) * G.ads : 0))
  });
  G.renderer.updateViewModel({
    ads: G.ads, bob: G.bobPhase, sway: G.sway,
    recoil: Math.min(1, G.viewKick * 22),
    reload: G.reloadAnim,
    sprint: G.input.down('sprint') && G.ads < 0.2
  }, dt);
  G.renderer.render(true);
}

/* ============================ HUD DOM ============================ */

function updateHud(dt) {
  const me = G.myState;
  if (!me) return;
  // Health
  const hp = Math.max(0, Math.round(G.local.health));
  $('healthValue').textContent = hp;
  const pct = clamp(hp / (G.local.maxHealth || 30), 0, 1);
  $('healthFill').style.width = (pct * 100) + '%';
  $('healthFill').style.background = pct > 0.6 ? 'var(--good)' : pct > 0.3 ? 'var(--accent2)' : 'var(--red)';
  $('lowHealth').style.opacity = String(pct < 0.35 ? (0.35 - pct) * 1.6 : 0);
  $('hitDirection').style.opacity = '1';

  // Ammo
  $('ammoValue').textContent = me.ammo ?? 0;
  $('ammoReserve').textContent = '/ ' + (me.reserve ?? 0);
  $('weaponName').textContent = (WEAPON_MAP[me.weapon]?.name || '').toUpperCase();
  $('ammoPanel').classList.toggle('low', (me.ammo ?? 0) <= Math.ceil((WEAPON_MAP[me.weapon]?.mag || 30) * 0.25));
  $('slot0').classList.toggle('active', me.slot === 0);
  $('slot1').classList.toggle('active', me.slot === 1);

  // Equipment
  $('eqLethal').querySelector('.eq-count').textContent = me.lethal ?? 0;
  $('eqTactical').querySelector('.eq-count').textContent = me.tactical ?? 0;
  $('eqLethal').classList.toggle('empty', !(me.lethal > 0));
  $('eqTactical').classList.toggle('empty', !(me.tactical > 0));

  // Killstreaks
  const lo = currentLoadout();
  const ready = me.streaksReady || [];
  const panel = $('streakPanel');
  if (panel.childElementCount !== 3) {
    panel.innerHTML = (lo.killstreaks || []).slice(0, 3).map((id, i) =>
      `<div class="streak" data-streak="${id}"><span class="key">${i + 4}</span><span>${streakName(id)}</span></div>`).join('');
  }
  [...panel.children].forEach((el, i) => {
    const id = (lo.killstreaks || [])[i];
    el.classList.toggle('ready', ready.includes(id));
  });

  // Timer + score
  const snap = G.snap;
  if (snap) {
    if (snap.timeLeft >= 0) {
      const m = Math.floor(snap.timeLeft / 60);
      const s = snap.timeLeft % 60;
      $('timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
    } else {
      $('timer').textContent = '∞';
    }
    if (G.match.teams) {
      $('scoreA').textContent = snap.teams.a;
      $('scoreB').textContent = snap.teams.b;
    } else {
      const top = (snap.scoreboard?.players || []).slice(0, 1);
      $('scoreA').textContent = top.length ? top[0].kills : 0;
      $('scoreLimit').textContent = `/ ${snap.scoreLimit}`;
    }

    // Domination flags
    const flagsRow = $('flagsRow');
    if (snap.flags) {
      if (flagsRow.childElementCount !== snap.flags.length) {
        flagsRow.innerHTML = snap.flags.map((f) => `<span class="flag-chip" data-flag="${f.id}">${f.id}</span>`).join('');
      }
      snap.flags.forEach((f, i) => {
        const el = flagsRow.children[i];
        el.className = 'flag-chip ' + (f.team && f.owner !== f.team ? 'contested' : (f.owner || 'neutral'));
        el.textContent = f.id + (f.progress > 0.05 && (!f.owner || f.owner !== f.team) ? '…' : '');
      });
    } else if (flagsRow.childElementCount) {
      flagsRow.innerHTML = '';
    }

    // Search & Destroy round info
    const round = snap.round;
    const ri = $('roundInfo');
    const hint = $('objectiveHint');
    if (round) {
      const secs = Math.max(0, Math.round(round.timer));
      const label = round.phase === 'intermission'
        ? t('waitingForRound')
        : `${t('roundStart')} ${round.num} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      ri.textContent = label + (round.planted ? ' · ' + t('bombPlanted') : '');
      hint.textContent = round.planted
        ? (G.match.team === round.defenders ? t('pressToDefuse') : '')
        : (me.bomb ? t('pressToPlant') : '');
    } else {
      ri.textContent = '';
      hint.textContent = '';
    }

    // Minimap + overlay draw
    const uav = snap.uav || {};
    const uavOn = G.match.teams ? (uav[G.match.team] && !uav[G.match.team === 'a' ? 'jamA' : 'jamB']) : (uav.ffa && !uav.jamFfa);
    G.hud.draw({
      local: { x: G.local.pos.x, y: G.local.pos.y, z: G.local.pos.z, yaw: G.local.yaw, team: G.match.team },
      players: snap.players,
      entities: G.entities,
      flags: snap.flags,
      round: snap.round,
      teams: G.match.teams,
      you: G.match.you,
      uavOn: !!uavOn,
      stun: me.stun || 0,
      project: (p) => G.renderer.project(p)
    }, dt);

    // Crosshair spread
    const spreadPx = 6 + (me.ammo === 0 ? 0 : G.bloom * 2.4 + horizontalSpeed(G.local) * 1.1) * (G.ads > 0.5 ? 0.4 : 1);
    $('crosshair').style.setProperty('--spread', spreadPx.toFixed(1) + 'px');
    $('crosshair').classList.toggle('ads', G.ads > 0.5);

    // Scoreboard
    if (G.input.down('scoreboard')) renderScoreboard(snap);
    else $('scoreboard').classList.add('hidden');
  }

  // Respawn overlay
  const alive = me.alive;
  $('respawnOverlay').classList.toggle('hidden', alive);
  if (!alive) {
    const secs = Math.max(0, Math.ceil((G.respawnAt - performance.now()) / 1000));
    $('respawnTimer').textContent = G.match.mode === 'snd' ? '' : String(secs);
  }

  // Flash fade
  if ((me.flash || 0) > 0) $('flashOverlay').style.opacity = String(Math.min(0.92, me.flash * 0.5));

  // Chat
  if (G.input.chatOpen && !G.chatOpen) openChat();
}

function renderScoreboard(snap) {
  const el = $('scoreboard');
  el.classList.remove('hidden');
  $('sbMap').textContent = `${G.match.mapName} · ${(MODES[G.match.mode]?.short || '').toUpperCase()}`;
  const players = snap.scoreboard?.players || [];
  const rowHtml = (p) => `
    <div class="sb-row ${G.match.teams ? p.team : ''} ${p.id === G.match.you ? 'me' : ''}">
      <span>${escapeHtml(p.name)}${p.isBot ? ' <small style="opacity:.5">BOT</small>' : ''}</span>
      <span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists || 0}</span><span>${p.score}</span>
    </div>`;
  const head = `<div class="sb-row head"><span>${t('player')}</span><span>K</span><span>D</span><span>A</span><span>${t('score')}</span></div>`;
  if (G.match.teams) {
    $('sbTeamA').innerHTML = `<h4>${t('teamA')} — ${snap.teams.a}</h4>` + head + players.filter((p) => p.team === 'a').map(rowHtml).join('');
    $('sbTeamB').innerHTML = `<h4>${t('teamB')} — ${snap.teams.b}</h4>` + head + players.filter((p) => p.team === 'b').map(rowHtml).join('');
    $('sbTeamB').style.display = '';
  } else {
    $('sbTeamA').innerHTML = `<h4>${t('player')}</h4>` + head + players.map(rowHtml).join('');
    $('sbTeamB').style.display = 'none';
  }
}

function pushToast(text) {
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.textContent = text;
  $('toast').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

/* ============================ results ============================ */

function showResults(msg) {
  G.screen = 'results';
  $('hud').classList.add('hidden');
  $('scoreboard').classList.add('hidden');
  G.input.releaseLock();
  audio.heliLoop(false);

  const title = $('resultTitle');
  title.textContent = msg.winner === 'draw' ? t('draw') : (msg.won ? t('victory') : t('defeat'));
  title.className = msg.won ? 'win' : 'lose';

  const rows = (msg.scoreboard?.players || []).slice(0, 12).map((p) => `
    <div class="sb-row ${G.match?.teams ? p.team : ''} ${p.id === G.match?.you ? 'me' : ''}">
      <span>${escapeHtml(p.name)}</span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists || 0}</span><span>${p.score}</span>
    </div>`).join('');
  $('resultTable').innerHTML = `
    <div class="sb-row head"><span>${t('player')}</span><span>K</span><span>D</span><span>A</span><span>${t('score')}</span></div>${rows}`;

  const lvl = levelFromXp(msg.totalXp || G.profile.xp);
  $('resultXp').textContent = `+${msg.xp || 0} ${t('xp')} · ${t('level')} ${lvl.level}`;

  const unlocks = [];
  for (const up of msg.levelUps || []) for (const u of up.unlocks || []) unlocks.push(`${t('level')} ${up.level}: ${tn(u)}`);
  for (const u of msg.weaponUnlocks || []) unlocks.push(tn(u));
  $('resultUnlocks').innerHTML = unlocks.length
    ? `<div style="letter-spacing:2px;color:var(--dim);font-size:11px">${t('newUnlocks')}</div>` + unlocks.map((u) => `<div>▸ ${escapeHtml(u)}</div>`).join('')
    : '';
  if (unlocks.length) audio.levelUp();

  if (msg.profile) { G.profile = normalizeProfile(msg.profile); saveProfile(); refreshIdentity(); }

  G.resultTimer = msg.nextIn || 12;
  showScreen('results');
  const tick = setInterval(() => {
    G.resultTimer -= 1;
    $('resultCountdown').textContent = `${t('nextMap')} ${Math.max(0, Math.ceil(G.resultTimer))}s`;
    if (G.resultTimer <= 0 || G.screen !== 'results') {
      clearInterval(tick);
      if (G.screen === 'results') {
        showScreen('queue');
        G.screen = 'queue';
        G.conn.send({ t: 'queue', mode: G.selection.mode, map: G.selection.map, ruleset: G.selection.ruleset, loadout: currentLoadout() });
      }
    }
  }, 1000);
}

/* ============================ menus ============================ */

function showScreen(name) {
  for (const id of ['main', 'loadout', 'barracks', 'settings', 'queue', 'results']) {
    $('screen-' + id).classList.toggle('hidden', id !== name);
  }
  const menuVisible = !!name;
  $('menu').classList.toggle('hidden', !menuVisible);
  if (name === 'barracks') renderBarracks();
  if (name === 'loadout') renderLoadout();
  if (name === 'settings') renderSettings();
  if (name === 'main') {
    refreshIdentity();
    if (G.renderer) {
      G.renderer.mapLoadedFor = null; // force the menu fly-through to rebuild
    }
  }
  G.screen = name ? (name === 'queue' ? 'queue' : (name === 'results' ? 'results' : 'menu')) : G.screen;
}

function refreshIdentity() {
  const lvl = levelFromXp(G.profile.xp);
  $('rankLevel').textContent = lvl.level;
  $('nameInput').value = G.profile.name;
}

function buildMenus() {
  // Mode picker
  $('modePicker').innerHTML = Object.values(MODES).map((m) =>
    `<button data-mode="${m.id}" title="${escapeHtml(m.desc)}">${m.short || m.id.toUpperCase()}</button>`).join('');
  $('modePicker').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    G.selection.mode = b.dataset.mode;
    audio.ui();
    syncPickers();
  });

  // Map picker
  $('mapPicker').innerHTML =
    `<button data-map="">${t('randomMap')}</button>` +
    MAP_LIST.map((m) => `<button data-map="${m.id}" title="${escapeHtml(m.subtitle)} · ${m.size}">${m.name}</button>`).join('');
  $('mapPicker').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-map]');
    if (!b) return;
    G.selection.map = b.dataset.map || null;
    G.renderer.mapLoadedFor = null;
    audio.ui();
    syncPickers();
  });

  // Rules picker
  $('rulesPicker').innerHTML = Object.values(RULESETS).map((r) =>
    `<button data-rules="${r.id}" title="${escapeHtml(r.desc)}">${r.name}</button>`).join('');
  $('rulesPicker').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rules]');
    if (!b) return;
    G.selection.ruleset = b.dataset.rules;
    G.profile.settings.ruleset = b.dataset.rules;
    saveProfile();
    audio.ui();
    syncPickers();
  });

  G.selection.ruleset = G.profile.settings.ruleset || 'hardcore';
  syncPickers();
  refreshIdentity();
  buildControlsHelp();
}

function syncPickers() {
  for (const el of $('modePicker').children) el.classList.toggle('sel', el.dataset.mode === G.selection.mode);
  for (const el of $('mapPicker').children) el.classList.toggle('sel', (el.dataset.map || null) === G.selection.map);
  for (const el of $('rulesPicker').children) el.classList.toggle('sel', el.dataset.rules === G.selection.ruleset);
}

function buildControlsHelp() {
  const rows = [
    ['controlsMove', 'W A S D'], ['controlsSprint', 'SHIFT'], ['controlsJump', 'SPACE'],
    ['controlsCrouch', 'CTRL'], ['controlsFire', 'LMB'], ['controlsAds', 'RMB'],
    ['controlsReload', 'R'], ['controlsLethal', 'G'], ['controlsTactical', 'Q'],
    ['controlsSwitch', '1 / 2'], ['controlsStreak', '4 5 6'], ['controlsScore', 'TAB'],
    ['controlsAction', 'E'], ['controlsChat', 'ENTER']
  ];
  $('controlsTable').innerHTML = rows.map(([k, v]) =>
    `<div class="ctrl"><span>${t(k)}</span><span>${v}</span></div>`).join('');
}

/* --------------------------- loadout UI --------------------------- */

function renderLoadout() {
  const lo = currentLoadout();
  const unlocked = (type, id) => isUnlocked(G.profile, type, id);

  const listHtml = (items, type, selected, extra) => items.map((it) => {
    const ok = unlocked(type, it.id);
    const lvl = it.unlockLevel;
    return `<div class="item ${selected === it.id ? 'sel' : ''} ${ok ? '' : 'locked'}" data-type="${type}" data-id="${it.id}">
      <span>${escapeHtml(tn(it))}</span>
      ${extra ? extra(it) : ''}
      ${ok ? '' : `<span class="lock">${t('unlocksAt')} ${lvl}</span>`}
    </div>`;
  }).join('');

  $('primaryList').innerHTML = listHtml(WEAPONS.filter((w) => w.cls !== 'pistol'), 'weapon', lo.primary);
  $('secondaryList').innerHTML = listHtml(WEAPONS.filter((w) => w.cls === 'pistol'), 'weapon', lo.secondary);
  $('lethalList').innerHTML = listHtml(LETHALS, 'lethal', lo.lethal);
  $('tacticalList').innerHTML = listHtml(TACTICALS, 'tactical', lo.tactical);

  // Attachments for the selected primary
  const allowed = new Set(attachmentsUnlockedFor(G.profile, lo.primary));
  $('attachList').innerHTML = ATTACHMENTS.map((a) => {
    const ok = allowed.has(a.id);
    const sel = (lo.primaryAttachments || []).includes(a.id);
    return `<div class="item ${sel ? 'sel' : ''} ${ok ? '' : 'locked'}" data-type="attachment" data-id="${a.id}">
      <span>${escapeHtml(tn(a))}</span>${ok ? '' : `<span class="lock">WPN ${a.unlockWeaponLevel}</span>`}
    </div>`;
  }).join('');

  // Perks (3 slots)
  $('perkList').innerHTML = [1, 2, 3].map((slot) => {
    const options = perksBySlot(slot);
    return `<div style="margin-bottom:6px">
      <div style="font-size:10px;letter-spacing:1.6px;color:var(--dim)">${t('perk' + slot)}</div>
      ${options.map((p) => {
        const ok = unlocked('perk', p.id);
        const sel = lo['perk' + slot] === p.id;
        return `<div class="item ${sel ? 'sel' : ''} ${ok ? '' : 'locked'}" data-type="perk${slot}" data-id="${p.id}" title="${escapeHtml(p.desc)}">
          <span>${escapeHtml(tn(p))}</span>${ok ? '' : `<span class="lock">${t('unlocksAt')} ${p.unlockLevel}</span>`}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  // Killstreaks (pick up to 3)
  $('streakList').innerHTML = KILLSTREAKS.map((k) => {
    const ok = unlocked('killstreak', k.id);
    const sel = (lo.killstreaks || []).includes(k.id);
    return `<div class="item ${sel ? 'sel' : ''} ${ok ? '' : 'locked'}" data-type="streak" data-id="${k.id}" title="${escapeHtml(k.desc)}">
      <span>${escapeHtml(tn(k))}</span><span class="sub">${k.cost}</span>
      ${ok ? '' : `<span class="lock">${t('unlocksAt')} ${k.unlockLevel}</span>`}
    </div>`;
  }).join('');

  renderWeaponDetail(lo);
}

function renderWeaponDetail(lo) {
  const def = effectiveWeapon(lo.primary, lo.primaryAttachments);
  const cls = CLASSES.find((c) => c.id === def.cls);
  const wl = weaponLevelFromXp(G.profile.weaponXp?.[lo.primary] || 0);
  const bar = (label, value, max) => `<div>${label} <b>${value}</b></div><div class="bar"><div style="width:${clamp((value / max) * 100, 2, 100)}%"></div></div>`;
  $('weaponDetail').innerHTML = `
    <div style="font-size:16px;color:var(--text);letter-spacing:1px">${escapeHtml(def.name)}</div>
    <div style="color:var(--accent);font-size:11px;letter-spacing:2px;margin-bottom:8px">${cls ? tn(cls).toUpperCase() : ''} · ${t('weaponLevel')} ${wl.level}/8</div>
    ${bar('DAMAGE', def.damage, 100)}
    ${bar('FIRE RATE', Math.round(def.rpm / 12), 100)}
    ${bar('ACCURACY', Math.round(clamp(100 - def.spread.ads * 22, 5, 100)), 100)}
    ${bar('RANGE', Math.round(def.falloff[1] * 0.5), 100)}
    ${bar('MOBILITY', Math.round(def.moveSpeed * 60), 100)}
    <div style="margin-top:6px">MAG <b>${def.mag}</b> · RELOAD <b>${def.reloadTime.toFixed(1)}s</b>${def.silent ? ' · SILENCED' : ''}</div>
  `;
}

function renderBarracks() {
  const lvl = levelFromXp(G.profile.xp);
  $('bkLevel').textContent = lvl.level;
  $('bkXpFill').style.width = (lvl.maxed ? 100 : (lvl.current / lvl.next) * 100) + '%';
  $('bkXpText').textContent = lvl.maxed
    ? `${G.profile.xp.toLocaleString()} XP · MAX`
    : `${lvl.current.toLocaleString()} / ${lvl.next.toLocaleString()} XP`;

  const next = UNLOCKABLES.filter((u) => u.level > lvl.level).sort((a, b) => a.level - b.level)[0];
  $('bkNextUnlock').innerHTML = next
    ? `${t('nextUnlock')}: <b style="color:var(--accent2)">${escapeHtml(tn(next))}</b> — ${t('level')} ${next.level}`
    : 'ALL UNLOCKED';

  const s = G.profile.stats;
  $('statsTable').innerHTML = [
    [t('kills'), s.kills], [t('deaths'), s.deaths], [t('assists'), s.assists],
    [t('headshots'), s.headshots], [t('matches'), s.matches], [t('wins'), s.wins],
    [t('winRate'), s.matches ? Math.round((s.wins / s.matches) * 100) + '%' : '—'],
    [t('kd'), kd(s)]
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  $('unlockList').innerHTML = UNLOCKABLES.map((u) => `
    <div class="unlock-row ${u.level <= lvl.level ? 'done' : ''}">
      <span>${escapeHtml(tn(u))} <small style="opacity:.6">${u.type}</small></span>
      <span class="lvl">${u.level <= lvl.level ? '✓' : 'LV ' + u.level}</span>
    </div>`).join('');

  $('weaponLevels').innerHTML = WEAPONS.map((w) => {
    const wl = weaponLevelFromXp(G.profile.weaponXp?.[w.id] || 0);
    const owned = isUnlocked(G.profile, 'weapon', w.id);
    return `<div id="wlRow" style="opacity:${owned ? 1 : 0.45}">
      <span>${escapeHtml(w.name)}</span>
      <span style="font-family:var(--mono);color:var(--accent2)">${wl.level}/8</span>
    </div>
    <div class="bar"><div style="width:${wl.maxed ? 100 : (wl.current / wl.next) * 100}%"></div></div>`;
  }).join('');
}

function renderSettings() {
  const s = G.profile.settings;
  $('setSens').value = s.sensitivity;
  $('outSens').textContent = Number(s.sensitivity).toFixed(2);
  $('setFov').value = s.fov;
  $('outFov').textContent = s.fov;
  $('setVolume').value = s.volume;
  $('outVolume').textContent = Math.round(s.volume * 100) + '%';
  $('setInvert').checked = !!s.invertY;
  $('setFps').checked = !!s.showFps;
  $('setLang').value = s.lang || 'en';
  buildControlsHelp();
}

function applySettings() {
  const s = G.profile.settings;
  if (G.input) {
    G.input.sensitivity = s.sensitivity;
    G.input.invertY = !!s.invertY;
  }
  audio.setVolume(s.volume ?? 0.8);
  $('fpsCounter').style.display = s.showFps ? '' : 'none';
  applyI18n();
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.documentElement.lang = G.profile.settings.lang || 'en';
}

/* ============================ wiring ============================ */

function wireEvents() {
  $('btnDeploy').addEventListener('click', () => {
    audio.init();
    audio.ui();
    G.profile.name = ($('nameInput').value || 'Soldier').slice(0, 18);
    saveProfile();
    G.conn.send({ t: 'hello', name: G.profile.name, profileId: G.profileId, profile: G.profile, loadout: currentLoadout() });
    G.conn.send({
      t: 'queue',
      mode: G.selection.mode,
      map: G.selection.map,
      ruleset: G.selection.ruleset,
      loadout: currentLoadout()
    });
    showScreen('queue');
  });
  $('btnLoadout').addEventListener('click', () => { audio.ui(); showScreen('loadout'); });
  $('btnBarracks').addEventListener('click', () => { audio.ui(); showScreen('barracks'); });
  $('btnSettings').addEventListener('click', () => { audio.ui(); showScreen('settings'); });
  $('btnLoadoutBack').addEventListener('click', () => { audio.uiBack(); saveProfile(); showScreen('main'); });
  $('btnBarracksBack').addEventListener('click', () => { audio.uiBack(); showScreen('main'); });
  $('btnSettingsBack').addEventListener('click', () => { audio.uiBack(); saveProfile(); showScreen('main'); });
  $('btnCancelQueue').addEventListener('click', () => { audio.uiBack(); G.conn.send({ t: 'leaveQueue' }); showScreen('main'); });
  $('btnResultsMenu').addEventListener('click', () => { leaveMatch(); });

  $('nameInput').addEventListener('change', () => {
    G.profile.name = ($('nameInput').value || 'Soldier').slice(0, 18);
    saveProfile();
  });

  // Loadout interactions
  for (const id of ['primaryList', 'secondaryList', 'lethalList', 'tacticalList', 'attachList', 'perkList', 'streakList']) {
    $(id).addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item || item.classList.contains('locked')) return;
      audio.ui();
      const lo = currentLoadout();
      const type = item.dataset.type;
      const idv = item.dataset.id;
      if (type === 'weapon') {
        if (idv === lo.primary) return;
        if (WEAPON_MAP[idv].cls === 'pistol') lo.secondary = idv;
        else lo.primary = idv;
      } else if (type === 'lethal') lo.lethal = idv;
      else if (type === 'tactical') lo.tactical = idv;
      else if (type === 'attachment') {
        const arr = lo.primaryAttachments || (lo.primaryAttachments = []);
        const att = ATTACHMENTS.find((a) => a.id === idv);
        const i = arr.indexOf(idv);
        if (i >= 0) arr.splice(i, 1);
        else {
          const sameSlot = arr.findIndex((x) => ATTACHMENTS.find((a) => a.id === x)?.slot === att.slot);
          if (sameSlot >= 0) arr.splice(sameSlot, 1);
          arr.push(idv);
        }
      } else if (type.startsWith('perk')) {
        lo[type] = lo[type] === idv ? null : idv;
      } else if (type === 'streak') {
        const arr = lo.killstreaks || (lo.killstreaks = []);
        const i = arr.indexOf(idv);
        if (i >= 0) arr.splice(i, 1);
        else if (arr.length < 3) arr.push(idv);
        else arr[0] = idv;
      }
      G.profile.loadouts[0] = lo;
      saveProfile();
      renderLoadout();
    });
  }

  // Settings
  $('setSens').addEventListener('input', (e) => { G.profile.settings.sensitivity = Number(e.target.value); $('outSens').textContent = Number(e.target.value).toFixed(2); saveProfile(); applySettings(); });
  $('setFov').addEventListener('input', (e) => { G.profile.settings.fov = Number(e.target.value); $('outFov').textContent = e.target.value; saveProfile(); });
  $('setVolume').addEventListener('input', (e) => { G.profile.settings.volume = Number(e.target.value); $('outVolume').textContent = Math.round(e.target.value * 100) + '%'; saveProfile(); applySettings(); });
  $('setInvert').addEventListener('change', (e) => { G.profile.settings.invertY = e.target.checked; saveProfile(); applySettings(); });
  $('setFps').addEventListener('change', (e) => { G.profile.settings.showFps = e.target.checked; saveProfile(); applySettings(); });
  $('setLang').addEventListener('change', (e) => {
    G.profile.settings.lang = e.target.value;
    setLang(e.target.value);
    saveProfile();
    applySettings();
    buildMenus();
    renderSettings();
  });

  // Pointer lock / pause
  G.input.onLockChange = (locked) => {
    if (G.screen !== 'match') return;
    $('pauseHint').classList.toggle('hidden', locked);
    if (!locked) $('resumeHint').textContent = t('clickToPlay');
  };
  $('gl').addEventListener('click', () => {
    audio.init();
    if (G.screen === 'match' && !G.input.locked && !G.chatOpen) G.input.requestLock();
  });

  // Chat
  G.input.onChatKey = () => { if (G.screen === 'match') openChat(); };
  $('chatInput').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = $('chatInput').value.trim();
      if (text) G.conn.send({ t: 'chat', text });
      closeChat();
    } else if (e.key === 'Escape') {
      closeChat();
    }
  });

  window.addEventListener('resize', () => {
    G.renderer?.resize();
    G.hud?.resize();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && G.screen === 'match') {
      leaveMatch();
    }
  });
}

function openChat() {
  G.chatOpen = true;
  G.input.chatOpen = true;
  G.input.releaseLock();
  $('chatBox').classList.remove('hidden');
  $('chatInput').value = '';
  $('chatInput').focus();
}

function closeChat() {
  G.chatOpen = false;
  G.input.chatOpen = false;
  $('chatBox').classList.add('hidden');
  $('chatInput').blur();
  if (G.screen === 'match') G.input.requestLock();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

boot();
