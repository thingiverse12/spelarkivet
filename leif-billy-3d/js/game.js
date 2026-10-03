// ═══════════════════════════════════════════════════════════════
//  LEIF & BILLY 3D – SKULDBREVSJAKTEN I SÖRBÄCKEN
//  Ett officiellt-fritt fantribut. All kod, alla modeller, all text
//  och allt ljud är originalskapat för detta spel.
// ═══════════════════════════════════════════════════════════════
import * as THREE from '../vendor/three.module.min.js';
import { buildHuman, animateHuman, CHAR_PRESETS } from './chars.js';
import * as W from './world.js';
import { SFX, initAudio, startMusic, stopMusic, setMuted } from './audio.js';

const $ = (id) => document.getElementById(id);

// ── renderer / scener ──────────────────────────────────────────
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const menuScene = new THREE.Scene();

// ── state ──────────────────────────────────────────────────────
const STATE = { MENU: 0, PLAY: 1, PAUSE: 2, CLEAR: 3, OVER: 4 };
let state = STATE.MENU;
let selectedChar = 'leif';
let levelIndex = 0;
let score = 0;
let lives = 3;
let snusCount = 0;
let timeLeft = 0;
let boostT = 0;
let invulnT = 0;
let coinsTotal = 0, coinsGot = 0;
let best = +(localStorage.getItem('lb3d_best') || 0);
let muted = false;

// ── levels ─────────────────────────────────────────────────────
const LEVELS = [
  {
    name: 'SNUSTORKAN', season: 'day', sky: ['#8ec9e8', '#dceef7'], fog: 0xcfe4ef,
    fogdar: 1, coins: 12, snus: 2, time: 100, fogSpeed: 4.6, view: 16,
    intro: [
      ['LEIF', 'Billy! Kronofogden är i byn igen – vi måste gömma pengarna innan han hittar dem!'],
      ['BILLY', 'Va?! Nu igen?! Jag hinner inte ens gömma mitt snus…'],
    ],
  },
  {
    name: 'TJUVJAKTEN', season: 'dusk', sky: ['#e8926a', '#3d3a5c'], fog: 0x8a6a6a,
    fogdar: 2, coins: 16, snus: 3, time: 110, fogSpeed: 5.1, view: 18,
    intro: [
      ['BILLY', 'Leif! Han har med sig en kollega den här gången!'],
      ['LEIF', 'Lugn brorsan. Vi känner varje gran i den här skogen.'],
    ],
  },
  {
    name: 'HEMBRÄNTSRAIDEN', season: 'winter', sky: ['#20263c', '#0c1020'], fog: 0x2a3040,
    fogdar: 3, coins: 20, snus: 3, time: 125, fogSpeed: 5.5, view: 20,
    intro: [
      ['LEIF', 'Sista vändan, Billy. Sen är skulderna betalade och huset vårt!'],
      ['BILLY', 'Om vi överlever natten vill säga… Det är beckmörkt och fogdar överallt!'],
    ],
  },
];

// ── dialog (helt nyskrivna repliker i Norrlandsanda) ────────────
const LINES = {
  caught: [
    ['KRONOFOGDEN', 'Herr Öhman! Ni har obetalda skulder – igen!'],
    ['KRONOFOGDEN', 'Era skuldbrev växer på hög, herr Öhman!'],
    ['LEIF', 'Skit också! Spring, Billy, SPRING!'],
    ['BILLY', 'Aaah! Han tog mig! Mitt snus!!'],
  ],
  seen: [
    ['KRONOFOGDEN', 'DÄR ÄR DE! Stanna genast!'],
    ['KRONOFOGDEN', 'Jag ser er, bröderna Öhman!'],
    ['BILLY', 'Leif! Han har sett oss!'],
  ],
  lost: [
    ['LEIF', 'Pyttsan! Vi tappade honom bland granarna.'],
    ['BILLY', 'Puh… Jag trodde mitt sista ögonblick var inne.'],
  ],
  moose: [
    ['BILLY', 'ÄLGEN! Akta dig, Leif!'],
    ['LEIF', 'Inte älgen igen!!'],
  ],
  snus: [
    ['BILLY', 'En snusdosa! Den sparar jag till nöden.'],
  ],
  boost: [
    ['BILLY', 'Skönt med en prisill nu, minsann!'],
    ['LEIF', 'Nu går vi! Håll i dig, brorsan!'],
  ],
  win: [
    ['LEIF', 'Alla pengarna räddade! Kronofogden får komma tillbaka en annan dag!'],
    ['BILLY', 'Vi är bäst i hela Sörbäcken, vi!'],
  ],
};

