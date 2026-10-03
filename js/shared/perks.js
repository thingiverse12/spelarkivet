/**
 * Perks. Three slots, mirroring classic CoD loadout structure.
 */
export const PERKS = [
  { id: 'marathon', slot: 1, name: 'Marathon', nameSv: 'Maraton', unlockLevel: 6,
    desc: 'Sprint without limit.', descSv: 'Springa utan gräns.' },
  { id: 'scavenger', slot: 1, name: 'Scavenger', nameSv: 'Aasätare', unlockLevel: 4,
    desc: 'Resupply ammo and grenades from kills.', descSv: 'Fyll på ammo från fiender du dödar.' },
  { id: 'sitrep', slot: 1, name: 'SitRep', nameSv: 'Lägesrapport', unlockLevel: 15,
    desc: 'See enemy equipment and hear footsteps.', descSv: 'Se fiendens utrustning och hör fotsteg.' },

  { id: 'sleight', slot: 2, name: 'Sleight of Hand', nameSv: 'Snabbhandske', unlockLevel: 2,
    desc: 'Reload 40% faster.', descSv: 'Ladda om 40 % snabbare.' },
  { id: 'stoppingpower', slot: 2, name: 'Stopping Power', nameSv: 'Stoppkraft', unlockLevel: 9,
    desc: '+20% bullet damage.', descSv: '+20 % skottskada.' },
  { id: 'coldblooded', slot: 2, name: 'Cold Blooded', nameSv: 'Kallblodig', unlockLevel: 12,
    desc: 'Untargetable by killstreaks, hidden from UAV.', descSv: 'Kan inte målas av killstreaks, osynlig för UAV.' },

  { id: 'steadyaim', slot: 3, name: 'Steady Aim', nameSv: 'Stadigt sikte', unlockLevel: 5,
    desc: '25% tighter hip fire.', descSv: '25 % tajtare höfteld.' },
  { id: 'commando', slot: 3, name: 'Commando', nameSv: 'Kommando', unlockLevel: 14,
    desc: 'Higher step-up, no fall damage, faster mantling.', descSv: 'Högre steg, ingen fallskada.' },
  { id: 'ninja', slot: 3, name: 'Ninja', nameSv: 'Ninja', unlockLevel: 18,
    desc: 'Silent footsteps, immune to UAV.', descSv: 'Tysta fotsteg, immun mot UAV.' }
];

export const PERK_MAP = Object.fromEntries(PERKS.map((p) => [p.id, p]));

export function perksBySlot(slot) { return PERKS.filter((p) => p.slot === slot); }

/** @returns {Set<string>} validated perk ids */
export function sanitizePerks(loadout) {
  const out = new Set();
  for (const slot of [1, 2, 3]) {
    const id = loadout['perk' + slot];
    const perk = PERK_MAP[id];
    if (perk && perk.slot === slot) out.add(id);
  }
  return out;
}
