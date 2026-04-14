// Chat tool definitions for the two-pass PF2e assistant.
// Separated from chat orchestration so tools can be reviewed,
// tested, or conditionally included without touching streaming logic.

import { tool } from 'ai';
import { z } from 'zod';
import {
  searchAoN,
  searchMonster as searchMonsterAoN,
  searchItem as searchItemAoN,
  searchFeat,
  searchSpell,
} from './aon.js';
import { searchCommunity } from './community.js';
import { searchMonsters as searchMonstersDb, searchItems as searchItemsDb } from './pf2e-db.js';

export const lookupRule = tool({
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

export const searchDiscussions = tool({
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

export const lookupMonster = tool({
  description: 'Look up a PF2e creature/monster by name. Returns stats, abilities, and description.',
  inputSchema: z.object({
    query: z.string().describe("Creature name (e.g. 'Goblin Warrior', 'Adult Red Dragon', 'Lich')"),
  }),
  execute: async ({ query }) => {
    try {
      const local = searchMonstersDb(query);
      if (!local.startsWith('[No')) return local;
    } catch {
      /* DB not loaded, fall through */
    }
    return searchMonsterAoN(query);
  },
});

export const lookupItem = tool({
  description:
    'Look up a PF2e item (equipment, weapon, armor, shield) by name. ' +
    'Returns stats, price, traits, and description.',
  inputSchema: z.object({
    query: z.string().describe("Item name (e.g. 'Longsword', 'Healing Potion', 'Striking Rune')"),
  }),
  execute: async ({ query }) => {
    try {
      const local = searchItemsDb(query);
      if (!local.startsWith('[No')) return local;
    } catch {
      /* DB not loaded, fall through */
    }
    return searchItemAoN(query);
  },
});

export const lookupFeat = tool({
  description:
    'Look up a PF2e feat by name on Archives of Nethys. Returns prerequisites, actions, traits, and description.',
  inputSchema: z.object({
    query: z.string().describe("Feat name (e.g. 'Power Attack', 'Fleet', 'Incredible Initiative')"),
  }),
  execute: async ({ query }) => searchFeat(query),
});

export const lookupSpell = tool({
  description:
    'Look up a PF2e spell by name on Archives of Nethys. Returns rank, traditions, components, range, and description.',
  inputSchema: z.object({
    query: z.string().describe("Spell name (e.g. 'Fireball', 'Heal', 'Magic Missile')"),
  }),
  execute: async ({ query }) => searchSpell(query),
});

/** All chat tools as a record, ready to pass to generateText(). */
export const chatTools = {
  lookupRule,
  searchDiscussions,
  lookupMonster,
  lookupItem,
  lookupFeat,
  lookupSpell,
};

/** Human-readable labels for tool-status UI feedback. */
export const TOOL_STATUS_LABELS: Record<string, string> = {
  searchDiscussions: 'Searching community',
  lookupMonster: 'Looking up creature',
  lookupItem: 'Looking up item',
  lookupFeat: 'Looking up feat',
  lookupSpell: 'Looking up spell',
};