// ── helpers ───────────────────────────────────────────────────
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let toastTimer = null;
function toast(who, txt, ms = 2600) {
  const t = $('toast');
  t.querySelector('.who').textContent = who;
  t.querySelector('.txt').textContent = txt;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function banner(txt, ms = 1800) {
  const b = $('banner');
  b.textContent = txt;
  b.classList.add('show');
  setTimeout(() => b.classList.remove('show'), ms);
}
function line(pool) {
  const [who, txt] = pool[(Math.random() * pool.length) | 0];
  toast(who, txt);
}

// ── sky / light ────────────────────────────────────────────────
let sun, hemi, skyMesh, stars;
function makeSky(scn, cols) {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 128;
  const cx = cv.getContext('2d');
  const gr = cx.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, cols[0]);
  gr.addColorStop(1, cols[1]);
  cx.fillStyle = gr; cx.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  scn.add(m);
  return m;
}
function setupLights(scn, night) {
  const grp = new THREE.Group();
  const h = new THREE.HemisphereLight(night ? 0x3a4666 : 0xbfd8e8, night ? 0x14181f : 0x4a4a38, night ? 0.7 : 1.0);
  grp.add(h);
  const d = new THREE.DirectionalLight(night ? 0x9ab4e8 : 0xfff2d0, night ? 0.8 : 1.6);
  d.position.set(40, 60, 20);
  d.castShadow = true;
  d.shadow.mapSize.set(2048, 2048);
  const c = d.shadow.camera;
  c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.far = 200;
  grp.add(d);
  scn.add(grp);
  return grp;
}

// ═════════════ MENY-SCEN ═════════════
const menuChars = [];
(function buildMenu() {
  makeSky(menuScene, ['#e8926a', '#2a3050']);
  setupLights(menuScene, false);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(30, 32),
    new THREE.MeshLambertMaterial({ color: 0x5a6a4a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  menuScene.add(ground);
  ['leif', 'billy'].forEach((k, i) => {
    const ch = buildHuman(CHAR_PRESETS[k]);
    ch.group.position.set(i === 0 ? -1.4 : 1.4, 0, 0);
    ch.group.rotation.y = i === 0 ? 0.35 : -0.35;
    menuScene.add(ch.group);
    menuChars.push({ key: k, ...ch, phase: i * 2 });
    for (let j = 0; j < 3; j++) {
      const t = W.spruce(5 + j);
      t.position.set(-9 + i * 18 + rand(-3, 3), 0, -6 - j * 4);
      menuScene.add(t);
    }
  });
  const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);
  menuScene.userData.cam = cam;
})();

// ═════════════ SPEL-VÄRLD ═════════════
let player = null;          // { preset, rig, pos, vel, yaw, onGround, stamina, phase }
let fogdar = [];            // { rig, pos, yaw, state, wp, wpi, alertT, speed }
let mooses = [];
let coinsArr = [], snusArr = [];
let colliders = [];         // {x,z,r}
let levelGroup = null;
let lights = null;

const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 700);
let camYaw = 0, camPitch = 0.32, camDist = 8;

function clearLevel() {
  if (levelGroup) {
    scene.remove(levelGroup);
    levelGroup.traverse(o => {
      if (o.isMesh || o.isPoints) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { m?.map?.dispose?.(); m?.dispose?.(); });
      }
    });
  }
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  fogdar = []; mooses = []; coinsArr = []; snusArr = []; colliders = [];
  skyMesh = null; stars = null; lights = null;
}

function addCollider(x, z, r) { colliders.push({ x, z, r }); }

function scatterPos(minR = 6) {
  // slumpfri yta inom byn, undvik colliders
  for (let i = 0; i < 60; i++) {
    const x = rand(-W.WORLD_HALF + 6, W.WORLD_HALF - 6);
    const z = rand(-W.WORLD_HALF + 6, W.WORLD_HALF - 6);
    if (Math.hypot(x, z) < minR) continue;
    if (colliders.every(c => Math.hypot(x - c.x, z - c.z) > c.r + 1.2)) return { x, z };
  }
  return { x: rand(-30, 30), z: rand(-30, 30) };
}

