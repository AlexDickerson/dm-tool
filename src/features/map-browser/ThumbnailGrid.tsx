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
  /** Multiplier applied to the base THUMB_WIDTH/HEIGHT. 1 = original. */
  scale?: number;
}

// Base thumbnail dimensions. Tuned so the grid shows 2 columns at ~400px
// width and 3 at ~580px when scale=1. The settings slider multiplies
// these to grow/shrink each card; column count is recomputed from the
// scaled width so larger cards mean fewer columns automatically.
const BASE_THUMB_WIDTH = 180;
const BASE_THUMB_HEIGHT = 140; // image + label row
const GAP = 12;

export function ThumbnailGrid({ items, selected, onSelect, scale = 1 }: ThumbnailGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  const thumbWidth = Math.round(BASE_THUMB_WIDTH * scale);
  const thumbHeight = Math.round(BASE_THUMB_HEIGHT * scale);

  // Recompute column count on resize *and* when the scale changes — a
  // bigger card means fewer columns fit in the same width. ResizeObserver
  // beats window.resize because the grid pane can shrink without the
  // window changing size (e.g. when the detail pane opens).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const cols = Math.max(1, Math.floor((width + GAP) / (thumbWidth + GAP)));
      setColumnCount(cols);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [thumbWidth]);

  const rowCount = Math.ceil(items.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => thumbHeight + GAP,
    overscan: 3,
  });

  // useVirtualizer caches per-row measurements; when the row height
  // changes (scale slider) we have to invalidate them or the virtual
  // window keeps using the old size and rows overlap or leave gaps.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [thumbHeight, rowVirtualizer]);

  // Keep the selected card in view. Re-runs on selection change AND on
  // layout shifts (columnCount/items): the most common case is clicking
  // a thumbnail near the bottom — the detail pane opens, the grid pane
  // shrinks, the column count drops, and the previously-visible row
  // would otherwise end up scrolled off-screen. `align: "auto"` only
  // scrolls when the row is actually outside the viewport, so it's a
  // no-op when the card is already visible.
  useEffect(() => {
    if (!selected) return;
    const idx = items.findIndex((it) => it.map.fileName === selected);
    if (idx < 0) return;
    const rowIndex = Math.floor(idx / columnCount);
    rowVirtualizer.scrollToIndex(rowIndex, { align: "auto" });
  }, [selected, columnCount, items, rowVirtualizer]);

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
                  height={thumbHeight}
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
  height: number;
}

// Title row gets a fixed pixel height. Subtracting it from the card
// height gives us the exact image-area height, which we set inline so
// we never have to rely on flex-1 / 1fr resolving correctly.
const TITLE_ROW_HEIGHT = 26;

function ThumbnailCard({ item, isSelected, onClick, height }: ThumbnailCardProps) {
  const [errored, setErrored] = useState(false);
  const { map, variantCount } = item;
  const imageHeight = Math.max(0, height - TITLE_ROW_HEIGHT);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-all hover:border-primary/60",
        isSelected && "border-primary ring-2 ring-primary/40",
      )}
      style={{ height }}
      title={variantCount > 1 ? `${map.title} (+${variantCount - 1} variants)` : map.title}
    >
      {/* Inline-styled fixed-height image area. Inline width/height/
          objectFit on the img bypass any Tailwind class-resolution
          uncertainty and guarantee `cover` behavior. */}
      <div
        className="relative overflow-hidden bg-muted"
        style={{ height: imageHeight, width: "100%" }}
      >
        {errored ? (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            no thumbnail
          </div>
        ) : (
          <img
            src={thumbnailUrl(map.fileName)}
            alt={map.title}
            loading="lazy"
            onError={() => setErrored(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
            className="transition-transform group-hover:scale-[1.03]"
          />
        )}
      </div>
      <div
        className="truncate px-2 text-xs font-medium"
        style={{ height: TITLE_ROW_HEIGHT, lineHeight: `${TITLE_ROW_HEIGHT}px` }}
      >
        {map.title}
      </div>
      {/* Badge is anchored to the card (the button, which has `relative`
          and a fixed pixel height) rather than the image container, so
          its position is identical on every card regardless of how the
          inner flex layout resolves. */}
      {variantCount > 1 && (
        <div className="pointer-events-none absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
          {variantCount} variants
        </div>
      )}
    </button>
  );
}
