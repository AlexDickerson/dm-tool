import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Check, Info, Layers, Merge, Plus, Rows, X } from 'lucide-react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { DetailOverlay } from '@/components/FloatingPanel';
import { FilterPanel } from './FilterPanel';
import { ThumbnailGrid, type ThumbnailItem } from './ThumbnailGrid';
import { DetailPane } from './DetailPane';
import { TaggerDialog } from './TaggerDialog';
import { useFacets, useMapSearch, usePackMapping } from './useMaps';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MapSummary, SearchParams } from '@shared/types';
import { groupByStem } from '@shared/map-stem';

interface MapBrowserProps {
  /** Multiplier for the thumbnail card width/height. Owned by App.tsx
   *  so the settings dialog can change it without MapBrowser knowing
   *  about persistence. Defaults to 1 (the original tuned size). */
  thumbScale?: number;
  /** Anthropic API key from Settings. Passed through to DetailPane so
   *  the encounter-hook regenerate button can use it. Empty string means
   *  not configured — the button will surface a friendly error. */
  anthropicApiKey?: string;
  /** Bumped by App when pack mapping is imported via Settings, so we
   *  know to re-fetch the cached mapping. */
  packMappingVersion?: number;
  /** Search keywords from the shared header search bar. */
  keywords?: string;
}

