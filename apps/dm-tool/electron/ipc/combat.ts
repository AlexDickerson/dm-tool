// Encounter/combat-tracker CRUD. No sidecar push — encounters live DM-side
// only; players aren't meant to see the stat blocks or HP totals in here.

import { ipcMain } from 'electron';
import type { Encounter, LootItem, PushEncounterResult } from '@dm-tool/shared/types';
import { generateEncounterLoot, type LootMonster } from '@dm-tool/ai/loot';
import type { DmToolConfig } from '../config.js';
import {
  buildLootShortlist,
  deleteEncounter,
  getMonsterRowByName,
  listEncounters,
  upsertEncounter,
} from '../pf2e-db.js';
import { tryParseJson } from '../util.js';
import { pushEncounterActorsToFoundry } from '../encounter-push.js';

export function registerCombatHandlers(cfg: DmToolConfig): void {
  ipcMain.handle('encountersList', (): Encounter[] => listEncounters());
  ipcMain.handle('encountersUpsert', (_e, enc: Encounter): void => upsertEncounter(enc));
  ipcMain.handle('encountersDelete', (_e, id: string): void => deleteEncounter(id));
  ipcMain.handle(
    'generateEncounterLoot',
    async (_e, args: { encounter: Encounter; partyLevel: number; apiKey: string }): Promise<LootItem[]> => {
      if (!args?.apiKey || args.apiKey.trim().length === 0) {
        throw new Error('Anthropic API key is not set. Add one in Settings.');
      }

      const monsters: LootMonster[] = [];
      for (const c of args.encounter.combatants) {
        if (c.kind !== 'monster' || !c.monsterName) continue;
        const row = getMonsterRowByName(c.monsterName);
        if (!row) continue;
        monsters.push({
          name: row.name,
          level: row.level,
          traits: tryParseJson<string[]>(row.traits, []),
        });
      }

      const shortlist = buildLootShortlist(args.partyLevel);

      return generateEncounterLoot({
        apiKey: args.apiKey,
        encounter: args.encounter,
        partyLevel: args.partyLevel,
        monsters,
        shortlist,
      });
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
