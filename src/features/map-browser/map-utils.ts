// Pure utility functions for map variant matching and grid deduplication.
// Extracted from DetailPane so they can be tested independently.

import type { MapSummary } from '@shared/types';

const GRID_TOKENS_TO_STRIP = new Set(['grid', 'gridded', 'gridless', 'gridlines', 'gl', 'g']);

export function tokenizeForMatch(fileName: string): Set<string> {
  const noExt = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
  const tokens = noExt.toLowerCase().split(/[_\-\s]+/);
  return new Set(tokens.filter((t) => t.length > 0 && !GRID_TOKENS_TO_STRIP.has(t)));
}

// Find the "same map but with the opposite grid state" inside a pack.
// Returns null when:
//   - we have no current detail or no variant set
//   - the current map is neither gridded nor gridless (e.g. unknown)
//   - no pack member has the opposite gridVisible value
//
// When multiple counterparts exist (e.g. a pack has Day_Grid and
// Night_Gridless siblings) we score by filename token overlap so the
// flip lands on the closest match. Tokens are normalized to lowercase
// and grid-related tokens are stripped before comparison so they don't
// dominate the score.
export function findGridCounterpart(
  detail: { fileName: string; gridVisible: MapSummary['gridVisible'] } | null,
  variants: MapSummary[] | null,
): MapSummary | null {
  if (!detail || !variants || variants.length < 2) return null;
  if (detail.gridVisible !== 'gridded' && detail.gridVisible !== 'gridless') {
    return null;
  }
  const target = detail.gridVisible === 'gridded' ? 'gridless' : 'gridded';
  const candidates = variants.filter((v) => v.gridVisible === target);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const currentTokens = tokenizeForMatch(detail.fileName);
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const cTokens = tokenizeForMatch(c.fileName);
    let score = 0;
    for (const t of cTokens) if (currentTokens.has(t)) score += 1;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

// Cluster key for the variant-column dedup: token set with grid words
// stripped, sorted and joined. Two filenames produce the same key iff
// they describe the same underlying map and differ only in grid state.
function clusterKey(fileName: string): string {
  return Array.from(tokenizeForMatch(fileName)).sort().join('|');
}

// Collapse gridded/gridless pairs in a variant list down to one entry
// per underlying map. The active file is always pinned as its own
// cluster's representative so the highlight in VariantColumn stays
// accurate after the user flips the grid toggle. For inactive clusters
// we prefer a member matching `preferredGrid` (the active map's grid
// state, so the column's thumbnails stay visually consistent), then
// fall back to gridded, then to the first member.
export function dedupGridVariants(
  variants: MapSummary[] | null,
  activeFileName: string | null,
  preferredGrid: MapSummary['gridVisible'],
): MapSummary[] | null {
  if (!variants) return null;

  const clusters = new Map<string, MapSummary[]>();
  for (const v of variants) {
    const k = clusterKey(v.fileName);
    let bucket = clusters.get(k);
    if (!bucket) {
      bucket = [];
      clusters.set(k, bucket);
    }
    bucket.push(v);
  }

  const activeKey = activeFileName ? clusterKey(activeFileName) : null;
  const seen = new Set<string>();
  const out: MapSummary[] = [];
  for (const v of variants) {
    const k = clusterKey(v.fileName);
    if (seen.has(k)) continue;
    seen.add(k);
    const bucket = clusters.get(k)!;
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }
    // Active cluster: ALWAYS pin the active file as the representative.
    if (k === activeKey && activeFileName) {
      const active = bucket.find((b) => b.fileName === activeFileName);
      if (active) {
        out.push(active);
        continue;
      }
    }
    // Inactive cluster: prefer the member matching the active map's
    // grid state, then gridded, then whatever's first.
    const matchPreferred = bucket.find((b) => b.gridVisible === preferredGrid);
    if (matchPreferred) {
      out.push(matchPreferred);
      continue;
    }
    const gridded = bucket.find((b) => b.gridVisible === 'gridded');
    out.push(gridded ?? bucket[0]);
  }
  return out;
}