function buildLevel(idx) {
  const L = LEVELS[idx];
  clearLevel();
  const night = L.season === 'winter';

  skyMesh = makeSky(levelGroup, L.sky);
  scene.fog = new THREE.Fog(L.fog, 30, night ? 90 : 130);
  lights = setupLights(levelGroup, night);
  if (night) {
    const sg = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 300; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(280);
      if (v.y > 20) pts.push(v.x, v.y, v.z);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.4, fog: false }));
    levelGroup.add(stars);
  }

  levelGroup.add(W.buildGround(L.season));

  // ── byns layout ──
  const homes = [
    { x: -18, z: -14, ry: 0.3, c: 0x8a2f26 },
    { x: 16, z: -20, ry: -0.5, c: 0x93402c },
    { x: -22, z: 16, ry: 1.2, c: 0x7a2a20 },
    { x: 20, z: 18, ry: 2.2, c: 0x8a2f26 },
  ];
  homes.forEach(h => {
    const hs = W.house(7, 6, 3.4, h.c);
    hs.position.set(h.x, 0, h.z);
    hs.rotation.y = h.ry;
    levelGroup.add(hs);
    addCollider(h.x, h.z, 4.6);
  });

  const cv = W.caravan();
  cv.position.set(4, 0, -8); cv.rotation.y = 0.6;
  levelGroup.add(cv); addCollider(4, -8, 3.0);

  const volvo = W.raggarVolvo();
  volvo.position.set(-6, 0, 6); volvo.rotation.y = -0.4;
  levelGroup.add(volvo); addCollider(-6, 6, 2.8);

  const dass = W.outhouse();
  dass.position.set(26, 0, -2);
  levelGroup.add(dass); addCollider(26, -2, 1.2);

  const wp = W.woodpile();
  wp.position.set(-14, 0, -9);
  levelGroup.add(wp); addCollider(-14, -9, 1.2);

  const cl = W.clothesline();
  cl.position.set(-18, 0, -8); cl.rotation.y = 0.3;
  levelGroup.add(cl);

  [[-34, -30], [30, 28], [-30, 30], [34, -28]].forEach(([x, z]) => {
    const lp = W.lampPost();
    lp.position.set(x, 0, z);
    lp.rotation.y = Math.atan2(-x, -z);
    levelGroup.add(lp);
    addCollider(x, z, 0.4);
    if (night) {
      const pl = new THREE.PointLight(0xffd9a0, 30, 18, 1.8);
      pl.position.set(x, 4, z);
      levelGroup.add(pl);
    }
  });

  // skogsrings + spridda träd
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    const r = W.WORLD_HALF + rand(0, 8);
    const t = Math.random() < 0.75 ? W.spruce(rand(5, 9)) : W.birch(rand(4, 6));
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    t.rotation.y = rand(0, 6);
    levelGroup.add(t);
  }
  for (let i = 0; i < 26; i++) {
    const p = scatterPos(10);
    const t = Math.random() < 0.7 ? W.spruce(rand(4, 8)) : W.birch(rand(4, 6));
    t.position.set(p.x, 0, p.z);
    t.rotation.y = rand(0, 6);
    levelGroup.add(t);
    addCollider(p.x, p.z, 0.7);
  }

  // ── mynt ──
  coinsTotal = L.coins; coinsGot = 0;
  for (let i = 0; i < L.coins; i++) {
    const p = scatterPos(8);
    const c = W.coin();
    c.position.set(p.x, 0.9, p.z);
    levelGroup.add(c);
    coinsArr.push({ obj: c, x: p.x, z: p.z, got: false, t: rand(0, 6) });
  }
  // ── snus ──
  for (let i = 0; i < L.snus; i++) {
    const p = scatterPos(8);
    const s = W.snusCan();
    s.position.set(p.x, 0.15, p.z);
    levelGroup.add(s);
    snusArr.push({ obj: s, x: p.x, z: p.z, got: false });
  }

  // ── älgar ──
  const mooseCount = idx >= 1 ? 2 : 1;
  for (let i = 0; i < mooseCount; i++) {
    const m = W.moose();
    const p = scatterPos(16);
    m.position.set(p.x, 0, p.z);
    levelGroup.add(m);
    mooses.push({ obj: m, x: p.x, z: p.z, yaw: rand(0, 6), t: rand(1, 4), state: 'graze', vx: 0, vz: 0 });
  }

  // ── fogdar ──
  for (let i = 0; i < L.fogdar; i++) {
    const rig = buildHuman(CHAR_PRESETS.fogde);
    const a = (i / L.fogdar) * Math.PI * 2 + 0.7;
    const x = Math.cos(a) * 26, z = Math.sin(a) * 26;
    rig.group.position.set(x, 0, z);
    levelGroup.add(rig.group);
    const wps = [];
    for (let w = 0; w < 5; w++) {
      const wa = a + (w / 5) * Math.PI * 2;
      wps.push({ x: Math.cos(wa) * rand(12, 30), z: Math.sin(wa) * rand(12, 30) });
    }
    fogdar.push({
      rig, x, z, yaw: 0, mode: 'patrol', wps, wpi: 0,
      alertT: 0, phase: rand(0, 6), speed: L.fogSpeed + i * 0.15, seen: false,
    });
  }

  // ── spelare ──
  if (player) levelGroup.remove(player.rig.group);
  const preset = CHAR_PRESETS[selectedChar];
  const rig = buildHuman(preset);
  rig.group.position.set(0, 0, 10);
  levelGroup.add(rig.group);
  player = {
    preset, rig, x: 0, z: 10, y: 0, vy: 0, yaw: Math.PI,
    onGround: true, stamina: preset.stamina, phase: 0, stepT: 0,
  };

  timeLeft = L.time;
  camYaw = Math.PI; camPitch = 0.34;
  cam.position.set(0, 6, 10 + Math.cos(camYaw) * camDist);
  cam.lookAt(0, 2, 10);
  updateHUD();
}

