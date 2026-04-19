// AI-driven pack grouping for battlemap variants.
//
// Instead of fragile filename-stemming heuristics, the user sends all
// filenames to Claude and gets back a JSON mapping of filename → pack
// name. This module handles prompt generation + import/validation of the
// response; persistence lives in pf2e.db's pack_mappings table.
//
// The user handles the actual API interaction outside the app (paste the
// prompt into claude.ai, get the JSON back, import it). This sidesteps
// token limits, timeouts, and API key management for a one-time operation.

import { mapStem } from '@dm-tool/shared/map-stem';
import {
  hasPackMappings,
  listPackMappings,
  renamePackMappings,
  replacePackMappings,
  upsertPackMapping,
} from '@dm-tool/db/pf2e';

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildGroupingPrompt(fileNames: string[]): string {
  const list = fileNames.map((f) => `  "${f}"`).join('\n');
  return [
    `You are helping organize a battlemap image library for a tabletop RPG tool.`,
    ``,
    `Below is a list of ${fileNames.length} battlemap image filenames. Many of these are variants of the same base map — different lighting, weather, grid overlays, seasons, prop configurations, etc. from the same artist pack.`,
    ``,
    `Your task: group these filenames into packs. Files that are variants of the same base map should share the same pack name. Give each pack a short, readable name (2-4 words, title case) that describes the base map — e.g. "Alchemist's Lab", "Forest Clearing", "Grounded Castle".`,
    ``,
    `Guidelines:`,
    `- Files with Czepeku-style prefixes (GL_ or G_) followed by the same base name are always the same pack, regardless of the room/subarea suffix. GL_ means gridded, G_ means gridless.`,
    `- Variant suffixes like Day/Night/Dawn/Dusk, Rain/Snow/Storm, Grid/Gridless, Spring/Summer/Fall/Winter, Propless, etc. should be ignored when grouping.`,
    `- Dimensional suffixes like "30x38" or "50x30" are grid size annotations, not pack identifiers.`,
    `- If a file doesn't seem to belong to any pack, give it its own unique pack name.`,
    `- Pack names should be descriptive of the location, not the variant. "Tavern Interior" not "Tavern Day".`,
    ``,
    `Filenames:`,
    list,
    ``,
    `Respond with ONLY a downloadable JSON file mapping each filename (exactly as given) to its pack name. No preamble, no commentary — just the file.`,
    `Example format: {"file1.jpg": "Forest Clearing", "file2.jpg": "Forest Clearing", "file3.jpg": "Dark Tavern"}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Import / parse
// ---------------------------------------------------------------------------

/** Parse and validate a JSON mapping from user-provided text (e.g. copied
 *  from Claude's response). Strips code fences if present. Fills in
 *  missing filenames as singletons. */
export function parseAndCacheMapping(rawText: string, fileNames: string[]): Record<string, string> {
  let text = rawText.trim();
  // Strip code fences if present ([\s\S] spans newlines).
  const fenceMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`, { cause: e });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object, got ${typeof parsed}`);
  }

  const mapping = parsed as Record<string, string>;

  // Validate: every filename must have a string pack name. Fill in any
  // missing ones as singletons.
  const result: Record<string, string> = {};
  for (const fn of fileNames) {
    const pack = mapping[fn];
    if (typeof pack === 'string' && pack.trim().length > 0) {
      result[fn] = pack.trim();
    } else {
      result[fn] = fn.replace(/\.[a-zA-Z0-9]+$/, '');
    }
  }

  replacePackMappings(result);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fallback pack name for a file that hasn't been AI-grouped yet. */
function stemOrBasename(fn: string): string {
  return mapStem(fn) || fn.replace(/\.[a-zA-Z0-9]+$/, '');
}

/** Return the cached pack mapping if it exists, scoped to the given
 *  library. Files missing from the cache get filled in via the stem
 *  heuristic and written back; files in the cache but no longer in the
 *  library are excluded from the result (stale rows stay in the DB —
 *  harmless, and a later parseAndCacheMapping resets everything).
 *  Returns null only when no mapping has ever been saved. */
export function getCachedPackMapping(fileNames: string[]): Record<string, string> | null {
  if (!hasPackMappings()) return null;
  const all = listPackMappings();
  const scoped: Record<string, string> = {};
  for (const fn of fileNames) {
    if (fn in all) {
      scoped[fn] = all[fn];
    } else {
      const fallback = stemOrBasename(fn);
      scoped[fn] = fallback;
      upsertPackMapping(fn, fallback);
    }
  }
  return scoped;
}

/** Merge multiple pack names into one. Every file currently assigned to
 *  any of `sourcePacks` gets reassigned to `targetName`. Persists the
 *  change and returns the updated mapping scoped to `fileNames`.
 *
 *  When no mapping exists yet, a baseline is built from the stem
 *  heuristic so manual merges work even without a prior AI import. */
export function mergePacks(sourcePacks: string[], targetName: string, fileNames: string[]): Record<string, string> {
  if (!hasPackMappings()) {
    const bootstrap: Record<string, string> = {};
    for (const fn of fileNames) bootstrap[fn] = stemOrBasename(fn);
    replacePackMappings(bootstrap);
  }
  renamePackMappings(sourcePacks, targetName);
  const all = listPackMappings();
  const scoped: Record<string, string> = {};
  for (const fn of fileNames) {
    if (fn in all) scoped[fn] = all[fn];
  }
  return scoped;
}
