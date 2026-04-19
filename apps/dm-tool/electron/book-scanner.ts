// Phase-1 scanner: walks the configured books root and returns a flat list
// of PDF file metadata rows. Cheap — file stat only, no PDF parsing. The
// caller hands the output to BookDb.reconcile to sync it with the catalog.
//
// Taxonomy rules (matching the user's PF2e folder layout):
//
//   <root>/Adventure Paths/<AP Name>/*.pdf  → cat="Adventure Paths", sub=<AP>
//   <root>/Adventures/*.pdf                  → cat="Adventures", sub=null
//   <root>/Adventures/<name>/*.pdf           → cat="Adventures", sub=<name>
//   <root>/Lost Omens/*.pdf                  → cat="Lost Omens", sub=null
//   <root>/Rulebooks/Legacy/*.pdf            → cat="Rulebooks", sub="Legacy", ruleset="legacy"
//   <root>/Rulebooks/Remastered/*.pdf        → cat="Rulebooks", sub="Remastered", ruleset="remastered"
//   <root>/Beginner Box/*.pdf                → cat="Beginner Box", sub=null
//
// Anything deeper than two nesting levels (e.g. Beginner Box/Pregens/*.pdf)
// is flattened: the first path segment after the root is always the
// category, and the second (if any) is the subcategory. Files more than
// two levels deep fall back to joining subsequent segments with " / " so
// we still pick them up rather than silently dropping them.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ScannedFile } from '@dm-tool/db/books';

export function scanBookRoot(rootPath: string): ScannedFile[] {
  if (!existsSync(rootPath)) return [];
  const out: ScannedFile[] = [];
  walk(rootPath, rootPath, out);
  return out;
}

function walk(rootPath: string, dir: string, out: ScannedFile[]): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Permission error or race with a deletion — skip this dir quietly.
    // The user will see it missing from the catalog and can investigate.
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rootPath, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.pdf')) continue;

    let stat: import('node:fs').Stats;
    try {
      stat = statSync(full);
    } catch {
      continue; // race with a deletion — skip
    }

    const rel = relative(rootPath, full);
    const parts = rel.split(sep);
    if (parts.length === 0) continue;
    const { category, subcategory, ruleset } = classifyPath(parts);

    out.push({
      path: full,
      title: normalizeTitle(entry.name),
      category,
      subcategory,
      ruleset,
      fileSize: stat.size,
      // better-sqlite3 stores integers up to 2^63, so ms is fine here and
      // gives us more resolution than seconds for mtime comparisons.
      mtime: stat.mtimeMs,
    });
  }
}

/** Derive category/subcategory/ruleset from the relative path segments.
 *  Exported for unit-testability if we ever add tests. */
export function classifyPath(parts: string[]): {
  category: string;
  subcategory: string | null;
  ruleset: 'legacy' | 'remastered' | null;
} {
  // parts[0] is always the category. parts[last] is the filename.
  // Intermediate segments (if any) form the subcategory path.
  const category = parts[0] ?? 'Uncategorized';
  const intermediate = parts.slice(1, -1);

  let ruleset: 'legacy' | 'remastered' | null = null;
  if (category === 'Rulebooks' && intermediate.length > 0) {
    const first = intermediate[0]?.toLowerCase();
    if (first === 'legacy') ruleset = 'legacy';
    else if (first === 'remastered') ruleset = 'remastered';
  }

  // Only the first subfolder matters for taxonomy. Deeper nesting (e.g.
  // "Adventure Paths/Abomination Vaults/3rd party/") is just folder
  // organization — the subcategory should still be "Abomination Vaults",
  // not "Abomination Vaults / 3rd party".
  const subcategory = intermediate.length === 0 ? null : intermediate[0]!;

  return { category, subcategory, ruleset };
}

/** Strip the `.pdf` extension and Pathfinder branding prefixes, and
 *  normalize `_` — which Paizo's filename convention uses as a stand-in
 *  for apostrophes (`Player_s Guide`) and ampersands (`Guns _ Gears`).
 *
 *  Exported so we can reuse the same logic in the reader title bar. */
export function normalizeTitle(fileName: string): string {
  let s = fileName;
  // Strip .pdf (case-insensitive).
  if (s.toLowerCase().endsWith('.pdf')) s = s.slice(0, -4);

  // Replace ` _ ` (surrounded by spaces) with ` & ` — matches
  // "Guns _ Gears" and "Gods _ Magic".
  s = s.replace(/ _ /g, ' & ');
  // Replace `_s` (word boundary) with `'s` — matches "Player_s Guide".
  s = s.replace(/([A-Za-z])_s\b/g, "$1's");
  // Any remaining `_` becomes a space — defensive default.
  s = s.replace(/_/g, ' ');

  // Strip leading "Pathfinder 2e - " or "Pathfinder " branding so the
  // catalog doesn't show "Pathfinder" on every card. Keep "Pathfinder"
  // only if the whole title collapses to empty after stripping.
  const stripped = s.replace(/^Pathfinder 2e\s*[-–]\s*/i, '').replace(/^Pathfinder\s+/i, '');
  if (stripped.trim().length > 0) s = stripped;

  return s.trim();
}