// ═════════════ INPUT ═════════════
const keys = {};
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyR' && (state === STATE.PLAY || state === STATE.OVER)) startGame();
  if (e.code === 'Space' && state === STATE.PLAY) jump();
  if (e.code === 'KeyE' && state === STATE.PLAY) useSnus();
  if (e.code === 'KeyM') {
    muted = !muted;
    setMuted(muted);
    toast('SYSTEM', muted ? 'Ljud: AV' : 'Ljud: PÅ', 1200);
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });

// mus-kamera
let dragging = false, lastX = 0, lastY = 0, lastDrag = 0;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') return;
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointermove', e => {
  if (!dragging || state !== STATE.PLAY) return;
  camYaw -= (e.clientX - lastX) * 0.005;
  camPitch = clamp(camPitch + (e.clientY - lastY) * 0.003, 0.08, 0.9);
  lastX = e.clientX; lastY = e.clientY;
  lastDrag = performance.now();
});
addEventListener('pointerup', () => { dragging = false; });

// touch: joystick + kameradrag
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');
const stick = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
const zone = $('stickZone');
zone.addEventListener('pointerdown', e => {
  stick.active = true; stick.id = e.pointerId;
  stick.ox = e.clientX; stick.oy = e.clientY;
  $('stickBase').style.left = e.clientX + 'px';
  $('stickBase').style.top = e.clientY + 'px';
  $('stickBase').style.display = 'block';
  $('stickNub').style.display = 'block';
  e.preventDefault();
});
addEventListener('pointermove', e => {
  if (stick.active && e.pointerId === stick.id) {
    const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, 55);
    stick.dx = (dx / len) * (cl / 55);
    stick.dy = (dy / len) * (cl / 55);
    $('stickNub').style.left = stick.ox + (dx / len) * cl + 'px';
    $('stickNub').style.top = stick.oy + (dy / len) * cl + 'px';
  } else if (e.pointerType === 'touch' && state === STATE.PLAY && !stick.active) {
    // kamera: drag på högra halvan
    if (e.clientX > innerWidth * 0.5) {
      if (stick.camX !== undefined) {
        camYaw -= (e.clientX - stick.camX) * 0.006;
        camPitch = clamp(camPitch + (e.clientY - stick.camY) * 0.004, 0.08, 0.9);
      }
      stick.camX = e.clientX; stick.camY = e.clientY;
    }
  }
});
addEventListener('pointerup', e => {
  if (e.pointerId === stick.id) {
    stick.active = false; stick.dx = stick.dy = 0;
    $('stickBase').style.display = 'none';
    $('stickNub').style.display = 'none';
  }
  if (e.pointerType === 'touch') stick.camX = undefined;
});
$('btnJump').addEventListener('pointerdown', e => { e.preventDefault(); jump(); });
$('btnSnus').addEventListener('pointerdown', e => { e.preventDefault(); useSnus(); });

// ═════════════ SPELMEKANIK ═════════════
function jump() {
  if (!player || !player.onGround) return;
  player.vy = player.preset.jump;
  player.onGround = false;
  SFX.jump();
}
function useSnus() {
  if (snusCount <= 0 || boostT > 0) return;
  snusCount--;
  boostT = 4;
  SFX.boost();
  line(LINES.boost);
  updateHUD();
}

