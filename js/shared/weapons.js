/**
 * Weapon, attachment and grenade database.
 * Stat blocks are shared: the server uses damage/rate/falloff for authoritative
 * hit resolution, the client uses the rest for the viewmodel, recoil and HUD.
 */

export const CLASSES = [
  { id: 'smg', name: 'SMG', nameSv: 'Kpist' },
  { id: 'ar', name: 'Assault Rifle', nameSv: 'Automatgevär' },
  { id: 'lmg', name: 'LMG', nameSv: 'Kulspruta' },
  { id: 'shotgun', name: 'Shotgun', nameSv: 'Hagelgevär' },
  { id: 'sniper', name: 'Sniper', nameSv: 'Prickskyttegevär' },
  { id: 'pistol', name: 'Pistol', nameSv: 'Pistol' }
];

/**
 * damage        base body damage at close range
 * headMult      headshot multiplier
 * falloff       [nearRange, farRange, minMultiplier] linear falloff beyond nearRange
 * rpm           rounds per minute
 * spread        degrees: hip / ads / added while moving / added per shot in a burst
 * recoil        vertical + horizontal view kick in degrees
 */
const W = (w) => w;

export const WEAPONS = [
  W({
    id: 'mp5', name: 'MP5', cls: 'smg', unlockLevel: 1,
    damage: 26, headMult: 1.5, falloff: [18, 45, 0.55],
    rpm: 800, auto: true, mag: 30, reserve: 180, reloadTime: 1.9,
    spread: { hip: 2.8, ads: 0.35, move: 2.4, climb: 0.42 },
    recoil: { vert: 0.55, horz: 0.32, kick: 0.9 },
    adsTime: 0.18, moveSpeed: 1.06, swapTime: 0.35, zoom: 1.15,
    sfx: 'smg', color: '#3c3f45', accent: '#7a8290'
  }),
  W({
    id: 'vector', name: 'Vector .45', cls: 'smg', unlockLevel: 7,
    damage: 22, headMult: 1.5, falloff: [14, 38, 0.5],
    rpm: 1100, auto: true, mag: 34, reserve: 204, reloadTime: 1.8,
    spread: { hip: 3.2, ads: 0.4, move: 2.8, climb: 0.3 },
    recoil: { vert: 0.42, horz: 0.3, kick: 0.8 },
    adsTime: 0.16, moveSpeed: 1.08, swapTime: 0.33, zoom: 1.15,
    sfx: 'smg', color: '#4a4a44', accent: '#8e8f7d'
  }),
  W({
    id: 'm4a1', name: 'M4A1 Carbine', cls: 'ar', unlockLevel: 1,
    damage: 32, headMult: 1.6, falloff: [30, 70, 0.65],
    rpm: 720, auto: true, mag: 30, reserve: 180, reloadTime: 2.1,
    spread: { hip: 2.4, ads: 0.18, move: 2.2, climb: 0.5 },
    recoil: { vert: 0.72, horz: 0.36, kick: 1.1 },
    adsTime: 0.22, moveSpeed: 1.0, swapTime: 0.4, zoom: 1.35,
    sfx: 'ar', color: '#2f3238', accent: '#6d7280'
  }),
  W({
    id: 'ak47', name: 'AK-47', cls: 'ar', unlockLevel: 4,
    damage: 40, headMult: 1.7, falloff: [34, 78, 0.7],
    rpm: 600, auto: true, mag: 30, reserve: 180, reloadTime: 2.4,
    spread: { hip: 3.0, ads: 0.26, move: 2.6, climb: 0.95 },
    recoil: { vert: 1.05, horz: 0.55, kick: 1.5 },
    adsTime: 0.25, moveSpeed: 0.98, swapTime: 0.45, zoom: 1.35,
    sfx: 'ar', color: '#4b3620', accent: '#8b6a3f'
  }),
  W({
    id: 'scarh', name: 'SCAR-H', cls: 'ar', unlockLevel: 12,
    damage: 46, headMult: 1.7, falloff: [38, 88, 0.72],
    rpm: 550, auto: true, mag: 25, reserve: 150, reloadTime: 2.5,
    spread: { hip: 2.8, ads: 0.2, move: 2.4, climb: 0.85 },
    recoil: { vert: 1.15, horz: 0.5, kick: 1.6 },
    adsTime: 0.26, moveSpeed: 0.96, swapTime: 0.46, zoom: 1.45,
    sfx: 'ar', color: '#3a3527', accent: '#9c8a5e'
  }),
  W({
    id: 'm249', name: 'M249 SAW', cls: 'lmg', unlockLevel: 9,
    damage: 34, headMult: 1.5, falloff: [32, 80, 0.68],
    rpm: 700, auto: true, mag: 100, reserve: 300, reloadTime: 4.2,
    spread: { hip: 4.2, ads: 0.5, move: 3.6, climb: 0.55 },
    recoil: { vert: 0.9, horz: 0.62, kick: 1.4 },
    adsTime: 0.34, moveSpeed: 0.9, swapTime: 0.6, zoom: 1.3,
    sfx: 'lmg', color: '#3d4436', accent: '#6f7a5c'
  }),
  W({
    id: 'rpd', name: 'RPD', cls: 'lmg', unlockLevel: 16,
    damage: 38, headMult: 1.5, falloff: [34, 84, 0.7],
    rpm: 780, auto: true, mag: 120, reserve: 360, reloadTime: 4.6,
    spread: { hip: 4.6, ads: 0.55, move: 4.0, climb: 0.5 },
    recoil: { vert: 0.95, horz: 0.7, kick: 1.5 },
    adsTime: 0.36, moveSpeed: 0.88, swapTime: 0.65, zoom: 1.3,
    sfx: 'lmg', color: '#4a3f2c', accent: '#8a7b52'
  }),
  W({
    id: 'ranger870', name: 'Ranger 870', cls: 'shotgun', unlockLevel: 6,
    damage: 15, headMult: 1.4, falloff: [8, 20, 0.25], pellets: 8,
    rpm: 85, auto: false, mag: 6, reserve: 42, reloadTime: 3.4,
    spread: { hip: 5.5, ads: 3.2, move: 3.0, climb: 1.4 },
    recoil: { vert: 2.6, horz: 0.9, kick: 3.2 },
    adsTime: 0.28, moveSpeed: 0.98, swapTime: 0.5, zoom: 1.15,
    sfx: 'shotgun', color: '#3a2c1c', accent: '#7d6544'
  }),
  W({
    id: 'longshot', name: 'Longshot .50', cls: 'sniper', unlockLevel: 13,
    damage: 95, headMult: 2.4, falloff: [60, 200, 0.9],
    rpm: 41, auto: false, mag: 5, reserve: 30, reloadTime: 3.2,
    spread: { hip: 6.0, ads: 0.03, move: 6.0, climb: 0.0 },
    recoil: { vert: 3.4, horz: 1.1, kick: 4.5 },
    adsTime: 0.34, moveSpeed: 0.9, swapTime: 0.6, zoom: 4.2,
    sfx: 'sniper', color: '#2c2f33', accent: '#5d6b57'
  }),
  W({
    id: 'm1911', name: 'M1911', cls: 'pistol', unlockLevel: 1,
    damage: 34, headMult: 1.7, falloff: [14, 40, 0.5],
    rpm: 320, auto: false, mag: 7, reserve: 56, reloadTime: 1.6,
    spread: { hip: 2.6, ads: 0.3, move: 2.0, climb: 0.6 },
    recoil: { vert: 0.85, horz: 0.4, kick: 1.2 },
    adsTime: 0.14, moveSpeed: 1.1, swapTime: 0.28, zoom: 1.1,
    sfx: 'pistol', color: '#3b3b40', accent: '#8b7a4f'
  }),
  W({
    id: 'deagle', name: 'Desert Eagle', cls: 'pistol', unlockLevel: 8,
    damage: 62, headMult: 1.9, falloff: [16, 46, 0.6],
    rpm: 240, auto: false, mag: 7, reserve: 42, reloadTime: 2.0,
    spread: { hip: 3.2, ads: 0.28, move: 2.4, climb: 1.1 },
    recoil: { vert: 1.9, horz: 0.8, kick: 2.6 },
    adsTime: 0.17, moveSpeed: 1.05, swapTime: 0.32, zoom: 1.15,
    sfx: 'pistol', color: '#5a5348', accent: '#b8a06a'
  }),
  W({
    id: 'fiveseven', name: 'Five-SeveN', cls: 'pistol', unlockLevel: 18,
    damage: 30, headMult: 1.8, falloff: [18, 50, 0.6],
    rpm: 500, auto: true, mag: 20, reserve: 120, reloadTime: 1.8,
    spread: { hip: 2.4, ads: 0.24, move: 2.0, climb: 0.45 },
    recoil: { vert: 0.7, horz: 0.35, kick: 1.0 },
    adsTime: 0.15, moveSpeed: 1.1, swapTime: 0.3, zoom: 1.1,
    sfx: 'pistol', color: '#39424a', accent: '#8fa3b3'
  })
];

