// Chat tool definitions for the two-pass PF2e assistant.
//
// pf2e-db lookups (monsters, items) are injected via `deps` so the AI package
// has no native-module coupling. Fall through to AoN when a dep is not supplied
// or returns a "no results" sentinel.

import { tool } from 'ai';
import { z } from 'zod';
import {
  searchAoN,
  searchMonster as searchMonsterAoN,
  searchItem as searchItemAoN,
  searchFeat,
  searchSpell,
} from '../shared/aon.js';
import { searchCommunity } from '../shared/community.js';

export interface ChatToolDeps {
  /** Optional local monster lookup (e.g. against a pf2e-db SQLite). Return a
   *  string that starts with "[No" if nothing was found, to trigger AoN fallback. */
  searchMonsters?: (query: string) => string;
  /** Optional local item lookup (same contract as searchMonsters). */
  searchItems?: (query: string) => string;
}

export function createChatTools(deps: ChatToolDeps = {}) {
  const lookupRule = tool({
    description:
      'Search Archives of Nethys (the official PF2e SRD) for rules content. ' +
      'Use SHORT keyword queries (1-3 words) matching the official rule/condition/feat/spell name. ' +
      'Make multiple focused calls rather than one long query. ' +
      "Examples: 'Prone', 'flanking', 'Magic Missile', 'Moving Through a Creature\\'s Space'.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'The search query — a rule name, condition, spell, feat, or topic ' +
            "(e.g. 'flanking', 'frightened condition', 'magic missile')",
        ),
    }),
    execute: async ({ query }) => searchAoN(query),
  });

  const searchDiscussions = tool({
    description:
      'Search PF2e community discussions on Reddit (r/Pathfinder2e, r/Pathfinder_RPG) and RPG Stack Exchange. ' +
      'Use this for edge cases, ambiguous rules interpretations, GM advice, homebrew opinions, or when ' +
      "the official rules don't fully answer the question. NOT for official rules text — use lookupRule for that.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'The search query — a rules question or topic ' +
            "(e.g. 'prone sharing space RAW', 'balancing boss encounters')",
        ),
    }),
    execute: async ({ query }) => searchCommunity(query),
  });

  const lookupMonster = tool({
    description: 'Look up a PF2e creature/monster by name. Returns stats, abilities, and description.',
    inputSchema: z.object({
      query: z.string().describe("Creature name (e.g. 'Goblin Warrior', 'Adult Red Dragon', 'Lich')"),
    }),
    execute: async ({ query }) => {
      if (deps.searchMonsters) {
        try {
          const local = deps.searchMonsters(query);
          if (!local.startsWith('[No')) return local;
        } catch {
          /* local DB failed, fall through */
        }
      }
      return searchMonsterAoN(query);
    },
  });

  const lookupItem = tool({
    description:
      'Look up a PF2e item (equipment, weapon, armor, shield) by name. ' +
      'Returns stats, price, traits, and description.',
    inputSchema: z.object({
      query: z.string().describe("Item name (e.g. 'Longsword', 'Healing Potion', 'Striking Rune')"),
    }),
    execute: async ({ query }) => {
      if (deps.searchItems) {
        try {
          const local = deps.searchItems(query);
          if (!local.startsWith('[No')) return local;
        } catch {
          /* local DB failed, fall through */
        }
      }
      return searchItemAoN(query);
    },
  });

  const lookupFeat = tool({
    description:
      'Look up a PF2e feat by name on Archives of Nethys. Returns prerequisites, actions, traits, and description.',
    inputSchema: z.object({
      query: z.string().describe("Feat name (e.g. 'Power Attack', 'Fleet', 'Incredible Initiative')"),
    }),
    execute: async ({ query }) => searchFeat(query),
  });

  const lookupSpell = tool({
    description:
      'Look up a PF2e spell by name on Archives of Nethys. Returns rank, traditions, components, range, and description.',
    inputSchema: z.object({
      query: z.string().describe("Spell name (e.g. 'Fireball', 'Heal', 'Magic Missile')"),
    }),
    execute: async ({ query }) => searchSpell(query),
  });

  return {
    lookupRule,
    searchDiscussions,
    lookupMonster,
    lookupItem,
    lookupFeat,
    lookupSpell,
  };
}

/** Human-readable labels for tool-status UI feedback. */
export const TOOL_STATUS_LABELS: Record<string, string> = {
  searchDiscussions: 'Searching community',
  lookupMonster: 'Looking up creature',
  lookupItem: 'Looking up item',
  lookupFeat: 'Looking up feat',
  lookupSpell: 'Looking up spell',
};