function hitPlayer(fromX, fromZ, strength) {
  const dx = player.x - fromX, dz = player.z - fromZ;
  const l = Math.hypot(dx, dz) || 1;
  player.x += (dx / l) * strength;
  player.z += (dz / l) * strength;
}

function caughtBy(f) {
  lives--;
  SFX.caught();
  $('damageFlash').classList.add('on');
  setTimeout(() => $('damageFlash').classList.remove('on'), 120);
  line(LINES.caught);
  updateHUD();
  if (lives <= 0) { gameOver(false); return; }
  // respawna spelaren, nollställ fogden
  player.x = 0; player.z = 10; player.y = 0; player.vy = 0;
  invulnT = 2.5;
  f.mode = 'patrol'; f.alertT = 0; f.seen = false;
  banner('💌 ETT SKULDBREV BESLAGTAGET!', 1600);
}

function gameOver(won) {
  state = STATE.OVER;
  stopMusic();
  if (won) {
    SFX.win();
    $('overTitle').textContent = '🏆 SÖRBÄCKEN RÄDDAT!';
    $('overText').textContent = 'Bröderna Öhman betalade sina skulder (den här gången). Kronofogden svor att komma tillbaka.';
    line(LINES.win);
  } else {
    SFX.over();
    $('overTitle').textContent = '💌 KRONOFOGDEN TOG HUSET';
    $('overText').textContent = 'Skuldbreven vann den här gången. Men bröderna Öhman ger sig aldrig…';
  }
  if (score > best) { best = score; localStorage.setItem('lb3d_best', best); }
  $('overScore').textContent = `POÄNG: ${score}   ·   BÄSTA: ${best}`;
  $('over').classList.remove('hidden');
}

function levelClear() {
  state = STATE.CLEAR;
  SFX.level();
  const bonus = Math.round(timeLeft) * 10;
  score += bonus;
  line(LINES.win);
  if (levelIndex >= LEVELS.length - 1) {
    gameOver(true);
    return;
  }
  $('clearTitle').textContent = `✔ NIVÅ ${levelIndex + 1} KLAR – ${LEVELS[levelIndex].name}`;
  $('clearText').textContent = `Alla gulkronor gömda! Tidsbonus: +${bonus} poäng. Poäng totalt: ${score}. Nästa anhalt: ${LEVELS[levelIndex + 1].name}.`;
  $('clear').classList.remove('hidden');
  updateHUD();
}

// ═════════════ UPDATE ═════════════
function updatePlayer(dt) {
  const p = player;
  // inputvektor (kamerarelativt)
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp) iy += 1;
  if (keys.KeyS || keys.ArrowDown) iy -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (stick.active) { ix += stick.dx; iy += -stick.dy; }
  const il = Math.hypot(ix, iy);
  if (il > 1) { ix /= il; iy /= il; }

  const sprinting = (keys.ShiftLeft || keys.ShiftRight) && il > 0.1 && p.stamina > 1;
  if (sprinting) p.stamina = Math.max(0, p.stamina - 26 * dt);
  else p.stamina = Math.min(p.preset.stamina, p.stamina + 16 * dt);

  let speed = sprinting ? p.preset.sprint : p.preset.speed;
  if (boostT > 0) { speed *= 1.5; boostT -= dt; if (boostT <= 0) updateHUD(); }
  if (invulnT > 0) invulnT -= dt;

  const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  const wx = (ix * cos - iy * sin);
  const wz = (-ix * sin - iy * cos);

  // accelerera
  const accel = p.onGround ? 12 : 4;
  p.vx = (p.vx ?? 0) + (wx * speed - (p.vx ?? 0)) * Math.min(1, accel * dt);
  p.vz = (p.vz ?? 0) + (wz * speed - (p.vz ?? 0)) * Math.min(1, accel * dt);

  p.x += p.vx * dt;
  p.z += p.vz * dt;

  // gravitation
  p.vy -= 22 * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) {
    if (!p.onGround) SFX.land();
    p.y = 0; p.vy = 0; p.onGround = true;
  }

  // världskanter + colliders
  const lim = W.WORLD_HALF - 1;
  p.x = clamp(p.x, -lim, lim);
  p.z = clamp(p.z, -lim, lim);
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + 0.45;
    if (d < min && d > 0.001) {
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
  }

  // vänd modellen mot rörelsen
  const mv = Math.hypot(p.vx, p.vz);
  if (mv > 0.4) {
    const target = Math.atan2(p.vx, p.vz);
    let d = target - p.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    p.yaw += d * Math.min(1, 12 * dt);
  }
  p.rig.group.position.set(p.x, p.y, p.z);
  p.rig.group.rotation.y = p.yaw;

  // animation + fotsteg
  const inten = clamp(mv / p.preset.speed, 0, 1.4);
  p.phase += mv * dt * 2.6;
  animateHuman(p.rig.parts, p.phase, inten, { time: perfT, lean: sprinting || boostT > 0 ? 0.12 : 0 });
  p.stepT -= dt * mv;
  if (p.stepT <= 0 && mv > 1 && p.onGround) { SFX.step(); p.stepT = 2.2; }

  // auto-kamera följer rörelseriktningen mjukt
  if (mv > 2 && performance.now() - lastDrag > 2500) {
    const target = Math.atan2(p.vx, p.vz) + Math.PI;
    let d = target - camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    camYaw += d * Math.min(1, 1.2 * dt);
  }

  $('boostFill').style.width = (boostT > 0 ? (boostT / 4) * 100 : (p.stamina / p.preset.stamina) * 100) + '%';
}