export const WEAPON_MAP = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

export const ATTACHMENTS = [
  { id: 'reddot', name: 'Red Dot Sight', nameSv: 'Rödpunktsikte', slot: 'optic', unlockWeaponLevel: 2,
    mods: { adsTime: 0.92, hip: 0.9 } },
  { id: 'acog', name: 'ACOG 4x', nameSv: 'ACOG 4x', slot: 'optic', unlockWeaponLevel: 5,
    mods: { zoom: 1.9, adsTime: 1.12 } },
  { id: 'reflex', name: 'Holographic', nameSv: 'Holografiskt sikte', slot: 'optic', unlockWeaponLevel: 7,
    mods: { adsTime: 0.95 } },
  { id: 'grip', name: 'Foregrip', nameSv: 'Framgrepp', slot: 'underbarrel', unlockWeaponLevel: 3,
    mods: { recoilVert: 0.68, recoilHorz: 0.8 } },
  { id: 'extmag', name: 'Extended Mags', nameSv: 'Förlängt magasin', slot: 'mag', unlockWeaponLevel: 4,
    mods: { mag: 1.5 } },
  { id: 'silencer', name: 'Silencer', nameSv: 'Ljuddämpare', slot: 'muzzle', unlockWeaponLevel: 6,
    mods: { damage: 0.9, silent: true } },
  { id: 'fmj', name: 'FMJ', nameSv: 'FMJ', slot: 'perk', unlockWeaponLevel: 8,
    mods: { damage: 1.15, falloff: 1.15 } }
];

