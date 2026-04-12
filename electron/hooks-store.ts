// Persistent store for AI-generated encounter hooks.
//
// The map-tagger SQLite index is opened read-only, so dm-tool can't write
// regenerated hooks back into the sidecar JSON column. This module owns a
// small JSON file in `app.getPath("userData")` that maps a filename to a
// list of additional hooks. The renderer reads these merged into the
// MapDetail payload (see ipc.ts::getMapDetail) and appends to them when
// the user clicks the refresh button in the detail pane.
//
// Storage layout (one file for the whole library — small enough that we
// don't need a per-map file scheme; the user only ever regenerates a
// handful of maps):
//
//   {
//     "byFileName": {
//       "Alchemists_Lab_Day.jpg": {
//         "additionalHooks": ["…", "…", "…"],
//         "lastGeneratedAt": "2026-04-11T18:23:00.000Z"
//       }
//     }
//   }
//
// Reads/writes are synchronous since the file is tiny and writes only
// happen on explicit user action.

import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface HookOverrideEntry {
  additionalHooks: string[];
  lastGeneratedAt: string;
}

interface HookOverrideFile {
  byFileName: Record<string, HookOverrideEntry>;
}

function storePath(): string {
  return join(app.getPath('userData'), 'hook-overrides.json');
}

function readFile(): HookOverrideFile {
  const path = storePath();
  if (!existsSync(path)) return { byFileName: {} };
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HookOverrideFile>;
    if (!parsed || typeof parsed !== 'object' || !parsed.byFileName) {
      return { byFileName: {} };
    }
    return { byFileName: parsed.byFileName };
  } catch {
    // Corrupt file — start fresh rather than crash. The user can manually
    // recover from a backup if they care; the worst case is they re-roll
    // some hooks.
    return { byFileName: {} };
  }
}

function writeFile(data: HookOverrideFile): void {
  const path = storePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

/** Look up the additional hooks for one map. Returns an empty array if
 *  none have been generated yet. Newest first. */
export function getAdditionalHooks(fileName: string): string[] {
  const file = readFile();
  return file.byFileName[fileName]?.additionalHooks ?? [];
}

/** Prepend `newHooks` to the stored list for `fileName` and persist.
 *  Returns the new full list (newest first). */
export function appendAdditionalHooks(fileName: string, newHooks: string[]): string[] {
  const file = readFile();
  const existing = file.byFileName[fileName]?.additionalHooks ?? [];
  const merged = [...newHooks, ...existing];
  file.byFileName[fileName] = {
    additionalHooks: merged,
    lastGeneratedAt: new Date().toISOString(),
  };
  writeFile(file);
  return merged;
}
