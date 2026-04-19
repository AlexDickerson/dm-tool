import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ItemBrowserRow, ItemSortField, SortDirection } from '@dm-tool/shared/types';

export interface GroupedItem {
  representative: ItemBrowserRow;
  siblings: ItemBrowserRow[];
}

interface ItemTableProps {
  groups: GroupedItem[];
  selectedId: string | null;
  onSelect: (item: ItemBrowserRow) => void;
  sortBy: ItemSortField;
  sortDir: SortDirection;
  onSort: (field: ItemSortField) => void;
  loading?: boolean;
}

const ROW_HEIGHT = 36;

const RARITY_CHIP: Record<string, string> = {
  COMMON: '',
  UNCOMMON: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  RARE: 'bg-blue-900/40 text-blue-300 border-blue-700/40',
  UNIQUE: 'bg-purple-900/40 text-purple-300 border-purple-700/40',
};

const TRAIT_CHIP = 'bg-accent/60 text-foreground/80 border-border';

/** Strip trailing parenthetical for display. */
function displayName(name: string): string {
  return name.replace(/\s*\([^)]+\)\s*$/, '');
}

/** Format a level range like "1–19" for groups. */
function levelRange(siblings: ItemBrowserRow[]): string {
  const levels = siblings.map((s) => s.level).filter((l): l is number => l != null);
  if (levels.length === 0) return '—';
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  return min === max ? String(min) : `${min}–${max}`;
}

export function ItemTable({ groups, selectedId, onSelect, sortBy, sortDir, onSort, loading }: ItemTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const totalItems = groups.reduce((sum, g) => sum + g.siblings.length, 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex shrink-0 items-center border-b border-border px-3 text-[10px] uppercase tracking-wider text-muted-foreground"
        style={{
          height: ROW_HEIGHT,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          background: 'hsl(var(--muted) / 0.5)',
        }}
      >
        <SortHeader
          label="Name"
          field="name"
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          className="min-w-0 flex-1"
        />
        <SortHeader
          label="Lvl"
          field="level"
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          className="w-12 shrink-0 text-right"
        />
        <SortHeader
          label="Price"
          field="price"
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          className="w-20 shrink-0 text-right"
        />
        <div className="w-10 shrink-0 text-right">Bulk</div>
        <div className="w-40 shrink-0 pl-3">Traits</div>
      </div>

      {/* Body */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        {loading && groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading items...</div>
        ) : groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No items match your filters
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const group = groups[vRow.index];
              const item = group.representative;
              const isGroup = group.siblings.length > 1;
              const isSelected = group.siblings.some((s) => s.id === selectedId);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'absolute left-0 flex w-full cursor-pointer items-center border-b border-border/50 px-3 text-xs transition-[colors,box-shadow]',
                    isSelected
                      ? 'bg-primary/10 text-foreground'
                      : vRow.index % 2 === 1
                        ? 'bg-muted/30 hover:bg-accent/40'
                        : 'hover:bg-accent/40',
                    !isSelected && 'hover:shadow-[inset_3px_0_0_hsl(var(--primary))]',
                  )}
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  onClick={() => onSelect(item)}
                >
                  {/* Name */}
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
                    <span className="truncate font-medium">{isGroup ? displayName(item.name) : item.name}</span>
                    {isGroup && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums leading-none text-primary">
                        {group.siblings.length}
                      </span>
                    )}
                  </div>
                  {/* Level */}
                  <div className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                    {isGroup ? levelRange(group.siblings) : (item.level ?? '—')}
                  </div>
                  {/* Price */}
                  <div className="w-20 shrink-0 truncate text-right tabular-nums text-muted-foreground">
                    {item.price ?? '—'}
                  </div>
                  {/* Bulk */}
                  <div className="w-10 shrink-0 text-right text-muted-foreground">{item.bulk ?? '—'}</div>
                  {/* Traits */}
                  <div className="flex w-40 shrink-0 items-center gap-1 overflow-hidden pl-3">
                    {item.isRemastered === false && (
                      <span className="shrink-0 rounded border border-yellow-700/40 bg-yellow-950/30 px-1 py-0.5 text-[9px] font-medium leading-none text-yellow-400">
                        legacy
                      </span>
                    )}
                    {item.rarity !== 'COMMON' && (
                      <span
                        className={cn(
                          'shrink-0 rounded border px-1 py-0.5 text-[9px] font-medium leading-none',
                          RARITY_CHIP[item.rarity] || TRAIT_CHIP,
                        )}
                      >
                        {item.rarity.toLowerCase()}
                      </span>
                    )}
                    {item.traits.slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className={cn('shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none', TRAIT_CHIP)}
                      >
                        {t.toLowerCase()}
                      </span>
                    ))}
                    {item.traits.length > 2 && (
                      <span className="shrink-0 text-[9px] text-muted-foreground">+{item.traits.length - 2}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with count */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-card px-3">
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {groups.length.toLocaleString()} row{groups.length !== 1 ? 's' : ''}
          {totalItems !== groups.length && ` (${totalItems.toLocaleString()} items)`}
        </span>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  field: ItemSortField;
  sortBy: ItemSortField;
  sortDir: SortDirection;
  onSort: (f: ItemSortField) => void;
  className?: string;
}) {
  const isActive = sortBy === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn('flex items-center gap-0.5 hover:text-foreground', isActive && 'text-primary', className)}
    >
      {label}
      {isActive ? (
        sortDir === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  );
}