export const ATTACHMENT_MAP = Object.fromEntries(ATTACHMENTS.map((a) => [a.id, a]));

/* ------------------------------------------------------------------ */
/* Equipment                                                           */
/* ------------------------------------------------------------------ */

export const LETHALS = [
  { id: 'frag', name: 'Frag Grenade', nameSv: 'Handgranat', unlockLevel: 1,
    fuse: 2.6, damage: 140, radius: 7.5, kind: 'bounce', cookable: true },
  { id: 'semtex', name: 'Semtex', nameSv: 'Semtex', unlockLevel: 3,
    fuse: 2.0, damage: 165, radius: 7, kind: 'stick', cookable: false },
  { id: 'thermite', name: 'Thermite', nameSv: 'Termit', unlockLevel: 11,
    fuse: 1.4, damage: 70, radius: 5.5, kind: 'burn', burn: { damage: 22, tick: 0.4, duration: 3.2 } }
];

export const TACTICALS = [
  { id: 'flash', name: 'Flashbang', nameSv: 'Chockgranat', unlockLevel: 2,
    fuse: 1.6, radius: 12, effect: 'flash', duration: 3.2 },
  { id: 'stun', name: 'Stun Grenade', nameSv: 'Bedövningsgranat', unlockLevel: 5,
    fuse: 1.6, radius: 10, effect: 'stun', duration: 4.0 },
  { id: 'smoke', name: 'Smoke Grenade', nameSv: 'Rökgranat', unlockLevel: 10,
    fuse: 1.2, radius: 6, effect: 'smoke', duration: 16 }
];

export const LETHAL_MAP = Object.fromEntries(LETHALS.map((g) => [g.id, g]));
export const TACTICAL_MAP = Object.fromEntries(TACTICALS.map((g) => [g.id, g]));

