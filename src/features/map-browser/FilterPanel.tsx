import { useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { cn, formatTag } from '@/lib/utils';
import type { Facets, InteriorExterior, SearchParams, TimeOfDay } from '@shared/types';

interface FilterPanelProps {
  facets: Facets | null;
  params: SearchParams;
  onChange: (next: SearchParams) => void;
}

const INTERIOR_OPTS: Array<{ value: InteriorExterior; label: string }> = [
  { value: 'interior', label: 'Interior' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'mixed', label: 'Mixed' },
];

const TIME_OPTS: Array<{ value: TimeOfDay; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'night', label: 'Night' },
  { value: 'dawn', label: 'Dawn' },
];

// Note: there is no GRID_OPTS / Gridded vs Gridless filter row anymore.
// Grid presence is a per-map toggle in the detail pane (see DetailPane's
// grid counterpart button) — applying it as a global filter hid half of
// every pack, which is the opposite of what the user usually wants when
// browsing.

export function FilterPanel({ facets, params, onChange }: FilterPanelProps) {
  // Stable update helpers — each produces a new params object with one
  // field flipped. Callers use these in event handlers.
  const toggleTag = (field: 'biomes' | 'locationTypes', value: string) => {
    const current = params[field] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...params, [field]: next.length > 0 ? next : undefined });
  };

  const setAxis = <K extends 'interiorExterior' | 'timeOfDay'>(field: K, value: SearchParams[K] | undefined) => {
    onChange({ ...params, [field]: params[field] === value ? undefined : value });
  };

  const activeCount = useMemo(() => {
    let n = 0;
    if (params.biomes?.length) n += params.biomes.length;
    if (params.locationTypes?.length) n += params.locationTypes.length;
    if (params.interiorExterior) n += 1;
    if (params.timeOfDay) n += 1;
    return n;
  }, [params]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      {/* Fixed row height — without it, the row grows when the Clear
          button appears (the button is taller than the label alone) and
          every filter below visibly shifts down. Header upgraded from
          tiny uppercase muted to a proper section title; the active
          count moves into a primary-tinted chip so it reads as a state
          indicator instead of a parenthetical. */}
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
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ keywords: params.keywords, limit: params.limit })}
          >
            Clear
          </Button>
        )}
      </div>
      <Separator variant="ornate" />
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <div className="flex flex-wrap gap-1">
            {INTERIOR_OPTS.map((opt) => (
              <PillButton
                key={opt.value}
                label={opt.label}
                active={params.interiorExterior === opt.value}
                onClick={() => setAxis('interiorExterior', opt.value)}
              />
            ))}
            {TIME_OPTS.map((opt) => (
              <PillButton
                key={opt.value}
                label={opt.label}
                active={params.timeOfDay === opt.value}
                onClick={() => setAxis('timeOfDay', opt.value)}
              />
            ))}
          </div>

          <Separator />

          {/* Biomes and Locations sit side-by-side in a 2-column grid so
              the two longest checkbox lists aren't stacked in a single
              tall column. gap-x keeps them visually separate; each column
              still scrolls with the outer ScrollArea. */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <TagGroup
              label="Locations"
              values={facets?.locationTypes ?? []}
              selected={params.locationTypes ?? []}
              onToggle={(v) => toggleTag('locationTypes', v)}
            />
            <TagGroup
              label="Biomes"
              values={facets?.biomes ?? []}
              selected={params.biomes ?? []}
              onToggle={(v) => toggleTag('biomes', v)}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
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

interface TagGroupProps {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
}

function TagGroup({ label, values, selected, onToggle }: TagGroupProps) {
  if (values.length === 0) return null;

  // Section header gets a hairline rule above it and the count of
  // selected items as a tiny primary chip. Children indent slightly so
  // the eye can see where one section's items end and the next begins.
  const selectedCount = selected.length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between border-t border-border pt-2">
        <Label
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
        >
          {label}
        </Label>
        {selectedCount > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
            {selectedCount}
          </span>
        )}
      </div>
      <div className="space-y-1 pl-1">
        {values.map((v) => {
          const checked = selected.includes(v);
          const id = `tag-${label}-${v}`;
          return (
            <div key={v} className="flex items-center gap-2">
              <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(v)} />
              <label htmlFor={id} className="cursor-pointer text-xs text-foreground/90">
                {formatTag(v)}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