function updateFogde(f, dt, L) {
  const dx = player.x - f.x, dz = player.z - f.z;
  const dist = Math.hypot(dx, dz);
  const toPlayer = Math.atan2(dx, dz);

  // synfält
  let dAng = toPlayer - f.yaw;
  while (dAng > Math.PI) dAng -= Math.PI * 2;
  while (dAng < -Math.PI) dAng += Math.PI * 2;
  const canSee = dist < L.view && Math.abs(dAng) < 1.0 && invulnT <= 0;

  if (canSee && f.mode === 'patrol') {
    f.mode = 'chase'; f.alertT = 6;
    if (!f.seen) { f.seen = true; SFX.alert(); line(LINES.seen); banner('👁 UPPTÄCKT!', 1200); }
  }
  if (f.mode === 'chase') {
    f.alertT -= dt;
    if (f.alertT <= 0 || dist > L.view + 12) {
      f.mode = 'patrol'; f.seen = false;
      line(LINES.lost);
    }
  }

  let tx, tz, spd;
  if (f.mode === 'chase') {
    tx = player.x; tz = player.z; spd = f.speed * 1.12;
  } else {
    const wp = f.wps[f.wpi];
    tx = wp.x; tz = wp.z; spd = f.speed * 0.55;
    if (Math.hypot(tx - f.x, tz - f.z) < 2) f.wpi = (f.wpi + 1) % f.wps.length;
  }
  const mx = tx - f.x, mz = tz - f.z;
  const ml = Math.hypot(mx, mz) || 1;
  f.x += (mx / ml) * spd * dt;
  f.z += (mz / ml) * spd * dt;
  const lim = W.WORLD_HALF - 1;
  f.x = clamp(f.x, -lim, lim); f.z = clamp(f.z, -lim, lim);
  for (const c of colliders) {
    const cdx = f.x - c.x, cdz = f.z - c.z;
    const d = Math.hypot(cdx, cdz);
    const min = c.r + 0.5;
    if (d < min && d > 0.001) { f.x = c.x + (cdx / d) * min; f.z = c.z + (cdz / d) * min; }
  }

  const targetYaw = Math.atan2(mx, mz);
  let dy = targetYaw - f.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  f.yaw += dy * Math.min(1, 6 * dt);

  f.rig.group.position.set(f.x, 0, f.z);
  f.rig.group.rotation.y = f.yaw;
  f.phase += spd * dt * 2.4;
  animateHuman(f.rig.parts, f.phase, clamp(spd / 5, 0.2, 1.2), { time: perfT });

  // fångad?
  if (dist < 1.25 && invulnT <= 0) caughtBy(f);
}