/* ------------------------------------------------------------------ */
/* Derived stats                                                       */
/* ------------------------------------------------------------------ */

/**
 * Apply attachments to a base weapon and return the final stat block.
 * attachments: array of attachment ids (any order, one per slot).
 */
export function effectiveWeapon(weaponId, attachments = []) {
  const base = WEAPON_MAP[weaponId] || WEAPONS[0];
  const atts = (attachments || [])
    .map((id) => ATTACHMENT_MAP[id])
    .filter((a) => a && a.unlockWeaponLevel <= 8);

  const w = {
    ...base,
    attachments: atts.map((a) => a.id),
    spread: { ...base.spread },
    recoil: { ...base.recoil },
    falloff: [...base.falloff],
    silent: false
  };

  for (const a of atts) {
    const m = a.mods;
    if (m.adsTime) w.adsTime *= m.adsTime;
    if (m.zoom) w.zoom *= m.zoom;
    if (m.mag) w.mag = Math.round(w.mag * m.mag);
    if (m.damage) w.damage *= m.damage;
    if (m.hip) w.spread.hip *= m.hip;
    if (m.recoilVert) w.recoil.vert *= m.recoilVert;
    if (m.recoilHorz) w.recoil.horz *= m.recoilHorz;
    if (m.falloff) { w.falloff[0] *= m.falloff; w.falloff[1] *= m.falloff; }
    if (m.silent) w.silent = true;
  }
  w.damage = Math.round(w.damage);
  return w;
}

/** Damage after distance falloff. */
export function falloffDamage(w, dist) {
  const [near, far, min] = w.falloff;
  if (dist <= near) return w.damage;
  if (dist >= far) return w.damage * min;
  const t = (dist - near) / (far - near);
  return w.damage * (1 + (min - 1) * t);
}

/* ------------------------------------------------------------------ */
/* Loadout helpers                                                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_LOADOUT = {
  primary: 'm4a1',
  primaryAttachments: [],
  secondary: 'm1911',
  secondaryAttachments: [],
  lethal: 'frag',
  tactical: 'flash',
  perk1: 'scavenger',
  perk2: 'sleight',
  perk3: 'marathon',
  killstreaks: ['uav', 'carepackage', 'helicopter'],
  name: 'Loadout 1'
};

export function sanitizeLoadout(input) {
  const l = { ...DEFAULT_LOADOUT, ...(input || {}) };
  if (!WEAPON_MAP[l.primary]) l.primary = DEFAULT_LOADOUT.primary;
  if (!WEAPON_MAP[l.secondary]) l.secondary = DEFAULT_LOADOUT.secondary;
  if (!LETHAL_MAP[l.lethal]) l.lethal = DEFAULT_LOADOUT.lethal;
  if (!TACTICAL_MAP[l.tactical]) l.tactical = DEFAULT_LOADOUT.tactical;
  l.primaryAttachments = (l.primaryAttachments || []).filter((a) => ATTACHMENT_MAP[a]);
  l.secondaryAttachments = (l.secondaryAttachments || []).filter((a) => ATTACHMENT_MAP[a]);
  if (!Array.isArray(l.killstreaks)) l.killstreaks = DEFAULT_LOADOUT.killstreaks.slice();
  l.killstreaks = l.killstreaks.filter(Boolean).slice(0, 3);
  if (l.killstreaks.length < 3) {
    for (const id of DEFAULT_LOADOUT.killstreaks) {
      if (l.killstreaks.length >= 3) break;
      if (!l.killstreaks.includes(id)) l.killstreaks.push(id);
    }
  }
  return l;
}

/** Gun Game ladder — one weapon per kill, ending with the pistol. */
export const GUN_GAME_LADDER = [
  'm249', 'ranger870', 'ak47', 'scarh', 'm4a1', 'vector', 'mp5',
  'longshot', 'rpd', 'deagle', 'm1911', 'fiveseven'
];

export function gunGameWeapon(kills) {
  const i = Math.min(kills, GUN_GAME_LADDER.length - 1);
  return GUN_GAME_LADDER[i];
}
