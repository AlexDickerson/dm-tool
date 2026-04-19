// AI loot generator for combat encounters.
//
// Mechanical fit first: computes a PF2e treasure budget from the encounter's
// XP threat (summed creature-level → XP via CRB Table 10-1) scaled against
// the party's per-level treasure budget (Table 10-9). That budget is handed
// to the model as a hard constraint so "scaled to threat level" holds
// regardless of model cleverness.
//
// Thematic fit second: the model gets the monster roster (name, level, traits)
// so it can flavor names and pick items that suit the fight.
//
// Items source: when encounter.allowInventedItems is false, every row MUST
// come from the caller-supplied DB shortlist. When true, up to 20% can be
// model-invented, the rest must still be real items.

import { randomUUID } from 'node:crypto';
import type { Encounter, LootItem, LootKind, LootSource } from '@dm-tool/shared/types';
import { callAnthropic } from '../shared/anthropic.js';
import { DEFAULT_MODEL, LOOT_MAX_TOKENS } from '../shared/constants.js';
import { tryParseJson } from '../shared/text.js';

// --- Public input types (callers supply these) -----------------------------

export interface LootMonster {
  name: string;
  level: number;
  traits: string[];
}

/** A DB-sourced item the model can pick from. Caller is responsible for
 *  pre-querying a random, level-appropriate slice of their items table. */
export interface LootShortlistItem {
  id: string;
  name: string;
  level: number | null;
  price: string | null;
  bulk: string | null;
  traits: string | null;
  usage: string | null;
  aonUrl: string | null;
  isMagical: number;
  source: string | null;
}

export interface GenerateLootInput {
  apiKey: string;
  encounter: Encounter;
  partyLevel: number;
  /** Monsters resolved from the encounter's combatant list; used for XP math
   *  and thematic flavor. Combatants that failed to resolve should be dropped
   *  before calling. */
  monsters: LootMonster[];
  /** Pre-queried item shortlist. Recommended shape: ~80 random items at
   *  party level ±2. Cast a wide net so the model has room for thematic fit
   *  once mechanical fit is satisfied. */
  shortlist: LootShortlistItem[];
}

// --- PF2e treasure + XP tables ---------------------------------------------

/** Total character-treasure-per-level for a 4-player party, in gp.
 *  Source: PF2e Core Rulebook Table 10-9. The party is expected to see
 *  roughly 4 encounters' worth of treasure per level, so a moderate-threat
 *  encounter's budget is this value / 4. */
const TREASURE_PER_LEVEL_GP: Record<number, number> = {
  1: 175,
  2: 300,
  3: 500,
  4: 850,
  5: 1350,
  6: 2000,
  7: 2900,
  8: 4000,
  9: 5700,
  10: 8000,
  11: 11500,
  12: 16500,
  13: 25000,
  14: 36500,
  15: 54500,
  16: 82500,
  17: 128000,
  18: 208000,
  19: 355000,
  20: 490000,
};

/** Relative-level → XP (PF2e Core Rulebook, Table 10-1). Creatures more than
 *  four levels below the party contribute nothing; more than four above are
 *  capped at extreme (160). */
function creatureXp(creatureLevel: number, partyLevel: number): number {
  const d = creatureLevel - partyLevel;
  if (d <= -5) return 0;
  if (d >= 5) return 200;
  return [10, 15, 20, 30, 40, 60, 80, 120, 160][d + 4];
}

function threatLabel(totalXp: number): 'trivial' | 'low' | 'moderate' | 'severe' | 'extreme' {
  if (totalXp <= 40) return 'trivial';
  if (totalXp <= 60) return 'low';
  if (totalXp <= 100) return 'moderate';
  if (totalXp <= 140) return 'severe';
  return 'extreme';
}

/** Multiplier against the moderate-encounter budget. Continuous rather than
 *  bucketed so tuned encounters (70 XP, 110 XP, etc.) still produce
 *  proportional treasure instead of snapping to a threshold. */
function budgetMultiplier(totalXp: number): number {
  return Math.max(0.25, totalXp / 80);
}

// --- Prompt ----------------------------------------------------------------

function summarizeMonster(m: LootMonster): string {
  const traits = m.traits.length > 0 ? ` [${m.traits.slice(0, 5).join(', ')}]` : '';
  return `${m.name} (Lvl ${m.level})${traits}`;
}