function updateMoose(m, dt) {
  m.t -= dt;
  const dxp = player.x - m.x, dzp = player.z - m.z;
  const dp = Math.hypot(dxp, dzp);
  if (m.state === 'graze') {
    if (m.t <= 0) {
      m.t = rand(2, 5);
      if (Math.random() < 0.5) { m.state = 'walk'; m.yaw = rand(0, Math.PI * 2); }
    }
    if (dp < 3.2) { m.state = 'charge'; m.t = 1.6; SFX.moose(); line(LINES.moose); }
  } else if (m.state === 'walk') {
    m.x += Math.sin(m.yaw) * 1.6 * dt;
    m.z += Math.cos(m.yaw) * 1.6 * dt;
    if (m.t <= 0) { m.state = 'graze'; m.t = rand(2, 5); }
    if (dp < 3.2) { m.state = 'charge'; m.t = 1.6; SFX.moose(); line(LINES.moose); }
  } else if (m.state === 'charge') {
    m.x += Math.sin(m.yaw) * 0 * dt;
    // rusar mot spelaren en kort stund
    const l = dp || 1;
    m.x += (dxp / l) * 5.5 * dt;
    m.z += (dzp / l) * 5.5 * dt;
    m.yaw = Math.atan2(dxp, dzp);
    if (dp < 1.5) { hitPlayer(m.x, m.z, 3.5); m.state = 'graze'; m.t = 4; }
    if (m.t <= 0) { m.state = 'graze'; m.t = rand(3, 6); }
  }
  const lim = W.WORLD_HALF - 2;
  m.x = clamp(m.x, -lim, lim); m.z = clamp(m.z, -lim, lim);
  m.obj.position.set(m.x, 0, m.z);
  m.obj.rotation.y = m.yaw;
  m.obj.userData.head.rotation.x = m.state === 'graze' ? Math.sin(perfT * 2) * 0.25 + 0.3 : -0.15;
}

function updatePickups(dt) {
  for (const c of coinsArr) {
    if (c.got) continue;
    c.t += dt;
    c.obj.rotation.y += dt * 2.4;
    c.obj.position.y = 0.9 + Math.sin(c.t * 2.2) * 0.12;
    if (Math.hypot(player.x - c.x, player.z - c.z) < 1.1) {
      c.got = true;
      c.obj.visible = false;
      coinsGot++;
      score += 100;
      SFX.coin();
      if (coinsGot >= coinsTotal) { levelClear(); return; }
      updateHUD();
    }
  }
  for (const s of snusArr) {
    if (s.got) continue;
    s.obj.rotation.y += dt * 1.5;
    if (Math.hypot(player.x - s.x, player.z - s.z) < 1.1) {
      s.got = true;
      s.obj.visible = false;
      if (snusCount < 5) snusCount++;
      score += 50;
      SFX.snus();
      line(LINES.snus);
      updateHUD();
    }
  }
}

function updateCamera(dt) {
  const p = player;
  const px = p.x, py = p.y + 2.0, pz = p.z;
  const cx = px + Math.sin(camYaw) * Math.cos(camPitch) * camDist;
  const cy = py + Math.sin(camPitch) * camDist;
  const cz = pz + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  cam.position.lerp(new THREE.Vector3(cx, Math.max(0.8, cy), cz), Math.min(1, 8 * dt));
  cam.lookAt(px, py + 0.4, pz);
}

// ═════════════ HUD ═════════════
function updateHUD() {
  const L = LEVELS[levelIndex];
  $('hudName').textContent = CHAR_PRESETS[selectedChar].name + ' · NIVÅ ' + (levelIndex + 1) + '/' + LEVELS.length;
  let lv = '';
  for (let i = 0; i < 3; i++) lv += `<span class="${i < lives ? '' : 'lost'}">💌</span>`;
  $('hudLives').innerHTML = lv;
  $('hudCoins').textContent = `${coinsGot}/${coinsTotal}`;
  $('hudScore').textContent = score;
  $('hudSnus').textContent = snusCount;
  const m = Math.floor(timeLeft / 60), s = Math.floor(timeLeft % 60);
  $('hudTime').textContent = `${m}:${String(s).padStart(2, '0')}`;
  $('hudMid').style.color = timeLeft < 15 ? '#ff7a6a' : '#fff';
}

// ═════════════ FLÖDE ═════════════
function show(el, on) { $(el).classList.toggle('hidden', !on); }

function startGame() {
  initAudio();
  levelIndex = 0; score = 0; lives = 3; snusCount = 0; boostT = 0; invulnT = 0;
  show('over', false); show('clear', false); show('pause', false); show('menu', false);
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  buildLevel(0);
  state = STATE.PLAY;
  startMusic();
  banner(`NIVÅ 1 · ${LEVELS[0].name}`);
  const [a, b] = LEVELS[0].intro;
  setTimeout(() => toast(a[0], a[1]), 600);
  setTimeout(() => toast(b[0], b[1]), 3400);
}

function nextLevel() {
  levelIndex++;
  snusCount = Math.min(snusCount, 2);
  show('clear', false);
  buildLevel(levelIndex);
  state = STATE.PLAY;
  banner(`NIVÅ ${levelIndex + 1} · ${LEVELS[levelIndex].name}`);
  const [a, b] = LEVELS[levelIndex].intro;
  setTimeout(() => toast(a[0], a[1]), 600);
  setTimeout(() => toast(b[0], b[1]), 3400);
}

