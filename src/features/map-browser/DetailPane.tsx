import { useEffect, useMemo, useState } from 'react';
import { Box, ExternalLink, Grid3x3, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { cn, mapFileUrl, thumbnailUrl } from '@/lib/utils';
import type { MapSummary } from '@shared/types';
import { useMapDetail, useOpenInExplorer } from './useMaps';

interface DetailPaneProps {
  fileName: string | null;
  /** All variants in the same pack as `fileName`. When provided and the
   *  pack has more than one member, we render a dedicated variant panel
   *  on the right so sibling maps can be browsed without closing the
   *  pane. */
  variants?: MapSummary[] | null;
  onSelectVariant?: (fileName: string) => void;
  onClose: () => void;
  /** Anthropic API key from Settings. Required for the encounter-hook
   *  refresh button. Empty string disables the button (with a tooltip
   *  pointing the user back to settings). */
  anthropicApiKey?: string;
}

export function DetailPane({ fileName, variants, onSelectVariant, onClose, anthropicApiKey = '' }: DetailPaneProps) {
  const { data: detail, loading, error } = useMapDetail(fileName);
  const openInExplorer = useOpenInExplorer();

  // Local copy of the additional (AI-generated) hooks. We mirror the
  // value from detail when it loads so we can later swap it out in one
  // assignment after a regenerate, without re-fetching the whole detail
  // object. Reset whenever the user navigates to a different map.
  const [additionalHooks, setAdditionalHooks] = useState<string[]>([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Auto-Wall state
  const [autoWallAvailable, setAutoWallAvailable] = useState(false);
  const [hasUvtt, setHasUvtt] = useState(false);
  const [showWalls, setShowWalls] = useState(false);
  const [wallData, setWallData] = useState<{
    walls: number[][];
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    api.autoWallAvailable().then(setAutoWallAvailable);
  }, []);

  useEffect(() => {
    setShowWalls(false);
    setWallData(null);
    if (fileName) {
      api.autoWallHasUvtt(fileName).then(setHasUvtt);
    } else {
      setHasUvtt(false);
    }
  }, [fileName]);

  useEffect(() => {
    setAdditionalHooks(detail?.additionalEncounterHooks ?? []);
    setRegenError(null);
  }, [detail]);

  const handleRegenerate = async () => {
    if (!fileName || regenLoading) return;
    if (!anthropicApiKey) {
      setRegenError('Add an Anthropic API key in Settings first.');
      return;
    }
    setRegenLoading(true);
    setRegenError(null);
    try {
      const next = await api.regenerateEncounterHooks({
        fileName,
        apiKey: anthropicApiKey,
      });
      setAdditionalHooks(next);
    } catch (e) {
      setRegenError((e as Error).message);
    } finally {
      setRegenLoading(false);
    }
  };

  // Find the grid/gridless counterpart of the currently-displayed map
  // inside the same pack, if one exists. The toggle button on the image
  // overlay shows when this is non-null. Recomputed any time the variant
  // set or the loaded detail changes.
  const gridCounterpart = useMemo(() => findGridCounterpart(detail, variants ?? null), [detail, variants]);

  // Collapse gridded/gridless pairs to a single entry in the variant
  // column. The grid toggle on the image overlay handles flipping
  // within a cluster, so showing both halves of every pair is just
  // visual noise. The active map is always pinned as the representative
  // of its own cluster so the highlight stays accurate after a flip.
  const dedupedVariants = useMemo(
    () => dedupGridVariants(variants ?? null, fileName, detail?.gridVisible ?? null),
    [variants, fileName, detail?.gridVisible],
  );

  if (!fileName) return null;

  const hasVariantPanel = dedupedVariants !== null && dedupedVariants.length > 1 && !!onSelectVariant;

  return (
    <div className="flex h-full w-full min-w-0 flex-col border-l border-border bg-card">
      {/* Header now carries the map identity (title + filename + dims)
          instead of a generic "Details" label. The whole row is one
          baseline-aligned flex with the title shrink-0 (never truncates)
          and the filename truncating in the middle. Falls back to a
          spinner / placeholder while detail is loading. */}
      <div className="flex h-12 items-center justify-between gap-3 border-b border-border px-3">
        {detail ? (
          <div className="flex min-w-0 flex-1 items-baseline gap-3">
            <h2 className="shrink-0 text-base font-semibold leading-tight">{detail.title}</h2>
            <p
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
              title={detail.fileName}
            >
              {detail.fileName}
            </p>
          </div>
        ) : (
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {loading ? 'Loading…' : 'Details'}
          </span>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <ScrollArea className="min-w-0 flex-1">
          {loading && <div className="p-4 text-xs text-muted-foreground">Loading…</div>}
          {error && <div className="p-4 text-xs text-destructive">Error: {error}</div>}
          {detail && (
            <div className="space-y-4 p-4">
              {/* The image gets whatever width the detail pane has
                  (which is large now that the grid rail is narrow).
                  object-contain on a max-height keeps very tall maps
                  from pushing the metadata offscreen. Dimensions sit
                  in a small chip at the bottom-left, anchored to the
                  image container (which is `relative`). Inline style
                  for the chip's positioning so it doesn't depend on
                  Tailwind utilities that might not be in the JIT
                  bundle. */}
              <div className="relative overflow-hidden rounded-md border border-border bg-muted">
                <img
                  src={mapFileUrl(detail.fileName)}
                  alt={detail.title}
                  className="mx-auto h-auto max-h-[70vh] w-full object-contain"
                />
                {/* Grid / no-grid toggle. Only renders when the current
                    map's pack contains a counterpart with the opposite
                    gridVisible value — i.e. it's safe to flip without
                    leaving the pack. The button reflects the CURRENT
                    state (Grid icon = currently gridded). Anchored
                    top-left so it stays clear of the bottom-row chips. */}
                {gridCounterpart && onSelectVariant && (
                  <button
                    type="button"
                    onClick={() => onSelectVariant(gridCounterpart.fileName)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium text-white shadow-xs transition-colors',
                      detail.gridVisible === 'gridded'
                        ? 'bg-primary/85 hover:bg-primary'
                        : 'bg-black/70 hover:bg-black/85',
                    )}
                    style={{ position: 'absolute', left: 8, top: 8 }}
                    title={
                      detail.gridVisible === 'gridded' ? 'Switch to gridless variant' : 'Switch to gridded variant'
                    }
                  >
                    <Grid3x3 className="h-3 w-3" />
                    {detail.gridVisible === 'gridded' ? 'Grid' : 'No grid'}
                  </button>
                )}
                {/* Walls overlay toggle — shown when a .uvtt exists */}
                {hasUvtt && (
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !showWalls;
                      setShowWalls(next);
                      if (next && !wallData && fileName) {
                        const data = await api.autoWallGetWalls(fileName);
                        setWallData(data);
                      }
                    }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium text-white shadow-xs transition-colors',
                      showWalls ? 'bg-primary/85 hover:bg-primary' : 'bg-black/70 hover:bg-black/85',
                    )}
                    style={{
                      position: 'absolute',
                      left: 8,
                      top: gridCounterpart && onSelectVariant ? 36 : 8,
                    }}
                    title={showWalls ? 'Hide wall overlay' : 'Show wall overlay'}
                  >
                    <Box className="h-3 w-3" />
                    Walls
                  </button>
                )}
                {/* SVG wall overlay — scales to match the object-contain image */}
                {showWalls && wallData && (
                  <svg
                    className="pointer-events-none"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                    }}
                    viewBox={`0 0 ${wallData.width} ${wallData.height}`}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {wallData.walls.map((seg, i) => (
                      <line
                        key={i}
                        x1={seg[0]}
                        y1={seg[1]}
                        x2={seg[2]}
                        y2={seg[3]}
                        stroke="#00ffff"
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                    ))}
                  </svg>
                )}
                <div
                  className="rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white shadow-xs"
                  style={{ position: 'absolute', left: 8, bottom: 8 }}
                >
                  {detail.widthPx}×{detail.heightPx}
                </div>
                <button
                  type="button"
                  onClick={() => openInExplorer(detail.fileName)}
                  className="flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white shadow-xs transition-colors hover:bg-black/85"
                  style={{ position: 'absolute', right: 8, bottom: 8 }}
                  title="Show in folder"
                >
                  <ExternalLink className="h-3 w-3" />
                  Show in folder
                </button>
              </div>

              {/* Auto-Wall actions */}
              {autoWallAvailable && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Walls</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!fileName) return;
                          api.autoWallLaunch(fileName);
                        }}
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Open in Auto-Wall
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          if (!fileName) return;
                          const imported = await api.autoWallImportUvtt(fileName);
                          if (imported) {
                            setHasUvtt(true);
                            const data = await api.autoWallGetWalls(fileName);
                            setWallData(data);
                            setShowWalls(true);
                          }
                        }}
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        Import .uvtt
                      </Button>
                      {hasUvtt && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                          .uvtt
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}

              <EncounterHooksSection
                baseHooks={detail.encounterHooks}
                additionalHooks={additionalHooks}
                onRegenerate={handleRegenerate}
                regenLoading={regenLoading}
                regenError={regenError}
                hasApiKey={!!anthropicApiKey}
              />
            </div>
          )}
        </ScrollArea>

        {/* Variant column lives as a sibling of the main scroll area so
            it pins to the right edge and scrolls independently of the
            map details. Single column of full-width thumbs, fixed
            sidebar width. */}
        {detail && hasVariantPanel && (
          <VariantColumn variants={dedupedVariants!} selected={fileName} onSelect={onSelectVariant!} />
        )}
      </div>
    </div>
  );
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
const GRID_TOKENS_TO_STRIP = new Set(['grid', 'gridded', 'gridless', 'gridlines', 'gl', 'g']);

