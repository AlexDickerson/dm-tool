// Push the monster combatants of an encounter into Foundry VTT as actors.
//
// Flow per combatant with kind='monster' and a known monsterName:
//   1. find_in_compendium → top-ranked Actor match (auto-picked)
//   2. create_actor_from_compendium with displayName as the override
//
// All created actors land in a single folder named after the encounter,
// created via find_or_create_folder so re-pushing the same encounter
// reuses the existing folder instead of stacking duplicates.
//
// PCs are skipped — they already have Foundry character sheets.

import type {
  Combatant,
  Encounter,
  PushEncounterResult,
  PushedActorSummary,
  SkippedCombatantSummary,
} from '@dm-tool/shared/types';
import {
  createActorFromCompendium,
  findInCompendium,
  findOrCreateFolder,
  initSession,
  type CompendiumMatch,
  type McpSession,
} from './foundry-mcp-client.js';

interface ResolvedMatch {
  combatant: Combatant;
  match: CompendiumMatch;
}

async function resolveMatches(
  session: McpSession,
  combatants: Combatant[],
): Promise<{ resolved: ResolvedMatch[]; skipped: SkippedCombatantSummary[] }> {
  const resolved: ResolvedMatch[] = [];
  const skipped: SkippedCombatantSummary[] = [];

  for (const c of combatants) {
    if (c.kind !== 'monster') {
      // PCs are handled by their own Foundry actors — skip without warning.
      continue;
    }
    if (!c.monsterName) {
      skipped.push({ displayName: c.displayName, reason: 'No monsterName on combatant' });
      continue;
    }
    try {
      const matches = await findInCompendium(session, {
        name: c.monsterName,
        documentType: 'Actor',
        limit: 1,
      });
      if (matches.length === 0) {
        skipped.push({
          displayName: c.displayName,
          monsterName: c.monsterName,
          reason: 'No compendium match',
        });
        continue;
      }
      resolved.push({ combatant: c, match: matches[0]! });
    } catch (e) {
      skipped.push({
        displayName: c.displayName,
        monsterName: c.monsterName,
        reason: `Lookup failed: ${(e as Error).message}`,
      });
    }
  }

  return { resolved, skipped };
}

export async function pushEncounterActorsToFoundry(
  encounter: Encounter,
  foundryMcpUrl: string,
): Promise<PushEncounterResult> {
  if (!foundryMcpUrl || foundryMcpUrl.trim().length === 0) {
    throw new Error('Foundry MCP URL is not configured. Set it in Settings → Paths.');
  }

  const session = await initSession(foundryMcpUrl);

  // Phase 1: resolve every monster combatant to a compendium match. Done up
  // front so we know whether we need a folder at all — no point creating one
  // if every lookup fails.
  const { resolved, skipped } = await resolveMatches(session, encounter.combatants);
  if (resolved.length === 0) {
    return { folderId: null, folderName: null, folderCreated: false, created: [], skipped };
  }

  // Phase 2: find-or-create the encounter folder.
  const folderName = encounter.name.trim() || 'Encounter';
  const folder = await findOrCreateFolder(session, { name: folderName, type: 'Actor' });

  // Phase 3: create actors sequentially so partial failures don't leave a
  // half-populated folder. Sequential also keeps the Foundry UI from
  // thrashing on a burst of creations.
  const created: PushedActorSummary[] = [];
  for (const { combatant, match } of resolved) {
    try {
      const actor = await createActorFromCompendium(session, {
        packId: match.packId,
        actorId: match.documentId,
        name: combatant.displayName,
        folder: folder.id,
      });
      created.push({
        displayName: combatant.displayName,
        monsterName: combatant.monsterName!,
        actorId: actor.id,
        actorName: actor.name,
        actorUuid: actor.uuid,
        sourcePackId: match.packId,
        sourcePackLabel: match.packLabel,
      });
    } catch (e) {
      skipped.push({
        displayName: combatant.displayName,
        monsterName: combatant.monsterName,
        reason: `Create failed: ${(e as Error).message}`,
      });
    }
  }

  return {
    folderId: folder.id,
    folderName: folder.name,
    folderCreated: folder.created,
    created,
    skipped,
  };
}
