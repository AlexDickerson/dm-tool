// Encounter/combat-tracker CRUD. No sidecar push — encounters live DM-side
// only; players aren't meant to see the stat blocks or HP totals in here.

import { ipcMain } from 'electron';
import type { Encounter, LootItem, PushEncounterResult } from '../../shared/types.js';
import type { DmToolConfig } from '../config.js';
import { deleteEncounter, listEncounters, upsertEncounter } from '../pf2e-db.js';
import { generateEncounterLoot } from '../loot-gen.js';
import { pushEncounterActorsToFoundry } from '../encounter-push.js';

export function registerCombatHandlers(cfg: DmToolConfig): void {
  ipcMain.handle('encountersList', (): Encounter[] => listEncounters());
  ipcMain.handle('encountersUpsert', (_e, enc: Encounter): void => upsertEncounter(enc));
  ipcMain.handle('encountersDelete', (_e, id: string): void => deleteEncounter(id));
  ipcMain.handle(
    'generateEncounterLoot',
    async (_e, args: { encounter: Encounter; partyLevel: number; apiKey: string }): Promise<LootItem[]> => {
      return generateEncounterLoot(args);
    },
  );
  ipcMain.handle('pushEncounterToFoundry', async (_e, encounterId: string): Promise<PushEncounterResult> => {
    if (!cfg.foundryMcpUrl) {
      throw new Error('Foundry MCP URL is not configured. Set it in Settings → Paths.');
    }
    const enc = listEncounters().find((x) => x.id === encounterId);
    if (!enc) throw new Error(`Encounter not found: ${encounterId}`);
    return pushEncounterActorsToFoundry(enc, cfg.foundryMcpUrl);
  });
}
