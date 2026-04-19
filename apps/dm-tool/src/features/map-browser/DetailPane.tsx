import { useEffect, useMemo, useState } from 'react';
import { Box, ExternalLink, Globe, Grid3x3, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/lib/api';
import { cn, mapFileUrl, thumbnailUrl } from '@/lib/utils';
import type { MapSummary } from '@dm-tool/shared/types';
import { useMapDetail, useOpenInExplorer } from './useMaps';
import { findGridCounterpart, dedupGridVariants } from './map-utils';
import { EncounterHooksSection } from './EncounterHooksSection';
import { AutoWallPanel } from './AutoWallPanel';

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

  // Wall overlay state — kept here because the SVG overlay renders
  // inside the image container, not inside AutoWallPanel.
  const [hasUvtt, setHasUvtt] = useState(false);
  const [showWalls, setShowWalls] = useState(false);
  const [wallData, setWallData] = useState<{
    walls: number[][];
    width: number;
    height: number;
  } | null>(null);

  // Push-to-Foundry state. The button lives on the image overlay so it's
  // reachable from any map, regardless of whether .uvtt walls exist.
  const [foundryAvailable, setFoundryAvailable] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{
    sceneName: string;
    wallsCreated: number;
    doorsCreated: number;
  } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => setFoundryAvailable(!!c.foundryMcpUrl));
  }, []);

  useEffect(() => {
    setShowWalls(false);
    setWallData(null);
    setPushResult(null);
    setPushError(null);
    if (fileName) {
      api.autoWallHasUvtt(fileName).then(setHasUvtt);
    } else {
      setHasUvtt(false);
    }
  }, [fileName]);

  const handlePushScene = async () => {
    if (!fileName || pushing) return;
    setPushing(true);
    setPushResult(null);
    setPushError(null);
    try {
      const result = await api.pushToFoundry(fileName);
      setPushResult(result);
    } catch (e) {
      setPushError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

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
  // inside the same pack, if one exists.
  const gridCounterpart = useMemo(() => findGridCounterpart(detail, variants ?? null), [detail, variants]);

  // Collapse gridded/gridless pairs to a single entry in the variant column.
  const dedupedVariants = useMemo(
    () => dedupGridVariants(variants ?? null, fileName, detail?.gridVisible ?? null),
    [variants, fileName, detail?.gridVisible],
  );

  if (!fileName) return null;

  const hasVariantPanel = dedupedVariants !== null && dedupedVariants.length > 1 && !!onSelectVariant;

  return (
    <div className="flex h-full w-full min-w-0 flex-col border-l border-border bg-card">
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
              <div className="relative overflow-hidden rounded-md border border-border bg-muted">
                <img
                  src={mapFileUrl(detail.fileName)}
                  alt={detail.title}
                  className="mx-auto h-auto max-h-[70vh] w-full object-contain"
                />
                {/* Grid / no-grid toggle */}
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
                {/* SVG wall overlay */}
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
                <div className="flex items-center gap-1.5" style={{ position: 'absolute', right: 8, bottom: 8 }}>
                  {foundryAvailable && (
                    <button
                      type="button"
                      onClick={handlePushScene}
                      disabled={pushing}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium text-white shadow-xs transition-colors',
                        pushing ? 'bg-primary/60' : 'bg-primary/85 hover:bg-primary',
                      )}
                      title={hasUvtt ? 'Create scene in Foundry with walls' : 'Create scene in Foundry'}
                    >
                      {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                      {pushing ? 'Creating…' : 'Create scene'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openInExplorer(detail.fileName)}
                    className="flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white shadow-xs transition-colors hover:bg-black/85"
                    title="Show in folder"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Show in folder
                  </button>
                </div>
              </div>
              {(pushResult || pushError) && (
                <div className="-mt-2 text-xs">
                  {pushResult && (
                    <span className="text-green-400">
                      Created &quot;{pushResult.sceneName}&quot; in Foundry
                      {pushResult.wallsCreated > 0 &&
                        ` — ${pushResult.wallsCreated} walls${
                          pushResult.doorsCreated > 0 ? `, ${pushResult.doorsCreated} doors` : ''
                        }`}
                    </span>
                  )}
                  {pushError && <span className="text-destructive">Push failed: {pushError}</span>}
                </div>
              )}

              <AutoWallPanel
                fileName={fileName}
                hasUvtt={hasUvtt}
                onUvttImported={(data) => {
                  setHasUvtt(true);
                  setWallData(data);
                  setShowWalls(true);
                }}
              />

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

        {/* Variant column */}
        {detail && hasVariantPanel && (
          <VariantColumn variants={dedupedVariants!} selected={fileName} onSelect={onSelectVariant!} />
        )}
      </div>
    </div>
  );
}

// Right-side variant column — fixed-width sidebar of full-width thumbs
// stacked vertically.
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