function buildLootPrompt(args: {
  encounter: Encounter;
  partyLevel: number;
  totalXp: number;
  threat: ReturnType<typeof threatLabel>;
  budgetGp: number;
  monsterLines: string[];
  shortlist: LootShortlistItem[];
  allowInvented: boolean;
}): string {
  const { encounter, partyLevel, totalXp, threat, budgetGp, monsterLines, shortlist, allowInvented } = args;
  const shortlistForModel = shortlist.map((s) => ({
    id: s.id,
    name: s.name,
    level: s.level,
    price: s.price,
    traits: s.traits,
    usage: s.usage,
    aonUrl: s.aonUrl,
  }));
  const inventionRule = allowInvented
    ? `5. You MAY invent up to 20% of items (round down, so for 4 items you can invent 0; for 5 items you can invent 1). When inventing, set source="ai" and omit itemId/aonUrl. All remaining rows MUST come from the DB shortlist with source="db" and their itemId copied from the shortlist.`
    : `5. You MUST pick every item from the DB shortlist below. Set source="db" and copy itemId + aonUrl verbatim from the shortlist. Do NOT invent items. You may still invent a small currency reward (source="ai", kind="currency").`;

  return [
    `You are generating treasure for a Pathfinder 2e encounter. Produce loot that is appropriate mechanically (scaled to threat and party level) first, thematically satisfying (flavored to the creatures present) second.`,
    ``,
    `Encounter: ${encounter.name}`,
    `Party level: ${partyLevel}`,
    `Encounter XP: ${totalXp} (${threat})`,
    `Treasure budget: approximately ${budgetGp.toFixed(0)} gp total`,
    ``,
    `Monsters in this encounter:`,
    monsterLines.length > 0 ? monsterLines.map((m) => `- ${m}`).join('\n') : '- (no monsters)',
    ``,
    `Rules:`,
    `1. The total monetary value of all loot should approximate ${budgetGp.toFixed(0)} gp. A deviation of ±20% is acceptable.`,
    `2. Mechanical fit FIRST: item levels should be appropriate for a level ${partyLevel} party (typically ${partyLevel - 1} to ${partyLevel + 1}).`,
    `3. Thematic fit SECOND (only after mechanical fit is satisfied): prefer items that suit the monster roster's theme, traits, or creature type.`,
    `4. Prefer a mix: 1-3 items + a modest currency reward is typical for a moderate-threat fight. Scale item count with threat.`,
    inventionRule,
    `6. "kind" values: "currency" for coin rewards, "item" for permanent equipment, "consumable" for single-use items (potions, scrolls, elixirs, etc.), "narrative" for story-only items with no monetary value.`,
    `7. "valueCp" is in copper pieces. 1 gp = 100 cp, 1 sp = 10 cp. Match the shortlist's price field when picking DB items.`,
    ``,
    `DB shortlist (${shortlist.length} items, level ${Math.max(0, partyLevel - 2)}-${partyLevel + 2}):`,
    JSON.stringify(shortlistForModel),
    ``,
    `Respond with ONLY a JSON object in this exact shape, no code fences or commentary:`,
    `{"items": [{"name": "…", "description": "…", "kind": "item", "valueCp": 10000, "qty": 1, "itemId": "…", "aonUrl": "…", "source": "db"}]}`,
  ].join('\n');
}

// --- Response parsing ------------------------------------------------------

interface ModelLootItem {
  name: unknown;
  description: unknown;
  kind: unknown;
  valueCp?: unknown;
  qty?: unknown;
  itemId?: unknown;
  aonUrl?: unknown;
  source: unknown;
}

const VALID_KINDS: readonly LootKind[] = ['currency', 'item', 'consumable', 'narrative'];
const VALID_SOURCES: readonly LootSource[] = ['db', 'ai', 'manual'];

function coerceLootItem(raw: ModelLootItem): LootItem | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const kind = VALID_KINDS.includes(raw.kind as LootKind) ? (raw.kind as LootKind) : 'item';
  const source = VALID_SOURCES.includes(raw.source as LootSource) ? (raw.source as LootSource) : 'ai';
  const qty = Math.max(1, Math.floor(typeof raw.qty === 'number' ? raw.qty : 1));
  const valueCp =
    typeof raw.valueCp === 'number' && Number.isFinite(raw.valueCp) ? Math.max(0, raw.valueCp) : undefined;
  const itemId = typeof raw.itemId === 'string' && raw.itemId.length > 0 ? raw.itemId : undefined;
  const aonUrl = typeof raw.aonUrl === 'string' && raw.aonUrl.length > 0 ? raw.aonUrl : undefined;
  return {
    id: randomUUID(),
    name,
    description,
    kind,
    qty,
    valueCp,
    itemId,
    aonUrl,
    source,
  };
}

function parseLootResponse(rawText: string): LootItem[] {
  let text = rawText.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  const parsed = tryParseJson<{ items?: ModelLootItem[] }>(text, {});
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items.map(coerceLootItem).filter((x): x is LootItem => x !== null);
}

// --- Entry point -----------------------------------------------------------

export async function generateEncounterLoot(input: GenerateLootInput): Promise<LootItem[]> {
  const { apiKey, encounter, partyLevel, monsters, shortlist } = input;

  const totalXp = monsters.reduce((sum, m) => sum + creatureXp(m.level, partyLevel), 0);
  const monsterLines = monsters.map(summarizeMonster);

  const moderatePerEncounterGp = (TREASURE_PER_LEVEL_GP[partyLevel] ?? TREASURE_PER_LEVEL_GP[10]) / 4;
  const budgetGp = moderatePerEncounterGp * budgetMultiplier(totalXp);

  const prompt = buildLootPrompt({
    encounter,
    partyLevel,
    totalXp,
    threat: threatLabel(totalXp),
    budgetGp,
    monsterLines,
    shortlist,
    allowInvented: encounter.allowInventedItems,
  });

  const responseText = await callAnthropic({
    apiKey,
    model: DEFAULT_MODEL,
    maxTokens: LOOT_MAX_TOKENS,
    prompt,
  });
  return parseLootResponse(responseText);
}
