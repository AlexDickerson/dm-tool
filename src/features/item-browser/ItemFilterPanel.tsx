import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { ItemFacets, ItemSearchParams } from '@shared/types';

interface ItemFilterPanelProps {
  facets: ItemFacets | null;
  params: ItemSearchParams;
  onChange: (next: ItemSearchParams) => void;
}

const RARITY_OPTS = ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'] as const;

const RARITY_COLORS: Record<string, string> = {
  COMMON: 'border-border bg-background hover:bg-accent',
  UNCOMMON: 'border-orange-600/40 bg-orange-950/30 hover:bg-orange-950/50 text-orange-300',
  RARE: 'border-blue-600/40 bg-blue-950/30 hover:bg-blue-950/50 text-blue-300',
  UNIQUE: 'border-purple-600/40 bg-purple-950/30 hover:bg-purple-950/50 text-purple-300',
};

const RARITY_ACTIVE: Record<string, string> = {
  COMMON: 'border-primary bg-primary text-primary-foreground',
  UNCOMMON: 'border-orange-500 bg-orange-600 text-white',
  RARE: 'border-blue-500 bg-blue-600 text-white',
  UNIQUE: 'border-purple-500 bg-purple-600 text-white',
};

export function ItemFilterPanel({ facets, params, onChange }: ItemFilterPanelProps) {
  const toggleRarity = (rarity: string) => {
    const current = params.rarities ?? [];
    const next = current.includes(rarity) ? current.filter((r) => r !== rarity) : [...current, rarity];
    onChange({ ...params, rarities: next.length > 0 ? next : undefined });
  };

  const toggleTrait = (trait: string) => {
    const current = params.traits ?? [];
    const next = current.includes(trait) ? current.filter((t) => t !== trait) : [...current, trait];
    onChange({ ...params, traits: next.length > 0 ? next : undefined });
  };

  const toggleSource = (source: string) => {
    const current = params.sources ?? [];
    const next = current.includes(source) ? current.filter((s) => s !== source) : [...current, source];
    onChange({ ...params, sources: next.length > 0 ? next : undefined });
  };

  const toggleUsage = (cat: string) => {
    const current = params.usageCategories ?? [];
    const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
    onChange({ ...params, usageCategories: next.length > 0 ? next : undefined });
  };

  const setMagical = (value: boolean | null) => {
    onChange({ ...params, isMagical: params.isMagical === value ? null : value });
  };

  const setLevelRange = (values: number[]) => {
    onChange({
      ...params,
      levelMin: values[0] === 0 ? undefined : values[0],
      levelMax: values[1] === 28 ? undefined : values[1],
    });
  };

  const activeCount = useMemo(() => {
    let n = 0;
    if (params.rarities?.length) n += params.rarities.length;
    if (params.traits?.length) n += params.traits.length;
    if (params.sources?.length) n += params.sources.length;
    if (params.usageCategories?.length) n += params.usageCategories.length;
    if (params.isMagical != null) n += 1;
    if (params.levelMin != null || params.levelMax != null) n += 1;
    return n;
  }, [params]);

  const clearAll = () => {
    onChange({ keywords: params.keywords, sortBy: params.sortBy, sortDir: params.sortDir, limit: params.limit });
  };

  return (
    <div className="flex h-full flex-col border-r border-border bg-card" style={{ width: 220 }}>
      <div className="flex h-12 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <Label
            className="text-sm tracking-wide text-foreground"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
          >
            Filters
          </Label>
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearAll}>
            Clear
          </Button>
        )}
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {/* Rarity pills */}
          <div>
            <SectionLabel>Rarity</SectionLabel>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {RARITY_OPTS.map((r) => {
                const active = params.rarities?.includes(r) ?? false;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRarity(r)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs capitalize transition-colors',
                      active ? RARITY_ACTIVE[r] : RARITY_COLORS[r],
                    )}
                  >
                    {r.toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Level range */}
          <div>
            <div className="flex items-center justify-between">
              <SectionLabel>Level</SectionLabel>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {params.levelMin ?? 0} – {params.levelMax ?? 28}
              </span>
            </div>
            <Slider
              className="mt-2"
              min={0}
              max={28}
              step={1}
              value={[params.levelMin ?? 0, params.levelMax ?? 28]}
              onValueChange={setLevelRange}
            />
          </div>

          <Separator />

          {/* Magical / Mundane */}
          <div>
            <SectionLabel>Type</SectionLabel>
            <div className="mt-1.5 flex gap-1">
              <PillButton label="Magical" active={params.isMagical === true} onClick={() => setMagical(true)} />
              <PillButton label="Mundane" active={params.isMagical === false} onClick={() => setMagical(false)} />
            </div>
          </div>

          <Separator />

          {/* Usage categories */}
          {facets && facets.usageCategories.length > 0 && (
            <>
              <CheckboxGroup
                label="Usage"
                values={facets.usageCategories}
                selected={params.usageCategories ?? []}
                onToggle={toggleUsage}
              />
              <Separator />
            </>
          )}

          {/* Traits */}
          {facets && facets.traits.length > 0 && (
            <>
              <CollapsibleCheckboxGroup
                label="Traits"
                values={facets.traits}
                selected={params.traits ?? []}
                onToggle={toggleTrait}
                initiallyExpanded
                showCount={15}
              />
              <Separator />
            </>
          )}

          {/* Sources */}
          {facets && facets.sources.length > 0 && (
            <CollapsibleCheckboxGroup
              label="Source"
              values={facets.sources}
              selected={params.sources ?? []}
              onToggle={toggleSource}
              showCount={10}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label
      className="text-[10px] uppercase tracking-wider text-muted-foreground"
      style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
    >
      {children}
    </Label>
  );
}

function PillButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border border-border px-2 py-1 text-xs transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent',
      )}
    >
      {label}
    </button>
  );
}

function CheckboxGroup({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const selectedCount = selected.length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>{label}</SectionLabel>
        {selectedCount > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
            {selectedCount}
          </span>
        )}
      </div>
      <div className="space-y-1 pl-1">
        {values.map((v) => {
          const checked = selected.includes(v);
          const id = `filter-${label}-${v}`;
          return (
            <div key={v} className="flex items-center gap-2">
              <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(v)} />
              <label htmlFor={id} className="cursor-pointer text-xs text-foreground/90">
                {formatTraitLabel(v)}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollapsibleCheckboxGroup({
  label,
  values,
  selected,
  onToggle,
  initiallyExpanded = false,
  showCount = 10,
}: {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (v: string) => void;
  initiallyExpanded?: boolean;
  showCount?: number;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [showAll, setShowAll] = useState(false);
  const selectedCount = selected.length;
  const displayValues = showAll ? values : values.slice(0, showCount);
  const hasMore = values.length > showCount;

  return (
    <div>
      <button
        type="button"
        className="mb-2 flex w-full items-center justify-between"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <SectionLabel>{label}</SectionLabel>
        </div>
        {selectedCount > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
            {selectedCount}
          </span>
        )}
      </button>
      {expanded && (
        <div className="space-y-1 pl-1">
          {displayValues.map((v) => {
            const checked = selected.includes(v);
            const id = `filter-${label}-${v}`;
            return (
              <div key={v} className="flex items-center gap-2">
                <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(v)} />
                <label htmlFor={id} className="cursor-pointer text-xs text-foreground/90">
                  {formatTraitLabel(v)}
                </label>
              </div>
            );
          })}
          {hasMore && (
            <button
              type="button"
              className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll ? 'Show less' : `Show all ${values.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Title-case a trait/source label for display. */
function formatTraitLabel(raw: string): string {
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
