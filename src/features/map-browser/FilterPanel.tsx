import { useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  Facets,
  GridVisible,
  InteriorExterior,
  SearchParams,
  TimeOfDay,
} from "@shared/types";

interface FilterPanelProps {
  facets: Facets | null;
  params: SearchParams;
  onChange: (next: SearchParams) => void;
}

const INTERIOR_OPTS: Array<{ value: InteriorExterior; label: string }> = [
  { value: "interior", label: "Interior" },
  { value: "exterior", label: "Exterior" },
  { value: "mixed", label: "Mixed" },
];

const TIME_OPTS: Array<{ value: TimeOfDay; label: string }> = [
  { value: "day", label: "Day" },
  { value: "dusk", label: "Dusk" },
  { value: "night", label: "Night" },
  { value: "dawn", label: "Dawn" },
];

const GRID_OPTS: Array<{ value: GridVisible; label: string }> = [
  { value: "gridded", label: "Gridded" },
  { value: "gridless", label: "Gridless" },
];

export function FilterPanel({ facets, params, onChange }: FilterPanelProps) {
  // Stable update helpers — each produces a new params object with one
  // field flipped. Callers use these in event handlers.
  const toggleTag = (
    field: "biomes" | "locationTypes" | "mood" | "features",
    value: string,
  ) => {
    const current = params[field] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...params, [field]: next.length > 0 ? next : undefined });
  };

  const setAxis = <K extends "interiorExterior" | "timeOfDay" | "gridVisible">(
    field: K,
    value: SearchParams[K] | undefined,
  ) => {
    onChange({ ...params, [field]: params[field] === value ? undefined : value });
  };

  const activeCount = useMemo(() => {
    let n = 0;
    if (params.biomes?.length) n += params.biomes.length;
    if (params.locationTypes?.length) n += params.locationTypes.length;
    if (params.mood?.length) n += params.mood.length;
    if (params.features?.length) n += params.features.length;
    if (params.interiorExterior) n += 1;
    if (params.timeOfDay) n += 1;
    if (params.gridVisible) n += 1;
    return n;
  }, [params]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Filters {activeCount > 0 && <span>({activeCount})</span>}
        </Label>
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() =>
              onChange({ keywords: params.keywords, limit: params.limit })
            }
          >
            Clear
          </Button>
        )}
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <AxisGroup
            label="Indoor/outdoor"
            options={INTERIOR_OPTS}
            selected={params.interiorExterior}
            onSelect={(v) => setAxis("interiorExterior", v)}
          />
          <AxisGroup
            label="Time of day"
            options={TIME_OPTS}
            selected={params.timeOfDay}
            onSelect={(v) => setAxis("timeOfDay", v)}
          />
          <AxisGroup
            label="Grid"
            options={GRID_OPTS}
            selected={params.gridVisible}
            onSelect={(v) => setAxis("gridVisible", v)}
          />

          <Separator />

          <TagGroup
            label="Biomes"
            values={facets?.biomes ?? []}
            selected={params.biomes ?? []}
            onToggle={(v) => toggleTag("biomes", v)}
          />
          <TagGroup
            label="Locations"
            values={facets?.locationTypes ?? []}
            selected={params.locationTypes ?? []}
            onToggle={(v) => toggleTag("locationTypes", v)}
          />
          <TagGroup
            label="Mood"
            values={facets?.moods ?? []}
            selected={params.mood ?? []}
            onToggle={(v) => toggleTag("mood", v)}
          />
          <TagGroup
            label="Features"
            values={facets?.features ?? []}
            selected={params.features ?? []}
            onToggle={(v) => toggleTag("features", v)}
            collapsible
          />
        </div>
      </ScrollArea>
    </div>
  );
}

interface AxisGroupProps<T extends string> {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T | undefined;
  onSelect: (value: T) => void;
}

function AxisGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: AxisGroupProps<T>) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-semibold">{label}</Label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={cn(
                "rounded-md border border-border px-2 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface TagGroupProps {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
  /** If true, only show the first N values until expanded. Useful for
   *  the `features` list which can be long. */
  collapsible?: boolean;
}

function TagGroup({
  label,
  values,
  selected,
  onToggle,
  collapsible = false,
}: TagGroupProps) {
  if (values.length === 0) return null;

  // For the MVP we don't bother with an expand/collapse mechanism. If a
  // list is genuinely long we cap it at 50 visible items — that's enough
  // to browse. If the user needs more they can search by keyword.
  const visible = collapsible ? values.slice(0, 50) : values;

  return (
    <div>
      <Label className="mb-1.5 block text-xs font-semibold">{label}</Label>
      <div className="space-y-1">
        {visible.map((v) => {
          const checked = selected.includes(v);
          const id = `tag-${label}-${v}`;
          return (
            <div key={v} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={() => onToggle(v)}
              />
              <label
                htmlFor={id}
                className="cursor-pointer text-xs text-foreground/90"
              >
                {v}
              </label>
            </div>
          );
        })}
        {collapsible && values.length > visible.length && (
          <p className="pt-1 text-[10px] text-muted-foreground">
            + {values.length - visible.length} more (use keyword search)
          </p>
        )}
      </div>
    </div>
  );
}
