// AI-driven pack grouping for battlemap variants.
//
// Instead of fragile filename-stemming heuristics, the user sends all
// filenames to Claude and gets back a JSON mapping of filename → pack
// name. This module handles prompt generation, import/validation of the
// response, and caching the result in `<userData>/pack-mapping.json`.
//
// The user handles the actual API interaction outside the app (paste the
// prompt into claude.ai, get the JSON back, import it). This sidesteps
// token limits, timeouts, and API key management for a one-time operation.

import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface PackMappingCache {
  /** SHA-256 of the sorted, newline-joined filename list. When this
   *  changes the cache is stale and the user should re-export + re-import. */
  fileListHash: string;
  /** fileName → packName. Every filename in the library has an entry. */
  mapping: Record<string, string>;
}

function cachePath(): string {
  return join(app.getPath("userData"), "pack-mapping.json");
}

function readCache(): PackMappingCache | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PackMappingCache>;
    if (
      !parsed ||
      typeof parsed.fileListHash !== "string" ||
      !parsed.mapping ||
      typeof parsed.mapping !== "object"
    ) {
      return null;
    }
    return parsed as PackMappingCache;
  } catch {
    return null;
  }
}

function writeCache(data: PackMappingCache): void {
  const path = cachePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

function hashFileList(fileNames: string[]): string {
  const sorted = [...fileNames].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildGroupingPrompt(fileNames: string[]): string {
  const list = fileNames.map((f) => `  "${f}"`).join("\n");
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
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Import / parse
// ---------------------------------------------------------------------------

/** Parse and validate a JSON mapping from user-provided text (e.g. copied
 *  from Claude's response). Strips code fences if present. Fills in
 *  missing filenames as singletons. */
export function parseAndCacheMapping(
  rawText: string,
  fileNames: string[],
): Record<string, string> {
  let text = rawText.trim();
  // Strip code fences if present ([\s\S] spans newlines).
  const fenceMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Invalid JSON: ${(e as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Expected a JSON object, got ${typeof parsed}`,
    );
  }

  const mapping = parsed as Record<string, string>;

  // Validate: every filename must have a string pack name. Fill in any
  // missing ones as singletons.
  const result: Record<string, string> = {};
  for (const fn of fileNames) {
    const pack = mapping[fn];
    if (typeof pack === "string" && pack.trim().length > 0) {
      result[fn] = pack.trim();
    } else {
      result[fn] = fn.replace(/\.[a-zA-Z0-9]+$/, "");
    }
  }

  const cache: PackMappingCache = {
    fileListHash: hashFileList(fileNames),
    mapping: result,
  };
  writeCache(cache);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return the cached pack mapping if it exists and is up-to-date with
 *  the given file list. Returns null if an import is needed. */
export function getCachedPackMapping(
  fileNames: string[],
): Record<string, string> | null {
  const cache = readCache();
  if (!cache) return null;
  const currentHash = hashFileList(fileNames);
  if (cache.fileListHash !== currentHash) return null;
  return cache.mapping;
}

/** Merge multiple pack names into one. Every file currently assigned to
 *  any of `sourcePacks` gets reassigned to `targetName`. Persists the
 *  change to the cache file and returns the updated mapping. */
export function mergePacks(
  sourcePacks: string[],
  targetName: string,
): Record<string, string> | null {
  const cache = readCache();
  if (!cache) return null;
  const sourceSet = new Set(sourcePacks);
  for (const [fileName, pack] of Object.entries(cache.mapping)) {
    if (sourceSet.has(pack)) {
      cache.mapping[fileName] = targetName;
    }
  }
  writeCache(cache);
  return cache.mapping;
}
