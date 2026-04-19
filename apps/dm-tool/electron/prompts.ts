// AI prompt templates for features that still live in the Electron main process.
// Chat prompts have moved to packages/ai.

import type { MapDetail } from '@dm-tool/shared/types';

// ---------------------------------------------------------------------------
// Encounter hook generation
// ---------------------------------------------------------------------------

/** Build the user-side prompt for encounter hook generation. The model is
 *  asked to return a JSON array of new hooks, distinct from existing ones. */
export function buildEncounterHookPrompt(detail: MapDetail): string {
  const existing = [...detail.encounterHooks, ...detail.additionalEncounterHooks];
  const existingBlock =
    existing.length > 0
      ? `Existing encounter hooks (do NOT repeat or paraphrase these):\n${existing
          .map((h, i) => `${i + 1}. ${h}`)
          .join('\n')}`
      : 'There are no existing encounter hooks yet.';

  const tags = [
    detail.biomes.length > 0 ? `Biomes: ${detail.biomes.join(', ')}` : null,
    detail.locationTypes.length > 0 ? `Locations: ${detail.locationTypes.join(', ')}` : null,
    detail.mood.length > 0 ? `Mood: ${detail.mood.join(', ')}` : null,
    detail.features.length > 0 ? `Features: ${detail.features.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `You are helping a tabletop RPG dungeon master brainstorm encounter hooks for a battlemap.`,
    ``,
    `Map title: ${detail.title}`,
    detail.description ? `Map description: ${detail.description}` : null,
    tags || null,
    ``,
    existingBlock,
    ``,
    `Look at the attached image and write 3 NEW encounter hooks that could play out on this map. Each hook should be 1–2 sentences, evocative, and directly grounded in what is visible in the image. Vary the tone (combat, social, exploration, mystery). Do not repeat anything from the existing hooks.`,
    ``,
    `Respond with ONLY a JSON array of strings — no preamble, no code fences, no commentary. Example format: ["First hook here.", "Second hook here.", "Third hook here."]`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}