function tokenizeForMatch(fileName: string): Set<string> {
  const noExt = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
  const tokens = noExt.toLowerCase().split(/[_\-\s]+/);
  return new Set(tokens.filter((t) => t.length > 0 && !GRID_TOKENS_TO_STRIP.has(t)));
}

function findGridCounterpart(
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
function dedupGridVariants(
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

// Right-side variant column — fixed-width sidebar of full-width thumbs
// stacked vertically. Lives as a sibling of the main detail ScrollArea
// so it scrolls independently. Inline styles for sizing throughout
// because of the Tailwind JIT quirk in this project.
const VARIANT_COL_WIDTH = 168;
const VARIANT_THUMB_GAP = 8;
const VARIANT_THUMB_ASPECT = '4 / 3';

function VariantColumn({
  variants,
  selected,
  onSelect,
}: {
  variants: MapSummary[];
  selected: string | null;
  onSelect: (fileName: string) => void;
}) {
  return (
    <div
      className="flex shrink-0 flex-col border-l border-border bg-background/40"
      style={{ width: VARIANT_COL_WIDTH }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">In pack</div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {variants.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col p-2" style={{ gap: VARIANT_THUMB_GAP }}>
          {variants.map((v) => (
            <VariantThumb
              key={v.fileName}
              variant={v}
              isSelected={v.fileName === selected}
              onClick={() => onSelect(v.fileName)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// Encounter hooks panel. Renders the additional (AI-generated) hooks at
// the top of the list and the base sidecar hooks below, separated by a
// faint divider when both are present. The list itself scrolls inside a
// max-height container so the regenerate button stays in view as the
// list grows. Inline styles for max-height because the JIT pipeline in
// this project sometimes drops freshly-introduced max-h utilities.
function EncounterHooksSection({
  baseHooks,
  additionalHooks,
  onRegenerate,
  regenLoading,
  regenError,
  hasApiKey,
}: {
  baseHooks: string[];
  additionalHooks: string[];
  onRegenerate: () => void;
  regenLoading: boolean;
  regenError: string | null;
  hasApiKey: boolean;
}) {
  const hasAny = baseHooks.length > 0 || additionalHooks.length > 0;

  return (
    <>
      <Separator />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Encounter hooks</h3>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenLoading}
            title={
              hasApiKey
                ? 'Generate 3 new encounter hooks via Claude'
                : 'Add an Anthropic API key in Settings to use this'
            }
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              regenLoading && 'cursor-not-allowed opacity-60',
            )}
          >
            {regenLoading ? (
              <Loader2 className="h-3.5 w-3.5" style={{ animation: 'dmtool-spin 1s linear infinite' }} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        {regenError && <p className="mb-2 text-[11px] leading-snug text-destructive">{regenError}</p>}
        {!hasAny && !regenLoading && (
          <p className="text-xs text-muted-foreground">
            No encounter hooks yet. Click the refresh icon to generate some.
          </p>
        )}
        {hasAny && (
          <div className="overflow-y-auto pr-1" style={{ maxHeight: 280 }}>
            <ul className="space-y-1.5 text-sm text-foreground/90">
              {additionalHooks.map((h, i) => (
                <HookListItem key={`add-${i}`} text={h} accent />
              ))}
              {additionalHooks.length > 0 && baseHooks.length > 0 && (
                <li
                  aria-hidden
                  style={{
                    height: 1,
                    background: 'hsl(var(--border))',
                    margin: '6px 0',
                  }}
                />
              )}
              {baseHooks.map((h, i) => (
                <HookListItem key={`base-${i}`} text={h} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

// Single bullet row. The bullet vertical-alignment trick (inline-flex
// wrapper sized to leading-snug line-height) survives the JIT quirk
// because the height is hard-coded in em units. The `accent` flag
// brightens the bullet for AI-generated hooks so the user can tell at a
// glance which ones are fresh.
function HookListItem({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <li className="flex gap-2 leading-snug">
      <span
        className="shrink-0"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: '1.375em',
        }}
      >
        <span
          className={accent ? 'rounded-full bg-primary' : 'rounded-full bg-primary/60'}
          style={{ width: 4, height: 4 }}
        />
      </span>
      <span>{text}</span>
    </li>
  );
}

function VariantThumb({
  variant,
  isSelected,
  onClick,
}: {
  variant: MapSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={variant.fileName}
      className={cn(
        'relative overflow-hidden rounded border border-border bg-muted transition-all hover:border-primary/60',
        isSelected && 'border-primary ring-2 ring-primary/40',
      )}
      style={{ width: '100%', aspectRatio: VARIANT_THUMB_ASPECT }}
    >
      <img
        src={thumbnailUrl(variant.fileName)}
        alt={variant.title}
        loading="lazy"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </button>
  );
}
