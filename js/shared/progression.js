/**
 * XP progression, level curve, unlocks and profile persistence.
 * Shared so the server can validate that a client really owns what it equipped.
 */
import { WEAPONS, ATTACHMENTS, LETHALS, TACTICALS } from './weapons.js';
import { PERKS } from './perks.js';
import { KILLSTREAKS } from './killstreaks.js';

export const MAX_LEVEL = 30;
export const MAX_PRESTIGE = 10;
export const MAX_WEAPON_LEVEL = 8;

/** XP required to go from (level-1) to (level). */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return 400 + (level - 2) * 200;
}

/** Total XP needed to reach a level from zero. */
export function cumulativeXp(level) {
  let total = 0;
  for (let l = 2; l <= level; l++) total += xpForLevel(l);
  return total;
}

export function levelFromXp(xp) {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (level < MAX_LEVEL) {
    const need = xpForLevel(level + 1);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  if (level >= MAX_LEVEL) return { level: MAX_LEVEL, current: 0, next: 0, maxed: true };
  return { level, current: remaining, next: xpForLevel(level + 1), maxed: false };
}

/** XP granted for weapon use. */
export function weaponLevelFromXp(xp) {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (level < MAX_WEAPON_LEVEL) {
    const need = 250 + (level - 1) * 250;
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  if (level >= MAX_WEAPON_LEVEL) return { level: MAX_WEAPON_LEVEL, current: 0, next: 0, maxed: true };
  return { level, current: remaining, next: 250 + (level - 1) * 250, maxed: false };
}

/* ------------------------------------------------------------------ */
/* Unlocks                                                             */
/* ------------------------------------------------------------------ */

const UNLOCKABLES = [];

function reg(type, item, nameKey) {
  UNLOCKABLES.push({
    type,
    id: item.id,
    level: item.unlockLevel,
    name: item.name,
    nameSv: item[nameKey] || item.name
  });
}

for (const w of WEAPONS) reg('weapon', w, 'nameSv');
for (const g of LETHALS) reg('lethal', g, 'nameSv');
for (const g of TACTICALS) reg('tactical', g, 'nameSv');
for (const p of PERKS) reg('perk', p, 'nameSv');
for (const k of KILLSTREAKS) reg('killstreak', k, 'nameSv');

UNLOCKABLES.sort((a, b) => a.level - b.level);

export { UNLOCKABLES };

export function unlocksAt(level) {
  return UNLOCKABLES.filter((u) => u.level === level);
}

export function isUnlocked(profile, type, id) {
  const entry = UNLOCKABLES.find((u) => u.type === type && u.id === id);
  if (!entry) return false;
  return levelFromXp(profile.xp).level >= entry.level;
}

export function unlockedIds(profile, type) {
  const lvl = levelFromXp(profile.xp).level;
  return UNLOCKABLES.filter((u) => u.type === type && u.level <= lvl).map((u) => u.id);
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function createProfile(name = 'Soldier') {
  return {
    v: 1,
    name: String(name || 'Soldier').slice(0, 18),
    xp: 0,
    prestige: 0,
    weaponXp: {},
    loadouts: [],
    selectedLoadout: 0,
    settings: {
      lang: 'en',
      sensitivity: 1,
      fov: 80,
      invertY: false,
      showFps: true,
      volume: 0.8,
      ruleset: 'hardcore'
    },
    stats: {
      kills: 0, deaths: 0, assists: 0, headshots: 0, matches: 0, wins: 0,
      bestStreak: 0, playTime: 0, score: 0, longestGame: 0
    }
  };
}

export function normalizeProfile(input) {
  const base = createProfile(input && input.name);
  const p = { ...base, ...(input || {}) };
  p.settings = { ...base.settings, ...(input?.settings || {}) };
  p.stats = { ...base.stats, ...(input?.stats || {}) };
  p.weaponXp = { ...(input?.weaponXp || {}) };
  p.loadouts = Array.isArray(input?.loadouts) ? input.loadouts.slice(0, 5) : [];
  p.xp = Math.max(0, Math.floor(Number(p.xp) || 0));
  p.prestige = Math.min(MAX_PRESTIGE, Math.max(0, Math.floor(Number(p.prestige) || 0)));
  if (p.prestige > 0) p.xp = Math.min(p.xp, cumulativeXp(MAX_LEVEL) + 1);
  return p;
}

/** Add XP and report the levels gained (used for the level-up banner). */
export function addXp(profile, amount) {
  const before = levelFromXp(profile.xp).level;
  profile.xp += Math.max(0, Math.floor(amount));
  const after = levelFromXp(profile.xp).level;
  return { before, after, gained: after - before };
}

export function addWeaponXp(profile, weaponId, amount) {
  if (!weaponId) return 0;
  const before = weaponLevelFromXp(profile.weaponXp[weaponId] || 0).level;
  profile.weaponXp[weaponId] = (profile.weaponXp[weaponId] || 0) + Math.max(0, Math.floor(amount));
  const after = weaponLevelFromXp(profile.weaponXp[weaponId]).level;
  return after - before;
}

export function weaponLevel(profile, weaponId) {
  return weaponLevelFromXp(profile.weaponXp?.[weaponId] || 0).level;
}

export function attachmentsUnlockedFor(profile, weaponId) {
  const lvl = weaponLevel(profile, weaponId);
  return ATTACHMENTS.filter((a) => a.unlockWeaponLevel <= lvl).map((a) => a.id);
}

/** Strip a loadout down to what the profile actually owns. */
export function enforceUnlocks(profile, loadout) {
  const out = { ...loadout };
  const ok = (type, id) => isUnlocked(profile, type, id);
  if (!ok('weapon', out.primary)) out.primary = 'm4a1';
  if (!ok('weapon', out.secondary)) out.secondary = 'm1911';
  if (!ok('lethal', out.lethal)) out.lethal = 'frag';
  if (!ok('tactical', out.tactical)) out.tactical = 'flash';
  for (const slot of [1, 2, 3]) {
    const key = 'perk' + slot;
    if (!ok('perk', out[key])) out[key] = null;
  }
  const allowedPrimary = new Set(attachmentsUnlockedFor(profile, out.primary));
  const allowedSecondary = new Set(attachmentsUnlockedFor(profile, out.secondary));
  out.primaryAttachments = (out.primaryAttachments || []).filter((a) => allowedPrimary.has(a));
  out.secondaryAttachments = (out.secondaryAttachments || []).filter((a) => allowedSecondary.has(a));
  const allowedStreaks = new Set(unlockedIds(profile, 'killstreak'));
  out.killstreaks = (out.killstreaks || []).filter((k) => allowedStreaks.has(k));
  return out;
}

/* ------------------------------------------------------------------ */
/* Match rewards                                                       */
/* ------------------------------------------------------------------ */

export const XP_RULES = {
  kill: 100,
  headshot: 40,
  assist: 30,
  death: 10,
  objective: 60,
  capture: 80,
  plant: 100,
  defuse: 120,
  win: 600,
  loss: 200,
  matchBase: 150,
  weaponKill: 100,
  streakBonusPerKill: 10
};

export function computeMatchReward({ kills = 0, headshots = 0, assists = 0, deaths = 0, objectives = 0, win = false, mode = 'tdm' }) {
  let xp = XP_RULES.matchBase;
  xp += kills * XP_RULES.kill;
  xp += headshots * XP_RULES.headshot;
  xp += assists * XP_RULES.assist;
  xp += deaths * XP_RULES.death;
  xp += objectives * XP_RULES.objective;
  xp += win ? XP_RULES.win : XP_RULES.loss;
  return Math.round(xp);
}

export function kd(stats) {
  if (!stats.deaths) return Number(stats.kills || 0).toFixed(2);
  return (stats.kills / stats.deaths).toFixed(2);
}

/**
 * Apply a finished match to a profile and describe what happened.
 * Shared by the Node server and the browser's offline mode so XP behaves the
 * same whether or not a server is involved.
 */
export function applyMatchToProfile(profile, me, { won, mode }) {
  const xp = computeMatchReward({
    kills: me.kills || 0,
    deaths: me.deaths || 0,
    assists: me.assists || 0,
    headshots: me.headshots || 0,
    objectives: me.objective || 0,
    win: !!won,
    mode
  });

  const beforeLevel = levelFromXp(profile.xp).level;
  const beforeWeapons = new Set(unlockedIds(profile, 'weapon'));
  addXp(profile, xp);

  const weaponLevelUps = {};
  for (const [weaponId, kills] of Object.entries(me.weaponXp || {})) {
    const gained = addWeaponXp(profile, weaponId, kills * XP_RULES.weaponKill);
    if (gained > 0) weaponLevelUps[weaponId] = gained;
  }

  const afterLevel = levelFromXp(profile.xp).level;
  const levelUps = [];
  for (let l = beforeLevel + 1; l <= afterLevel; l++) {
    levelUps.push({ level: l, unlocks: unlocksAt(l) });
  }
  const afterWeapons = new Set(unlockedIds(profile, 'weapon'));
  const weaponUnlocks = [...afterWeapons]
    .filter((id) => !beforeWeapons.has(id))
    .map((id) => UNLOCKABLES.find((u) => u.type === 'weapon' && u.id === id))
    .filter(Boolean);

  profile.stats.kills += me.kills || 0;
  profile.stats.deaths += me.deaths || 0;
  profile.stats.assists += me.assists || 0;
  profile.stats.headshots += me.headshots || 0;
  profile.stats.matches += 1;
  if (won) profile.stats.wins += 1;
  profile.stats.bestStreak = Math.max(profile.stats.bestStreak, me.streak || 0);
  profile.stats.score += me.score || 0;

  return { xp, levelUps, weaponUnlocks, weaponLevelUps, level: afterLevel, totalXp: profile.xp };
}