// Top-level state for the browser. All mutable state lives here so the
// FilterPanel, ThumbnailGrid and DetailPane stay presentational.
export function MapBrowser({
  thumbScale = 1,
  anthropicApiKey = '',
  packMappingVersion = 0,
  keywords = '',
}: MapBrowserProps) {
  const [filters, setFilters] = useState<SearchParams>({});
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  // Default to grouped view — the whole reason we added stemming is that
  // browsing a flat list of 1000+ variants is miserable. The user can
  // flip this off to see the raw search results.
  const [grouped, setGrouped] = useState(true);
  // When a grouped card is clicked we remember the whole variant set so
  // the DetailPane can render a thumbnail strip for switching between
  // siblings without reloading or re-querying.
  const [activeVariants, setActiveVariants] = useState<MapSummary[] | null>(null);

  // Compose the effective search params. useMemo keeps the reference
  // stable when neither keywords nor filters changed, so useMapSearch's
  // effect doesn't refire on every render.
  const searchParams = useMemo<SearchParams>(
    () => ({
      ...filters,
      keywords: keywords.trim() || undefined,
      limit: 10000,
    }),
    [filters, keywords],
  );

  const { data: maps, loading, error, refresh: refreshMaps } = useMapSearch(searchParams);
  const { data: facets } = useFacets();

  // Tagger dialog state. Hide the Add Maps UI entirely when the binary
  // isn't configured — the rest of the browser still works against the
  // pre-tagged library.
  const [taggerOpen, setTaggerOpen] = useState(false);
  const [taggerAvailable, setTaggerAvailable] = useState(false);
  useEffect(() => {
    api.taggerAvailable().then(setTaggerAvailable);
  }, []);
  const handleIngestComplete = useCallback(() => {
    refreshMaps();
  }, [refreshMaps]);

  const packMapping = usePackMapping(packMappingVersion);

  // Group maps using the AI mapping when available, falling back to
  // the filename-stemming heuristic when it's not.
  const groupMaps = useMemo(() => {
    const mapping = packMapping.mapping;
    if (!mapping) return groupByStem;
    return <T extends { fileName: string }>(rows: readonly T[]) => {
      return groupByMapping(rows, mapping);
    };
  }, [packMapping.mapping]);

  // Build the flat list of thumbnail items. When grouping is on, we
  // collapse into one item per pack; when off, each map is its own
  // item (variantCount = 1 so no badge renders).
  const { items, groupCount } = useMemo(() => {
    const rows = maps ?? [];
    if (!grouped) {
      return {
        items: rows.map((m) => ({ map: m, variantCount: 1 }) satisfies ThumbnailItem),
        groupCount: rows.length,
      };
    }
    const groups = groupMaps(rows);
    const items: ThumbnailItem[] = groups.map((g) => ({
      map: g.representative,
      variantCount: g.variants.length,
    }));
    return { items, groupCount: groups.length };
  }, [maps, grouped, groupMaps]);

  // Look up the variant set for a given fileName, regardless of whether
  // we're in grouped or flat view. We always want variants in the detail
  // pane so the grid-toggle (and any other per-pack UI) can work even
  // when the user is browsing flat.
  const handleSelect = (item: ThumbnailItem) => {
    if (item.map.fileName === selectedFileName) {
      closeDetail();
      return;
    }
    setDetailClosing(false);
    setSelectedFileName(item.map.fileName);
    if (!maps) {
      setActiveVariants(null);
      return;
    }
    const groups = groupMaps(maps);
    const g = groups.find((g) => g.variants.some((v) => v.fileName === item.map.fileName));
    setActiveVariants(g?.variants ?? null);
  };

  // Called by DetailPane when the user clicks a sibling in the variant
  // strip. Updates the selected filename without changing the active
  // variant set, so the strip stays visible with the new selection
  // highlighted.
  const handleSelectVariant = (fileName: string) => {
    setSelectedFileName(fileName);
  };

  const [detailClosing, setDetailClosing] = useState(false);

  const closeDetail = useCallback(() => setDetailClosing(true), []);
  const handleDetailClosed = useCallback(() => {
    setSelectedFileName(null);
    setActiveVariants(null);
    setDetailClosing(false);
  }, []);

  // Merge mode: multi-select packs to merge them into one.
  const [mergeMode, setMergeMode] = useState(false);
  // Map from representative fileName → pack stem name (for display and IPC).
  const [mergeSelected, setMergeSelected] = useState<Map<string, string>>(new Map());

  const toggleMergeMode = useCallback(() => {
    setMergeMode((m) => {
      if (m) setMergeSelected(new Map());
      return !m;
    });
  }, []);

  const handleMergeSelect = useCallback(
    (item: ThumbnailItem) => {
      if (!maps) return;
      // Find the pack stem for this item.
      const groups = groupMaps(maps);
      const g = groups.find((g) => g.variants.some((v) => v.fileName === item.map.fileName));
      if (!g) return;
      setMergeSelected((prev) => {
        const next = new Map(prev);
        if (next.has(item.map.fileName)) {
          next.delete(item.map.fileName);
        } else {
          next.set(item.map.fileName, g.stem);
        }
        return next;
      });
    },
    [maps, groupMaps],
  );

  const [mergeNameInput, setMergeNameInput] = useState('');
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);

  const startMerge = useCallback(() => {
    // Default the name to the first selected pack's stem.
    const first = mergeSelected.values().next().value;
    setMergeNameInput(first ?? '');
    setShowMergeConfirm(true);
  }, [mergeSelected]);

  const confirmMerge = useCallback(async () => {
    const name = mergeNameInput.trim();
    if (!name) return;
    const sourcePacks = Array.from(mergeSelected.values());
    await packMapping.merge(sourcePacks, name);
    setShowMergeConfirm(false);
    setMergeSelected(new Map());
    setMergeMode(false);
  }, [mergeNameInput, mergeSelected, packMapping]);

  // Set of representative fileNames for the ThumbnailGrid highlight.
  const mergeSelectedFileNames = useMemo(() => new Set(mergeSelected.keys()), [mergeSelected]);

  // When a map is selected, both the grid and the detail pane share
  // the remaining horizontal space, but weighted so the detail area
  // gets ~2× the grid. The grid keeps enough width to show 2+ columns
  // of thumbnails on a normal window, and the detail pane has room for
  // a large image plus the variant panel.
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Left: filter sidebar */}
        <ResizableSidebar storageKey="dmtool.sidebar.maps">
          <FilterPanel facets={facets} params={filters} onChange={setFilters} />
        </ResizableSidebar>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setGrouped((g) => !g)}
              className={cn('gap-1.5 whitespace-nowrap', grouped && 'border-primary/60 bg-primary/10 text-primary')}
              title={
                grouped
                  ? 'Showing one card per pack. Click to flatten.'
                  : 'Showing every map individually. Click to group variants by pack.'
              }
            >
              {grouped ? <Layers className="h-3.5 w-3.5" /> : <Rows className="h-3.5 w-3.5" />}
              {grouped ? 'Grouped' : 'Flat'}
            </Button>
            {grouped && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleMergeMode}
                className={cn(
                  'gap-1.5 whitespace-nowrap',
                  mergeMode && 'border-blue-500/60 bg-blue-500/10 text-blue-400',
                )}
                title="Select multiple packs to merge them into one"
              >
                <Merge className="h-3.5 w-3.5" />
                {mergeMode ? 'Cancel merge' : 'Merge packs'}
              </Button>
            )}
            {taggerAvailable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTaggerOpen(true)}
                className="gap-1.5 whitespace-nowrap"
                title="Tag and import new battlemaps into the library"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Maps
              </Button>
            )}
            {loading && <span className="text-xs text-muted-foreground">Searching…</span>}
            {!loading && maps && (
              <span
                className="group relative cursor-default text-muted-foreground"
                title={`${groupCount} ${grouped ? 'packs' : 'results'}${grouped && maps.length !== groupCount ? ` (${maps.length} files)` : ''}`}
              >
                <Info className="h-3.5 w-3.5" />
              </span>
            )}
            {error && <span className="text-xs text-destructive">Error: {error}</span>}
            {packMapping.error && <span className="text-xs text-destructive">Import failed: {packMapping.error}</span>}
          </div>
          <div className="relative flex-1 overflow-hidden">
            <ThumbnailGrid
              items={items}
              selected={selectedFileName}
              onSelect={mergeMode ? handleMergeSelect : handleSelect}
              scale={thumbScale}
              mergeSelection={mergeMode ? mergeSelectedFileNames : null}
            />
            {/* Merge confirmation bar */}
            {mergeMode && mergeSelected.size >= 2 && !showMergeConfirm && (
              <div
                className="absolute bottom-4 left-1/2 flex items-center gap-3 rounded-lg border border-blue-500/40 bg-card/95 px-4 py-2 shadow-lg"
                style={{ transform: 'translateX(-50%)' }}
              >
                <span className="text-sm font-medium">{mergeSelected.size} packs selected</span>
                <Button size="sm" onClick={startMerge} className="gap-1.5">
                  <Merge className="h-3.5 w-3.5" />
                  Merge
                </Button>
              </div>
            )}
            {/* Merge name input */}
            {showMergeConfirm && (
              <div
                className="absolute bottom-4 left-1/2 flex items-center gap-2 rounded-lg border border-blue-500/40 bg-card/95 px-4 py-2 shadow-lg"
                style={{ transform: 'translateX(-50%)' }}
              >
                <span className="text-sm text-muted-foreground">Pack name:</span>
                <Input
                  value={mergeNameInput}
                  onChange={(e) => setMergeNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmMerge()}
                  className="h-7 w-56"
                  autoFocus
                />
                <Button size="sm" onClick={confirmMerge} className="h-7 w-7 p-0">
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowMergeConfirm(false)} className="h-7 w-7 p-0">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Detail overlay */}
          {selectedFileName && (
            <DetailOverlay
              storageKey="dmtool.detail.maps"
              defaultWidth={780}
              closing={detailClosing}
              onClosed={handleDetailClosed}
            >
              <DetailPane
                fileName={selectedFileName}
                variants={activeVariants}
                onSelectVariant={handleSelectVariant}
                onClose={closeDetail}
                anthropicApiKey={anthropicApiKey}
              />
            </DetailOverlay>
          )}
        </div>
      </div>

      {taggerAvailable && (
        <TaggerDialog
          open={taggerOpen}
          onOpenChange={setTaggerOpen}
          anthropicApiKey={anthropicApiKey}
          onIngestComplete={handleIngestComplete}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapping-based grouping — same interface as groupByStem but driven by
// the AI-generated pack mapping instead of filename heuristics.
// ---------------------------------------------------------------------------

import type { MapGroup } from '@shared/map-stem';

function groupByMapping<T extends { fileName: string }>(
  maps: readonly T[],
  mapping: Record<string, string>,
): MapGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const m of maps) {
    const pack = mapping[m.fileName] ?? m.fileName;
    let list = buckets.get(pack);
    if (!list) {
      list = [];
      buckets.set(pack, list);
    }
    list.push(m);
  }

  const result: MapGroup<T>[] = [];
  for (const [stem, list] of buckets) {
    const sorted = [...list].sort((a, b) => a.fileName.localeCompare(b.fileName));
    result.push({
      stem,
      representative: list[0],
      variants: sorted,
    });
  }
  return result;
}
