import { useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MonsterSearchParams, MonsterSummary } from '@shared/types';

const RARITY_DOT: Record<string, string> = {
  common: 'bg-zinc-500',
  uncommon: 'bg-amber-500',
  rare: 'bg-blue-500',
  unique: 'bg-purple-500',
};

const ROW_HEIGHT = 36;

interface Column {
  key: string;
  label: string;
  sortKey?: MonsterSearchParams['sortBy'];
  width: string;
  align?: 'right' | 'center';
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', sortKey: 'name', width: 'minmax(180px, 1fr)' },
  { key: 'level', label: 'Lvl', sortKey: 'level', width: '44px', align: 'right' },
  { key: 'hp', label: 'HP', sortKey: 'hp', width: '52px', align: 'right' },
  { key: 'ac', label: 'AC', sortKey: 'ac', width: '44px', align: 'right' },
  { key: 'fort', label: 'Fort', width: '44px', align: 'right' },
  { key: 'ref', label: 'Ref', width: '44px', align: 'right' },
  { key: 'will', label: 'Will', width: '44px', align: 'right' },
  { key: 'size', label: 'Size', width: '72px' },
  { key: 'type', label: 'Type', width: '100px' },
];

interface Props {
  monsters: MonsterSummary[];
  error: string | null;
  selected: string | null;
  onSelect: (name: string) => void;
  sortBy: MonsterSearchParams['sortBy'];
  sortDir: MonsterSearchParams['sortDir'];
  onSort: (col: MonsterSearchParams['sortBy']) => void;
}

export function MonsterTable({ monsters, error, selected, onSelect, sortBy, sortDir, onSort }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: monsters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const gridTemplate = useMemo(() => COLUMNS.map((c) => c.width).join(' '), []);

  const mod = useCallback((n: number) => (n >= 0 ? `+${n}` : `${n}`), []);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}

      {/* Column headers */}
      <div
        className="grid shrink-0 items-center border-b border-border px-3"
        style={{ gridTemplateColumns: gridTemplate, height: 32, background: 'hsl(var(--muted) / 0.5)' }}
      >
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            type="button"
            onClick={() => col.sortKey && onSort(col.sortKey)}
            className={cn(
              'flex items-center gap-1 text-[10px] uppercase tracking-wider transition-colors hover:text-foreground',
              col.align === 'right' && 'justify-end',
              col.sortKey && 'cursor-pointer',
              !col.sortKey && 'cursor-default',
              col.sortKey === sortBy ? 'text-primary' : 'text-muted-foreground',
            )}
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
          >
            {col.label}
            {col.sortKey && col.sortKey === sortBy ? (
              sortDir === 'asc' ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )
            ) : col.sortKey ? (
              <ArrowUpDown className="h-2.5 w-2.5 opacity-30" />
            ) : null}
          </button>
        ))}
      </div>

      {/* Virtualized rows */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const m = monsters[vRow.index];
            const isSelected = m.name === selected;
            return (
              <div
                key={vRow.index}
                className={cn(
                  'absolute left-0 right-0 grid cursor-pointer items-center border-b border-border/50 px-3 transition-[colors,box-shadow]',
                  isSelected
                    ? 'bg-primary/10 text-foreground'
                    : vRow.index % 2 === 1
                      ? 'bg-muted/30 hover:bg-accent/40'
                      : 'hover:bg-accent/40',
                  !isSelected && 'hover:shadow-[inset_3px_0_0_hsl(var(--primary))]',
                )}
                style={{
                  gridTemplateColumns: gridTemplate,
                  height: ROW_HEIGHT,
                  transform: `translateY(${vRow.start}px)`,
                }}
                onClick={() => onSelect(m.name)}
              >
                {/* Name with rarity dot and traits */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn('h-2 w-2 shrink-0 rounded-full', RARITY_DOT[m.rarity.toLowerCase()] ?? 'bg-zinc-500')}
                    title={m.rarity}
                  />
                  <span className="truncate text-xs font-medium">{m.name}</span>
                  {m.traits.length > 0 && (
                    <span className="hidden shrink-0 truncate text-[10px] text-muted-foreground xl:inline">
                      {m.traits.slice(0, 2).join(', ')}
                      {m.traits.length > 2 && ` +${m.traits.length - 2}`}
                    </span>
                  )}
                </div>
                <div className="text-right text-xs tabular-nums">{m.level}</div>
                <div className="text-right text-xs tabular-nums">{m.hp}</div>
                <div className="text-right text-xs tabular-nums">{m.ac}</div>
                <div className="text-right text-xs tabular-nums text-muted-foreground">{mod(m.fort)}</div>
                <div className="text-right text-xs tabular-nums text-muted-foreground">{mod(m.ref)}</div>
                <div className="text-right text-xs tabular-nums text-muted-foreground">{mod(m.will)}</div>
                <div className="truncate text-xs capitalize text-muted-foreground">{m.size}</div>
                <div className="truncate text-xs capitalize text-muted-foreground">{m.creatureType}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
