import type { Combatant } from '@dm-tool/shared/types';

/** Sort combatants by initiative descending, tiebreaking on initiativeMod
 *  (PF2e houserules vary — mod is a reasonable default). Unrolled combatants
 *  (initiative === null) sort to the end so fresh adds don't shuffle whose
 *  turn it is. The returned array is a new one; callers treat it as read-only. */
export function sortedCombatants(combatants: Combatant[]): Combatant[] {
  return [...combatants].sort((a, b) => {
    const ai = a.initiative ?? -Infinity;
    const bi = b.initiative ?? -Infinity;
    if (ai !== bi) return bi - ai;
    if (a.initiativeMod !== b.initiativeMod) return b.initiativeMod - a.initiativeMod;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function rollD20(mod: number): number {
  return Math.floor(Math.random() * 20) + 1 + mod;
}

/** Auto-number duplicates of a monster. If "Goblin" is already in the list,
 *  the next one becomes "Goblin 2" and existing "Goblin" gets renamed to
 *  "Goblin 1". Returns the (possibly) renamed existing list + the next name
 *  the caller should assign. PCs aren't auto-numbered — the DM picks names
 *  for those. */
export function reserveMonsterName(combatants: Combatant[], baseName: string): { existing: Combatant[]; next: string } {
  const matches = combatants.filter((c) => c.monsterName === baseName);
  if (matches.length === 0) return { existing: combatants, next: baseName };
  if (matches.length === 1 && matches[0].displayName === baseName) {
    // Promote the lone match to "<name> 1" before adding "<name> 2".
    return {
      existing: combatants.map((c) => (c.id === matches[0].id ? { ...c, displayName: `${baseName} 1` } : c)),
      next: `${baseName} 2`,
    };
  }
  // Find the highest trailing index in use and go one past it.
  const re = new RegExp(`^${escapeRegex(baseName)} (\\d+)$`);
  let maxIdx = 0;
  for (const c of matches) {
    const m = c.displayName.match(re);
    if (m) maxIdx = Math.max(maxIdx, parseInt(m[1], 10));
  }
  return { existing: combatants, next: `${baseName} ${maxIdx + 1}` };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
