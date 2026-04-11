import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn, thumbnailUrl } from "@/lib/utils";
import type { MapSummary } from "@shared/types";

/** One entry in the grid. When grouping is off, `variantCount` is 1 and
 *  the map stands alone. When grouping is on, `map` is the representative
 *  of a pack and `variantCount` is the total number of maps in that pack
 *  (including the representative, so it's always ≥ 1). */
export interface ThumbnailItem {
  map: MapSummary;
  variantCount: number;
}

interface ThumbnailGridProps {
  items: ThumbnailItem[];
  selected: string | null;
  onSelect: (item: ThumbnailItem) => void;
}

// Tuned so the grid shows 2 columns at ~400px width and 3 at ~580px.
// If you bump THUMB_WIDTH up, revisit MapBrowser's flex weighting —
// anything above ~200 starts forcing the grid into 1-column mode when
// the detail pane is open.
const THUMB_WIDTH = 180;
const THUMB_HEIGHT = 140; // image + label row
const GAP = 12;

export function ThumbnailGrid({ items, selected, onSelect }: ThumbnailGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  // Recompute column count on resize. ResizeObserver beats window.resize
  // because the grid pane can shrink without the window changing size
  // (e.g. when the detail pane opens).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const cols = Math.max(1, Math.floor((width + GAP) / (THUMB_WIDTH + GAP)));
      setColumnCount(cols);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(items.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => THUMB_HEIGHT + GAP,
    overscan: 3,
  });

  // Memoize so the virtualizer doesn't re-render rows on every parent tick.
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
      gap: `${GAP}px`,
    }),
    [columnCount],
  );

  if (items.length === 0) {
    return (
      <div
        ref={parentRef}
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        No maps match the current filters.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto p-3">
      <div style={{ height: totalSize, position: "relative" }}>
        {virtualItems.map((virtualRow) => {
          const startIndex = virtualRow.index * columnCount;
          const rowItems = items.slice(startIndex, startIndex + columnCount);
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 right-0 grid"
              style={{
                ...gridStyle,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {rowItems.map((it) => (
                <ThumbnailCard
                  key={it.map.fileName}
                  item={it}
                  isSelected={it.map.fileName === selected}
                  onClick={() => onSelect(it)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ThumbnailCardProps {
  item: ThumbnailItem;
  isSelected: boolean;
  onClick: () => void;
}

function ThumbnailCard({ item, isSelected, onClick }: ThumbnailCardProps) {
  const [errored, setErrored] = useState(false);
  const { map, variantCount } = item;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-all hover:border-primary/60",
        isSelected && "border-primary ring-2 ring-primary/40",
      )}
      style={{ height: THUMB_HEIGHT }}
      title={variantCount > 1 ? `${map.title} (+${variantCount - 1} variants)` : map.title}
    >
      <div className="relative flex-1 overflow-hidden bg-muted">
        {errored ? (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
            no thumbnail
          </div>
        ) : (
          <img
            src={thumbnailUrl(map.fileName)}
            alt={map.title}
            loading="lazy"
            onError={() => setErrored(true)}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        )}
        {variantCount > 1 && (
          <div className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            {variantCount} variants
          </div>
        )}
      </div>
      <div className="truncate px-2 py-1 text-xs font-medium">{map.title}</div>
    </button>
  );
}
