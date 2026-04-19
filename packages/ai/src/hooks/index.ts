// Encounter hook generator — vision model reads a map thumbnail and returns
// a JSON array of three new hooks grounded in what's visible on the map.

import type { MapDetail } from '@dm-tool/shared/types';
import { callAnthropic, type VisionMediaType } from '../shared/anthropic.js';

export type { VisionMediaType } from '../shared/anthropic.js';
import { DEFAULT_MODEL, ENCOUNTER_HOOK_MAX_TOKENS } from '../shared/constants.js';
import { buildEncounterHookPrompt } from './prompts.js';

/** Strip Markdown code fences (```json … ```) the model sometimes wraps
 *  responses in despite the instructions, and parse the JSON array. */
function parseHookList(rawText: string): string[] {
  let text = rawText.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Anthropic returned non-JSON content: ${(e as Error).message}. Raw: ${rawText.slice(0, 200)}`, {
      cause: e,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Anthropic returned non-array JSON: ${typeof parsed}`);
  }
  const hooks = parsed
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (hooks.length === 0) {
    throw new Error('Anthropic returned an empty hook list');
  }
  return hooks;
}

export interface GenerateHooksInput {
  apiKey: string;
  mapImage: Buffer;
  mediaType: VisionMediaType;
  detail: MapDetail;
}

/** Generate fresh encounter hooks for one map. Throws on any failure
 *  (network, auth, parse) so callers can surface a useful error string. */
export async function generateEncounterHooks(input: GenerateHooksInput): Promise<string[]> {
  const raw = await callAnthropic({
    apiKey: input.apiKey,
    model: DEFAULT_MODEL,
    maxTokens: ENCOUNTER_HOOK_MAX_TOKENS,
    prompt: buildEncounterHookPrompt(input.detail),
    image: {
      buffer: input.mapImage,
      mediaType: input.mediaType,
    },
  });
  return parseHookList(raw);
}
