import { ExternalLink, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useItemDetail } from './useItems';

interface ItemDetailPaneProps {
  itemId: string | null;
  /** Other grade variants of the same base item (e.g. Lesser, Greater).
   *  When present, rendered as clickable rows so the user can switch. */
  siblings?: ItemBrowserRow[] | null;
  onSelectSibling?: (id: string) => void;
  onClose: () => void;
}

import type { ItemBrowserRow } from '@shared/types';

const RARITY_CHIP: Record<string, string> = {
  COMMON: 'bg-muted text-foreground border-border',
  UNCOMMON: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  RARE: 'bg-blue-900/40 text-blue-300 border-blue-700/40',
  UNIQUE: 'bg-purple-900/40 text-purple-300 border-purple-700/40',
};

export function ItemDetailPane({ itemId, siblings, onSelectSibling, onClose }: ItemDetailPaneProps) {
  const { data: detail, loading, error } = useItemDetail(itemId);

  if (!itemId) return null;

  return (
    <div className="flex h-full flex-col border-l border-border bg-card" style={{ width: 360 }}>
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{detail?.name ?? 'Loading...'}</h2>
        <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator />

      {loading && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading...</div>
      )}
      {error && <div className="p-3 text-sm text-destructive">{error}</div>}
      {detail && (
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-3">
            {/* Level + rarity row */}
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tabular-nums text-foreground">
                {detail.level != null ? `Level ${detail.level}` : 'Level —'}
              </span>
              <span
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize leading-none',
                  RARITY_CHIP[detail.rarity] || RARITY_CHIP.COMMON,
                )}
              >
                {detail.rarity.toLowerCase()}
              </span>
              {detail.isMagical && (
                <span className="flex items-center gap-0.5 text-[10px] text-amber-400">
                  <Sparkles className="h-3 w-3" />
                  Magical
                </span>
              )}
            </div>

            {/* Traits */}
            {detail.traits.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {detail.traits.map((t) => (
                  <span
                    key={t}
                    className="rounded border border-border bg-accent/60 px-1.5 py-0.5 text-[10px] leading-none text-foreground/80"
                  >
                    {t.toLowerCase()}
                  </span>
                ))}
              </div>
            )}

            <Separator />

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <StatRow label="Price" value={detail.price ?? '—'} />
              <StatRow label="Bulk" value={detail.bulk ?? '—'} />
              <StatRow label="Usage" value={detail.usage ?? '—'} />
              {detail.source && <StatRow label="Source" value={detail.source} />}
            </div>

            {detail.hasActivation && (
              <div className="flex items-center gap-1 text-[10px] text-amber-400">
                <Sparkles className="h-3 w-3" /> Has activation
              </div>
            )}

            {/* Grade variants (siblings from grouping) */}
            {siblings && siblings.length > 1 && (
              <>
                <Separator />
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Grades
                  </h3>
                  <div className="space-y-0.5">
                    {siblings.map((s) => {
                      const isCurrent = s.id === itemId;
                      // Extract the parenthetical label
                      const match = s.name.match(/\(([^)]+)\)\s*$/);
                      const label = match ? match[1] : s.name;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => !isCurrent && onSelectSibling?.(s.id)}
                          className={cn(
                            'flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors',
                            isCurrent
                              ? 'bg-primary/15 text-foreground'
                              : 'bg-accent/30 text-foreground/80 hover:bg-accent/60',
                          )}
                        >
                          <span className="min-w-0 truncate font-medium">{label}</span>
                          <div className="flex shrink-0 gap-3 tabular-nums text-muted-foreground">
                            {s.level != null && <span>Lv {s.level}</span>}
                            {s.price && <span>{s.price}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Variants (from item's own variant data) — hidden when
                siblings cover the same info via the Grades section */}
            {detail.variants.length > 0 && !(siblings && siblings.length > 1) && (
              <>
                <Separator />
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Variants
                  </h3>
                  <div className="space-y-1">
                    {detail.variants.map((v, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-accent/30 px-2 py-1 text-xs">
                        <span className="min-w-0 truncate">{v.type}</span>
                        <div className="flex shrink-0 gap-3 text-muted-foreground">
                          {v.level != null && <span>Lv {v.level}</span>}
                          {v.price && <span>{v.price}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Description */}
            {detail.description && (
              <>
                <Separator />
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                  {detail.description}
                </div>
              </>
            )}

            {/* AoN link */}
            {detail.aonUrl && (
              <>
                <Separator />
                <button
                  type="button"
                  onClick={() => api.openExternal(detail.aonUrl!)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on Archives of Nethys
                </button>
              </>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
