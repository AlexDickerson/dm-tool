// Encounter/combat-tracker CRUD. No sidecar push — encounters live DM-side
// only; players aren't meant to see the stat blocks or HP totals in here.

import { ipcMain } from 'electron';
import type { Encounter, LootItem } from '../../shared/types.js';
import { deleteEncounter, listEncounters, upsertEncounter } from '../pf2e-db.js';
import { generateEncounterLoot } from '../loot-gen.js';

export function registerCombatHandlers(): void {
  ipcMain.handle('encountersList', (): Encounter[] => listEncounters());
  ipcMain.handle('encountersUpsert', (_e, enc: Encounter): void => upsertEncounter(enc));
  ipcMain.handle('encountersDelete', (_e, id: string): void => deleteEncounter(id));
  ipcMain.handle(
    'generateEncounterLoot',
    async (_e, args: { encounter: Encounter; partyLevel: number; apiKey: string }): Promise<LootItem[]> => {
      return generateEncounterLoot(args);
    },
  );
}