function togglePause() {
  if (state === STATE.PLAY) {
    state = STATE.PAUSE;
    show('pause', true);
    stopMusic();
  } else if (state === STATE.PAUSE) {
    state = STATE.PLAY;
    show('pause', false);
    startMusic();
  }
}

function toMenu() {
  state = STATE.MENU;
  stopMusic();
  show('pause', false); show('over', false); show('clear', false);
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  show('menu', true);
}

// menyknappar
document.querySelectorAll('.charCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.charCard').forEach(c => c.classList.remove('sel'));
    card.classList.add('sel');
    selectedChar = card.dataset.char;
    SFX.click();
  });
});
$('btnPlay').onclick = () => { SFX.click(); startGame(); };
$('btnInfo').onclick = () => { SFX.click(); show('info', true); };
$('btnInfoBack').onclick = () => { SFX.click(); show('info', false); };
$('btnHelp').onclick = () => { SFX.click(); show('help', true); };
$('btnHelpBack').onclick = () => { SFX.click(); show('help', false); };
$('btnResume').onclick = () => { SFX.click(); togglePause(); };
$('btnRestart').onclick = () => { SFX.click(); startGame(); };
$('btnMenu').onclick = () => { SFX.click(); toMenu(); };
$('btnNext').onclick = () => { SFX.click(); nextLevel(); };
$('btnAgain').onclick = () => { SFX.click(); startGame(); };
$('btnOverMenu').onclick = () => { SFX.click(); toMenu(); };
$('menuCredit').innerHTML = `Bästa poäng: <b>${best}</b> · Fantribut skapat av Arena.ai Agent Mode · Modell, musik & text: original · Serien © SVT/Jarowskij`;

// bakgrundsbild i menyn (genererad originalfanart)
fetch('./assets/poster.jpg', { method: 'HEAD' }).then(r => {
  if (r.ok) $('menuBg').style.backgroundImage = 'url(./assets/poster.jpg)';
}).catch(() => {});

// ═════════════ LOOP ═════════════
let perfT = 0;
let last = performance.now();
let fpsAcc = 0, fpsN = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  perfT += dt;

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }

  if (state === STATE.MENU) {
    const camM = menuScene.userData.cam;
    const a = perfT * 0.25;
    camM.position.set(Math.sin(a) * 6.5, 2.6 + Math.sin(perfT * 0.6) * 0.3, Math.cos(a) * 6.5);
    camM.lookAt(0, 1.4, 0);
    menuChars.forEach((c, i) => {
      const sel = c.key === selectedChar;
      c.group.position.y = sel ? Math.abs(Math.sin(perfT * 3)) * 0.18 : 0;
      c.group.rotation.y = (i === 0 ? 0.35 : -0.35) + Math.sin(perfT * 0.5 + i) * 0.15;
      animateHuman(c.parts, perfT * 4, sel ? 0.5 : 0.12, { time: perfT });
    });
    renderer.render(menuScene, camM);
    return;
  }

  if (state === STATE.PLAY) {
    const L = LEVELS[levelIndex];
    timeLeft -= dt;
    if (timeLeft <= 0) {
      lives--;
      updateHUD();
      if (lives <= 0) { gameOver(false); return; }
      timeLeft = L.time;
      banner('⏰ TIDEN ÄR UTE!');
      toast('KRONOFOGDEN', 'Tiden är ute, herr Öhman! Räntan växer!');
      player.x = 0; player.z = 10; player.y = 0; player.vy = 0;
      invulnT = 2;
    }
    updatePlayer(dt);
    fogdar.forEach(f => { if (state === STATE.PLAY) updateFogde(f, dt, L); });
    if (state !== STATE.PLAY) { renderer.render(scene, cam); return; }
    mooses.forEach(m => updateMoose(m, dt));
    updatePickups(dt);
    if (state !== STATE.PLAY) { renderer.render(scene, cam); return; }
    updateCamera(dt);
    if (Math.floor(perfT * 2) !== Math.floor((perfT - dt) * 2)) updateHUD();
    // blinka vid odödlighet
    player.rig.group.visible = invulnT > 0 ? Math.floor(perfT * 10) % 2 === 0 : true;
    renderer.render(scene, cam);
  } else if (state === STATE.PAUSE || state === STATE.CLEAR || state === STATE.OVER) {
    renderer.render(scene, cam);
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  const cm = menuScene.userData.cam;
  cm.aspect = innerWidth / innerHeight; cm.updateProjectionMatrix();
});

show('menu', true);
requestAnimationFrame(loop);
