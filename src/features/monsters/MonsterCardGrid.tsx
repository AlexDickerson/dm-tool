import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import type { MonsterSummary } from '@shared/types';

const CARD_W = 200;
const CARD_H = 108;
const GAP = 8;

const RARITY_BORDER: Record<string, string> = {
  common: 'border-l-zinc-500',
  uncommon: 'border-l-amber-500',
  rare: 'border-l-blue-500',
  unique: 'border-l-purple-500',
};

interface Props {
  monsters: MonsterSummary[];
  error: string | null;
  selected: string | null;
  onSelect: (name: string) => void;
}

export function MonsterCardGrid({ monsters, error, selected, onSelect }: Props) {
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

  const rowCount = Math.ceil(monsters.length / columnCount);

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

  const mod = useCallback((n: number) => (n >= 0 ? `+${n}` : `${n}`), []);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" style={{ paddingTop: GAP }}>
        {monsters.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No monsters match your filters
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const startIdx = vRow.index * columnCount;
              const rowItems = monsters.slice(startIdx, startIdx + columnCount);
              return (
                <div
                  key={vRow.key}
                  className="absolute left-0 right-0"
                  style={{ ...gridStyle, transform: `translateY(${vRow.start}px)` }}
                >
                  {rowItems.map((m) => {
                    const isSelected = m.name === selected;
                    return (
                      <button
                        key={m.name}
                        type="button"
                        onClick={() => onSelect(m.name)}
                        className={cn(
                          'flex flex-col rounded-md border border-l-[3px] p-2 text-left text-xs transition-colors',
                          RARITY_BORDER[m.rarity.toLowerCase()] ?? 'border-l-border',
                          isSelected ? 'border-primary/50 bg-primary/10' : 'border-border bg-card hover:bg-accent/40',
                        )}
                        style={{ height: CARD_H }}
                      >
                        {/* Name + level */}
                        <div className="flex items-start justify-between gap-1">
                          <span className="min-w-0 truncate font-medium leading-tight">{m.name}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums leading-none">
                            {m.level}
                          </span>
                        </div>

                        {/* Creature type + size */}
                        <span className="mt-0.5 truncate text-[10px] capitalize text-muted-foreground">
                          {m.size} {m.creatureType}
                        </span>

                        {/* Stats row */}
                        <div className="mt-auto flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
                          <span>
                            <b className="text-foreground/80">HP</b> {m.hp}
                          </span>
                          <span>
                            <b className="text-foreground/80">AC</b> {m.ac}
                          </span>
                          <span>
                            <b className="text-foreground/80">F</b> {mod(m.fort)}
                          </span>
                          <span>
                            <b className="text-foreground/80">R</b> {mod(m.ref)}
                          </span>
                          <span>
                            <b className="text-foreground/80">W</b> {mod(m.will)}
                          </span>
                        </div>

                        {/* Traits */}
                        {m.traits.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 overflow-hidden">
                            {m.traits.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="shrink-0 rounded bg-accent/60 px-1 py-0.5 text-[9px] leading-none text-foreground/70"
                              >
                                {t.toLowerCase()}
                              </span>
                            ))}
                            {m.traits.length > 3 && (
                              <span className="text-[9px] text-muted-foreground">+{m.traits.length - 3}</span>
                            )}
                          </div>
                        )}
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
          {monsters.length.toLocaleString()} creature{monsters.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
