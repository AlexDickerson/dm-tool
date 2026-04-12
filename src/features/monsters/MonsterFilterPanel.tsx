import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { MonsterFacets, MonsterSearchParams } from '@shared/types';

const RARITY_COLORS: Record<string, string> = {
  common: 'border-zinc-500 bg-zinc-500/10',
  uncommon: 'border-amber-500 bg-amber-500/10',
  rare: 'border-blue-500 bg-blue-500/10',
  unique: 'border-purple-500 bg-purple-500/10',
};

const SIZE_ORDER = ['tiny', 'small', 'med', 'medium', 'large', 'huge', 'gargantuan'];

interface Props {
  facets: MonsterFacets | null;
  params: MonsterSearchParams;
  onChange: (next: MonsterSearchParams) => void;
}

export function MonsterFilterPanel({ facets, params, onChange }: Props) {
  const [traitFilter, setTraitFilter] = useState('');

  const activeCount = useMemo(() => {
    let n = 0;
    if (params.levels) n++;
    if (params.rarities?.length) n += params.rarities.length;
    if (params.sizes?.length) n += params.sizes.length;
    if (params.creatureTypes?.length) n += params.creatureTypes.length;
    if (params.traits?.length) n += params.traits.length;
    if (params.sources?.length) n += params.sources.length;
    if (params.hpMin != null) n++;
    if (params.hpMax != null) n++;
    if (params.acMin != null) n++;
    if (params.acMax != null) n++;
    if (params.fortMin != null) n++;
    if (params.refMin != null) n++;
    if (params.willMin != null) n++;
    return n;
  }, [params]);

  const clearAll = () =>
    onChange({ keywords: params.keywords, sortBy: params.sortBy, sortDir: params.sortDir });

  const toggleArray = (field: keyof MonsterSearchParams, value: string) => {
    const current = (params[field] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...params, [field]: next.length > 0 ? next : undefined });
  };

  const setNum = (field: keyof MonsterSearchParams, value: string) => {
    const n = value === '' ? undefined : Number(value);
    onChange({ ...params, [field]: n != null && Number.isFinite(n) ? n : undefined });
  };

  const sortedSizes = useMemo(() => {
    if (!facets) return [];
    return [...facets.sizes].sort(
      (a, b) => SIZE_ORDER.indexOf(a.toLowerCase()) - SIZE_ORDER.indexOf(b.toLowerCase()),
    );
  }, [facets]);

  const filteredTraits = useMemo(() => {
    if (!facets) return [];
    if (!traitFilter) return facets.traits;
    const lower = traitFilter.toLowerCase();
    return facets.traits.filter((t) => t.toLowerCase().includes(lower));
  }, [facets, traitFilter]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card" style={{ width: 256 }}>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Filters</span>
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button type="button" onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {/* Level range */}
          {facets && (
            <section>
              <SectionHeader label="Level" />
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder={String(facets.levelRange[0])}
                  value={params.levels?.[0] ?? ''}
                  onChange={(e) => {
                    const min = e.target.value === '' ? undefined : Number(e.target.value);
                    const max = params.levels?.[1];
                    if (min == null && max == null) onChange({ ...params, levels: undefined });
                    else onChange({ ...params, levels: [min ?? facets.levelRange[0], max ?? facets.levelRange[1]] });
                  }}
                  className="h-7 w-16 px-1.5 text-xs"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="number"
                  placeholder={String(facets.levelRange[1])}
                  value={params.levels?.[1] ?? ''}
                  onChange={(e) => {
                    const max = e.target.value === '' ? undefined : Number(e.target.value);
                    const min = params.levels?.[0];
                    if (min == null && max == null) onChange({ ...params, levels: undefined });
                    else onChange({ ...params, levels: [min ?? facets.levelRange[0], max ?? facets.levelRange[1]] });
                  }}
                  className="h-7 w-16 px-1.5 text-xs"
                />
              </div>
            </section>
          )}

          {/* Rarity */}
          {facets && facets.rarities.length > 0 && (
            <section>
              <SectionHeader label="Rarity" count={params.rarities?.length} />
              <div className="flex flex-wrap gap-1">
                {facets.rarities.map((r) => {
                  const active = params.rarities?.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleArray('rarities', r)}
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-xs capitalize transition-colors',
                        active
                          ? RARITY_COLORS[r.toLowerCase()] ?? 'border-primary bg-primary/10'
                          : 'border-border bg-background hover:bg-accent',
                      )}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Size */}
          {sortedSizes.length > 0 && (
            <section>
              <SectionHeader label="Size" count={params.sizes?.length} />
              <div className="flex flex-wrap gap-1">
                {sortedSizes.map((s) => {
                  const active = params.sizes?.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleArray('sizes', s)}
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-xs capitalize transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-background hover:bg-accent',
                      )}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <Separator />

          {/* Creature Type */}
          {facets && facets.creatureTypes.length > 0 && (
            <section>
              <SectionHeader label="Creature Type" count={params.creatureTypes?.length} />
              <div className="space-y-1" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {facets.creatureTypes.map((ct) => (
                  <CheckItem
                    key={ct}
                    label={ct}
                    checked={params.creatureTypes?.includes(ct) ?? false}
                    onCheckedChange={() => toggleArray('creatureTypes', ct)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Traits */}
          {facets && facets.traits.length > 0 && (
            <section>
              <SectionHeader label="Traits" count={params.traits?.length} />
              <Input
                placeholder="Filter traits…"
                value={traitFilter}
                onChange={(e) => setTraitFilter(e.target.value)}
                className="mb-1.5 h-7 text-xs"
              />
              <div className="space-y-1" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {filteredTraits.map((t) => (
                  <CheckItem
                    key={t}
                    label={t}
                    checked={params.traits?.includes(t) ?? false}
                    onCheckedChange={() => toggleArray('traits', t)}
                  />
                ))}
              </div>
            </section>
          )}

          <Separator />

          {/* Stat ranges */}
          <section>
            <SectionHeader label="Stat Minimums" />
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <NumField label="HP min" value={params.hpMin} onChange={(v) => setNum('hpMin', v)} />
              <NumField label="HP max" value={params.hpMax} onChange={(v) => setNum('hpMax', v)} />
              <NumField label="AC min" value={params.acMin} onChange={(v) => setNum('acMin', v)} />
              <NumField label="AC max" value={params.acMax} onChange={(v) => setNum('acMax', v)} />
              <NumField label="Fort min" value={params.fortMin} onChange={(v) => setNum('fortMin', v)} />
              <NumField label="Ref min" value={params.refMin} onChange={(v) => setNum('refMin', v)} />
              <NumField label="Will min" value={params.willMin} onChange={(v) => setNum('willMin', v)} />
            </div>
          </section>

          {/* Sources */}
          {facets && facets.sources.length > 0 && (
            <section>
              <Separator className="mb-4" />
              <SectionHeader label="Source" count={params.sources?.length} />
              <div className="space-y-1" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {facets.sources.map((s) => (
                  <CheckItem
                    key={s}
                    label={s}
                    checked={params.sources?.includes(s) ?? false}
                    onCheckedChange={() => toggleArray('sources', s)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
      {count != null && count > 0 && (
        <span className="text-[10px] font-normal text-primary">{count}</span>
      )}
    </h3>
  );
}

function CheckItem({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: () => void }) {
  const id = `filter-${label}`;
  return (
    <div className="flex items-center gap-1.5">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} className="h-3.5 w-3.5" />
      <Label htmlFor={id} className="cursor-pointer text-xs capitalize">
        {label}
      </Label>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value?: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-muted-foreground">{label}</label>
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 px-1.5 text-xs"
      />
    </div>
  );
}
