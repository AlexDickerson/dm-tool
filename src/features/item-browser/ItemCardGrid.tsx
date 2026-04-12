import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import type { ItemBrowserRow } from '@shared/types';

export interface GroupedItem {
  representative: ItemBrowserRow;
  siblings: ItemBrowserRow[];
}

const CARD_W = 200;
const CARD_H = 96;
const GAP = 8;

const RARITY_BORDER: Record<string, string> = {
  COMMON: 'border-l-border',
  UNCOMMON: 'border-l-orange-500',
  RARE: 'border-l-blue-500',
  UNIQUE: 'border-l-purple-500',
};

function displayName(name: string): string {
  return name.replace(/\s*\([^)]+\)\s*$/, '');
}

function levelRange(siblings: ItemBrowserRow[]): string {
  const levels = siblings.map((s) => s.level).filter((l): l is number => l != null);
  if (levels.length === 0) return '—';
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  return min === max ? String(min) : `${min}–${max}`;
}

interface Props {
  groups: GroupedItem[];
  selectedId: string | null;
  onSelect: (item: ItemBrowserRow) => void;
  loading?: boolean;
}

export function ItemCardGrid({ groups, selectedId, onSelect, loading }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(4);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setColumnCount(Math.max(1, Math.floor((w + GAP) / (CARD_W + GAP))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(groups.length / columnCount);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_H + GAP,
    overscan: 5,
  });

  const gridStyle = useMemo(
    () => ({
      display: 'grid',
      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
      gap: GAP,
      padding: `0 ${GAP}px`,
    }),
    [columnCount],
  );

  const totalItems = groups.reduce((sum, g) => sum + g.siblings.length, 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" style={{ paddingTop: GAP }}>
        {loading && groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading items...</div>
        ) : groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No items match your filters
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const startIdx = vRow.index * columnCount;
              const rowItems = groups.slice(startIdx, startIdx + columnCount);
              return (
                <div
                  key={vRow.key}
                  className="absolute left-0 right-0"
                  style={{ ...gridStyle, transform: `translateY(${vRow.start}px)` }}
                >
                  {rowItems.map((group) => {
                    const item = group.representative;
                    const isGroup = group.siblings.length > 1;
                    const isSelected = group.siblings.some((s) => s.id === selectedId);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item)}
                        className={cn(
                          'flex flex-col rounded-md border border-l-[3px] p-2 text-left text-xs transition-colors',
                          RARITY_BORDER[item.rarity] ?? 'border-l-border',
                          isSelected ? 'border-primary/50 bg-primary/10' : 'border-border bg-card hover:bg-accent/40',
                        )}
                        style={{ height: CARD_H }}
                      >
                        {/* Name + group count */}
                        <div className="flex items-start justify-between gap-1">
                          <span className="min-w-0 truncate font-medium leading-tight">
                            {isGroup ? displayName(item.name) : item.name}
                          </span>
                          {isGroup && (
                            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums leading-none text-primary">
                              {group.siblings.length}
                            </span>
                          )}
                        </div>

                        {/* Level + price */}
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>
                            <b className="text-foreground/80">Lvl</b>{' '}
                            {isGroup ? levelRange(group.siblings) : (item.level ?? '—')}
                          </span>
                          {item.price && (
                            <span className="truncate">
                              <b className="text-foreground/80">Price</b> {item.price}
                            </span>
                          )}
                          {item.bulk && (
                            <span>
                              <b className="text-foreground/80">Bulk</b> {item.bulk}
                            </span>
                          )}
                        </div>

                        {/* Traits */}
                        <div className="mt-auto flex items-center gap-1 overflow-hidden">
                          {item.isRemastered === false && (
                            <span className="shrink-0 rounded border border-yellow-700/40 bg-yellow-950/30 px-1 py-0.5 text-[9px] font-medium leading-none text-yellow-400">
                              legacy
                            </span>
                          )}
                          {item.rarity !== 'COMMON' && (
                            <span
                              className={cn(
                                'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none',
                                item.rarity === 'UNCOMMON' && 'bg-orange-900/40 text-orange-300',
                                item.rarity === 'RARE' && 'bg-blue-900/40 text-blue-300',
                                item.rarity === 'UNIQUE' && 'bg-purple-900/40 text-purple-300',
                              )}
                            >
                              {item.rarity.toLowerCase()}
                            </span>
                          )}
                          {item.traits.slice(0, 2).map((t) => (
                            <span
                              key={t}
                              className="shrink-0 rounded bg-accent/60 px-1 py-0.5 text-[9px] leading-none text-foreground/70"
                            >
                              {t.toLowerCase()}
                            </span>
                          ))}
                          {item.traits.length > 2 && (
                            <span className="text-[9px] text-muted-foreground">+{item.traits.length - 2}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex h-7 shrink-0 items-center px-3">
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {groups.length.toLocaleString()} row{groups.length !== 1 ? 's' : ''}
          {totalItems !== groups.length && ` (${totalItems.toLocaleString()} items)`}
        </span>
      </div>
    </div>
  );
}
