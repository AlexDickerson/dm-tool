// AI-powered book classification. Sends a cover image + filename to Claude
// and gets back structured metadata (system, category, title, publisher).
//
// Follows the same direct-fetch pattern as anthropic.ts — keeps the API key
// in the main process, avoids CORS/CSP, minimal dependencies.

import type { BookClassification } from '../shared/types.js';
import { DEFAULT_MODEL, ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, CLASSIFY_MAX_TOKENS } from './constants.js';

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

export async function classifyBook(args: {
  apiKey: string;
  coverBlob: Buffer;
  fileName: string;
}): Promise<BookClassification> {
  const { apiKey, coverBlob, fileName } = args;

  const body = {
    model: DEFAULT_MODEL,
    max_tokens: CLASSIFY_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: coverBlob.toString('base64'),
            },
          },
          {
            type: 'text',
            text: PROMPT.replace('{fileName}', fileName),
          },
        ],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const textBlock = json.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('No text in Anthropic response');
  }

  // Strip markdown code fences if present.
  const raw = textBlock.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse classification JSON: ${raw.slice(0, 200)}`);
  }

  const c = parsed as Record<string, unknown>;
  return {
    system: typeof c.system === 'string' ? c.system : 'Generic',
    category: typeof c.category === 'string' ? c.category : 'Supplement',
    subcategory: typeof c.subcategory === 'string' ? c.subcategory : null,
    title: typeof c.title === 'string' ? c.title : args.fileName.replace(/\.pdf$/i, ''),
    publisher: typeof c.publisher === 'string' ? c.publisher : null,
  };
}
