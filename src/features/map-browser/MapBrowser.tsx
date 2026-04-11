import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Layers, Rows } from "lucide-react";
import { FilterPanel } from "./FilterPanel";
import { ThumbnailGrid, type ThumbnailItem } from "./ThumbnailGrid";
import { DetailPane } from "./DetailPane";
import { useFacets, useMapSearch } from "./useMaps";
import { cn } from "@/lib/utils";
import type { MapSummary, SearchParams } from "@shared/types";
import { groupByStem } from "@shared/map-stem";

// Top-level state for the browser. All mutable state lives here so the
// FilterPanel, ThumbnailGrid and DetailPane stay presentational.
export function MapBrowser() {
  const [keywords, setKeywords] = useState("");
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
      limit: 500,
    }),
    [filters, keywords],
  );

  const { data: maps, loading, error } = useMapSearch(searchParams);
  const { data: facets } = useFacets();

  // Build the flat list of thumbnail items. When grouping is on, we
  // collapse into one item per pack stem; when off, each map is its own
  // item (variantCount = 1 so no badge renders).
  const { items, groupCount } = useMemo(() => {
    const rows = maps ?? [];
    if (!grouped) {
      return {
        items: rows.map((m) => ({ map: m, variantCount: 1 }) satisfies ThumbnailItem),
        groupCount: rows.length,
      };
    }
    const groups = groupByStem(rows);
    const items: ThumbnailItem[] = groups.map((g) => ({
      map: g.representative,
      variantCount: g.variants.length,
    }));
    return { items, groupCount: groups.length };
  }, [maps, grouped]);

  // Look up the variant set for a given representative fileName. This is
  // O(n) per click which is fine for result sets ≤ 500; if it ever gets
  // hot we can memoize an index from stem → variants.
  const handleSelect = (item: ThumbnailItem) => {
    setSelectedFileName(item.map.fileName);
    if (grouped && maps) {
      const groups = groupByStem(maps);
      const g = groups.find((g) => g.representative.fileName === item.map.fileName);
      setActiveVariants(g?.variants ?? null);
    } else {
      setActiveVariants(null);
    }
  };

  // Called by DetailPane when the user clicks a sibling in the variant
  // strip. Updates the selected filename without changing the active
  // variant set, so the strip stays visible with the new selection
  // highlighted.
  const handleSelectVariant = (fileName: string) => {
    setSelectedFileName(fileName);
  };

  const closeDetail = () => {
    setSelectedFileName(null);
    setActiveVariants(null);
  };

  // When a map is selected, both the grid and the detail pane share
  // the remaining horizontal space, but weighted so the detail area
  // gets ~2× the grid. The grid keeps enough width to show 2+ columns
  // of thumbnails on a normal window, and the detail pane has room for
  // a large image plus the variant panel.
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Left: filter sidebar */}
        <div className="w-64 shrink-0">
          <FilterPanel facets={facets} params={filters} onChange={setFilters} />
        </div>

      {/* Center: search bar + thumbnail grid. Always flex-1 — the
          detail pane's proportionally larger flex weight gives it more
          room without squeezing the grid down to a single column. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="Search — e.g. 'a gloomy castle in a dark forest'"
            className="max-w-xl"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGrouped((g) => !g)}
            className={cn(
              "gap-1.5 whitespace-nowrap",
              grouped && "border-primary/60 bg-primary/10 text-primary",
            )}
            title={
              grouped
                ? "Showing one card per pack. Click to flatten."
                : "Showing every map individually. Click to group variants by pack."
            }
          >
            {grouped ? <Layers className="h-3.5 w-3.5" /> : <Rows className="h-3.5 w-3.5" />}
            {grouped ? "Grouped" : "Flat"}
          </Button>
          <div className="text-xs text-muted-foreground">
            {loading && "Searching…"}
            {!loading && maps && (
              <>
                {groupCount} {grouped ? "packs" : "results"}
                {grouped && maps.length !== groupCount && (
                  <span className="ml-1 text-muted-foreground/70">
                    ({maps.length} files)
                  </span>
                )}
              </>
            )}
            {error && <span className="text-destructive">Error: {error}</span>}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ThumbnailGrid
            items={items}
            selected={selectedFileName}
            onSelect={handleSelect}
          />
        </div>
      </div>

      {/* Right: detail pane gets ~1.8× the grid's flex weight so the
          main image is large and the variant panel has room, while
          the grid still has enough room for 2 columns of thumbs. */}
      {selectedFileName && (
        <div className="flex min-w-0 flex-[1.8]">
          <DetailPane
            fileName={selectedFileName}
            variants={activeVariants}
            onSelectVariant={handleSelectVariant}
            onClose={closeDetail}
          />
        </div>
      )}
      </div>
    </div>
  );
}
