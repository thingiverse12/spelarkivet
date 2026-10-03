/**
 * Killstreak definitions. Cost = kills without dying (support-style, streak
 * resets on death). The simulation spawns real entities for sentry/heli and
 * runs timed effects for uav/counter-uav/care package/predator strike.
 */
export const KILLSTREAKS = [
  { id: 'uav', name: 'UAV', nameSv: 'UAV', cost: 3, duration: 30,
    desc: 'Shows enemies on the minimap for 30s.', descSv: 'Visar fiender på radarn i 30 s.' },
  { id: 'carepackage', name: 'Care Package', nameSv: 'Vårdpaket', cost: 4,
    desc: 'Drop a crate with a random killstreak.', descSv: 'Släpp en låda med en slumpmässig killstreak.' },
  { id: 'counteruav', name: 'Counter-UAV', nameSv: 'Mot-UAV', cost: 5, duration: 30,
    desc: 'Jams the enemy minimap for 30s.', descSv: 'Jammar fiendens radar i 30 s.' },
  { id: 'sentry', name: 'Sentry Gun', nameSv: 'Bevakningstorn', cost: 7,
    desc: 'Deploy an automated turret (250 HP).', descSv: 'Placera ett automatiskt torn (250 HP).' },
  { id: 'predator', name: 'Predator Missile', nameSv: 'Predator-robot', cost: 9,
    desc: 'Guide a missile onto the map.', descSv: 'Styr en robot mot kartan.' },
  { id: 'helicopter', name: 'Attack Helicopter', nameSv: 'Attackhelikopter', cost: 11, duration: 40,
    desc: 'A gunship hunts enemies for 40s.', descSv: 'En helikopter jagar fiender i 40 s.' }
];

export const KILLSTREAK_MAP = Object.fromEntries(KILLSTREAKS.map((k) => [k.id, k]));

export function sanitizeStreaks(list) {
  const valid = (list || []).filter((id) => KILLSTREAK_MAP[id]);
  return Array.from(new Set(valid)).slice(0, 3);
}

export function streaksForLoadout(loadout) {
  const list = sanitizeStreaks(loadout.killstreaks);
  return list
    .map((id) => KILLSTREAK_MAP[id])
    .sort((a, b) => a.cost - b.cost);
}
