// Persistent store for AI-generated encounter hooks.
//
// The map-tagger SQLite index is opened read-only, so dm-tool can't write
// regenerated hooks back into the sidecar JSON column. The hook_overrides
// table in pf2e.db holds the overlay: one row per filename with a JSON
// array of additional hooks (newest-first) and a timestamp.
//
// Reads/writes are synchronous since the operation is tiny and only
// happens on explicit user action.

import { getAdditionalHooksFor, upsertAdditionalHooks } from '@dm-tool/db/pf2e';

/** Look up the additional hooks for one map. Returns an empty array if
 *  none have been generated yet. Newest first. */
export function getAdditionalHooks(fileName: string): string[] {
  return getAdditionalHooksFor(fileName);
}

/** Prepend `newHooks` to the stored list for `fileName` and persist.
 *  Returns the new full list (newest first). */
export function appendAdditionalHooks(fileName: string, newHooks: string[]): string[] {
  const merged = [...newHooks, ...getAdditionalHooksFor(fileName)];
  upsertAdditionalHooks(fileName, merged);
  return merged;
}
