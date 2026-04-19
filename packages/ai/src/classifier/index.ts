// AI-powered book classification. Sends a cover image + filename to Claude
// and gets back structured metadata (system, category, title, publisher).

import type { BookClassification } from '@dm-tool/shared/types';
import { callAnthropic, type VisionMediaType } from '../shared/anthropic.js';
import { CLASSIFY_MAX_TOKENS, DEFAULT_MODEL } from '../shared/constants.js';

const PROMPT = [
  'You are classifying a TTRPG PDF book for a digital library catalog.',
  '',
  'The attached image is the cover of the book. The filename is: "{fileName}"',
  '',
  'Classify this book into the following fields:',
  '- system: The game system. One of "PF2e" (Pathfinder 2nd Edition), "5e" (D&D 5th Edition), or "Generic" (system-agnostic or other).',
  '- category: One of "Rulebook", "Adventure Path", "Adventure", "Setting", "Supplement".',
  '- subcategory: The series or product line name if part of a series (e.g. "Abomination Vaults", "Strength of Thousands"). Null if standalone.',
  '- title: The clean, human-readable title of this specific book (e.g. "Ruins of Gauntlight", "Player Core"). Strip branding prefixes like "Pathfinder" or "Pathfinder 2e".',
  '- publisher: The publisher name (e.g. "Paizo", "Kobold Press", "Green Ronin"). Null if unknown.',
  '',
  'Category guidance:',
  '- "Rulebook": Core rules, player options, GM guides, bestiaries (Player Core, GM Core, Monster Core, etc.)',
  '- "Adventure Path": Part of a serialized adventure series (Abomination Vaults 1 of 3, etc.)',
  '- "Adventure": Standalone or one-shot adventures, adventure modules',
  '- "Setting": World/region sourcebooks, gazetteers, lore books (Lost Omens series, etc.)',
  '- "Supplement": Accessories, card decks, pawn collections, character sheets, player\'s guides',
  '',
  'Respond with ONLY a JSON object. No preamble, no code fences, no commentary.',
  'Use null (not the string "null") for missing values.',
  'Example: {"system":"PF2e","category":"Adventure Path","subcategory":"Abomination Vaults","title":"Ruins of Gauntlight","publisher":"Paizo"}',
].join('\n');

export interface ClassifyBookInput {
  apiKey: string;
  coverImage: Buffer;
  /** Defaults to image/png (historical behavior — covers are extracted as PNG). */
  mediaType?: VisionMediaType;
  fileName: string;
}

export async function classifyBook(input: ClassifyBookInput): Promise<BookClassification> {
  const raw = await callAnthropic({
    apiKey: input.apiKey,
    model: DEFAULT_MODEL,
    maxTokens: CLASSIFY_MAX_TOKENS,
    prompt: PROMPT.replace('{fileName}', input.fileName),
    image: {
      buffer: input.coverImage,
      mediaType: input.mediaType ?? 'image/png',
    },
  });

  // Strip markdown code fences if present.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Failed to parse classification JSON: ${stripped.slice(0, 200)}`);
  }

  const c = parsed as Record<string, unknown>;
  return {
    system: typeof c.system === 'string' ? c.system : 'Generic',
    category: typeof c.category === 'string' ? c.category : 'Supplement',
    subcategory: typeof c.subcategory === 'string' ? c.subcategory : null,
    title: typeof c.title === 'string' ? c.title : input.fileName.replace(/\.pdf$/i, ''),
    publisher: typeof c.publisher === 'string' ? c.publisher : null,
  };
}
