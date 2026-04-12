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

  // When the detail pane opens or closes the grid container resizes,
  // but we do NOT want to recompute the column count — that causes
  // every card to jump to a new position which is very jarring. Instead
  // we freeze the column count for a short window after `selected`
  // changes, so cards merely stretch/compress in place. Actual window
  // resizes and scale changes still recompute normally.
  const freezeRef = useRef(false);
  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    const changed =
      (prevSelectedRef.current == null) !== (selected == null);
    prevSelectedRef.current = selected;
    if (!changed) return;
    freezeRef.current = true;
    // The ResizeObserver fires synchronously during layout; two rAFs
    // is enough to let it settle before we unfreeze.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        freezeRef.current = false;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [selected]);

  // Recompute column count on resize *and* when the scale changes — a
  // bigger card means fewer columns fit in the same width. ResizeObserver
  // beats window.resize because the grid pane can shrink without the
  // window changing size (e.g. when the detail pane opens).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      if (freezeRef.current) return;
      const width = el.clientWidth;
      const cols = Math.max(1, Math.floor((width + GAP) / (thumbWidth + GAP)));
      setColumnCount(cols);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [thumbWidth, thumbHeight]);

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

  // Keep the selected card in view when the selection changes.
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

function ThumbnailCard({ item, isSelected, onClick, height }: ThumbnailCardProps) {
  const [errored, setErrored] = useState(false);
  const { map, variantCount } = item;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-md border border-border bg-muted text-left transition-all hover:border-primary/60",
        isSelected && "border-primary ring-2 ring-primary/40",
      )}
      style={{ height }}
      title={variantCount > 1 ? `${map.title} (+${variantCount - 1} variants)` : map.title}
    >
      {/* Image fills the entire card now that the title row is gone.
          Inline width/height/objectFit on the img bypass any Tailwind
          class-resolution uncertainty and guarantee `cover` behavior. */}
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
      {/* Badge is anchored to the card (the button, which has `relative`
          and a fixed pixel height) rather than the image container, so
          its position is identical on every card regardless of how the
          inner flex layout resolves. */}
      {variantCount > 1 && (
        <div className="pointer-events-none absolute right-1.5 top-1.5 rounded-md bg-black/70 px-2 py-0.5 text-sm font-semibold text-white shadow-sm">
          {variantCount}
        </div>
      )}
    </button>
  );
}
