import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn, mapFileUrl, thumbnailUrl } from "@/lib/utils";
import type { MapSummary } from "@shared/types";
import { useMapDetail, useOpenInExplorer } from "./useMaps";

interface DetailPaneProps {
  fileName: string | null;
  /** All variants in the same pack as `fileName`. When provided and the
   *  pack has more than one member, we render a dedicated variant panel
   *  on the right so sibling maps can be browsed without closing the
   *  pane. */
  variants?: MapSummary[] | null;
  onSelectVariant?: (fileName: string) => void;
  onClose: () => void;
}

export function DetailPane({
  fileName,
  variants,
  onSelectVariant,
  onClose,
}: DetailPaneProps) {
  const { data: detail, loading, error } = useMapDetail(fileName);
  const openInExplorer = useOpenInExplorer();

  if (!fileName) return null;

  const hasVariantPanel =
    variants !== undefined && variants !== null && variants.length > 1 && !!onSelectVariant;

  return (
    <div className="flex h-full w-full min-w-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Details
        </span>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Main two-column area: image + metadata on the left, variant
          browser on the right (only when the pack has siblings). */}
      <div className="flex min-h-0 flex-1">
        <ScrollArea className="min-w-0 flex-1">
          {loading && (
            <div className="p-4 text-xs text-muted-foreground">Loading…</div>
          )}
          {error && (
            <div className="p-4 text-xs text-destructive">Error: {error}</div>
          )}
          {detail && (
            <div className="space-y-4 p-4">
              {/* The image gets whatever width the detail pane has
                  (which is large now that the grid rail is narrow).
                  object-contain on a max-height keeps very tall maps
                  from pushing the metadata offscreen. */}
              <div className="overflow-hidden rounded-md border border-border bg-muted">
                <img
                  src={mapFileUrl(detail.fileName)}
                  alt={detail.title}
                  className="mx-auto h-auto max-h-[70vh] w-full object-contain"
                />
              </div>

              <div>
                <h2 className="text-lg font-semibold leading-tight">
                  {detail.title}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {detail.fileName}
                </p>
              </div>

              <p className="text-sm leading-relaxed text-foreground/90">
                {detail.description}
              </p>

              <Separator />

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                <Metadata label="Dimensions">
                  {detail.widthPx} × {detail.heightPx}px
                </Metadata>
                {detail.gridCells && (
                  <Metadata label="Grid">{detail.gridCells}</Metadata>
                )}
                {detail.gridVisible && detail.gridVisible !== "unknown" && (
                  <Metadata label="Grid visible">{detail.gridVisible}</Metadata>
                )}
                {detail.interiorExterior && detail.interiorExterior !== "unknown" && (
                  <Metadata label="Indoor/outdoor">
                    {detail.interiorExterior}
                  </Metadata>
                )}
                {detail.timeOfDay && detail.timeOfDay !== "unknown" && (
                  <Metadata label="Time of day">{detail.timeOfDay}</Metadata>
                )}
                {detail.approxPartyScale && (
                  <Metadata label="Party scale">{detail.approxPartyScale}</Metadata>
                )}
              </dl>

              {detail.biomes.length > 0 && (
                <TagRow label="Biomes" tags={detail.biomes} />
              )}
              {detail.locationTypes.length > 0 && (
                <TagRow label="Locations" tags={detail.locationTypes} />
              )}
              {detail.mood.length > 0 && <TagRow label="Mood" tags={detail.mood} />}
              {detail.features.length > 0 && (
                <TagRow label="Features" tags={detail.features} />
              )}

              {detail.encounterHooks.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Encounter hooks
                    </h3>
                    <ul className="space-y-1.5 text-sm text-foreground/90">
                      {detail.encounterHooks.map((h, i) => (
                        <li key={i} className="leading-snug">
                          – {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              <Separator />

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => openInExplorer(detail.fileName)}
              >
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Show in folder
              </Button>
            </div>
          )}
        </ScrollArea>

        {hasVariantPanel && (
          <VariantPanel
            variants={variants!}
            selected={fileName}
            onSelect={onSelectVariant!}
          />
        )}
      </div>
    </div>
  );
}

function Metadata({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </>
  );
}

// Right-side variant browser. A fixed-width vertical panel with a
// wrapping grid of larger thumbnails so a 70-variant pack is actually
// scannable. Not virtualized — worst case is ~70 small images, which is
// nothing; if a future pack dwarfs that we can virtualize.
function VariantPanel({
  variants,
  selected,
  onSelect,
}: {
  variants: MapSummary[];
  selected: string | null;
  onSelect: (fileName: string) => void;
}) {
  // Extract a short variant label from the filename by stripping the
  // pack prefix chunk. This is cosmetic — the thumb + hover tooltip
  // carry the full filename, this just helps scanning.
  return (
    // min-h-0 on the flex column is load-bearing: without it, the
    // inner ScrollArea's flex-1 resolves to min-content (i.e. "as tall
    // as the grid") and the scrollbar never engages. With it, flex-1
    // is bounded by the parent's height and overflow kicks in.
    <div className="flex w-52 min-h-0 shrink-0 flex-col border-l border-border bg-background/50">
      <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Variants in pack ({variants.length})
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-3 gap-1.5 p-2">
          {variants.map((v) => (
            <VariantThumb
              key={v.fileName}
              variant={v}
              isSelected={v.fileName === selected}
              onClick={() => onSelect(v.fileName)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function VariantThumb({
  variant,
  isSelected,
  onClick,
}: {
  variant: MapSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={variant.fileName}
      className={cn(
        "relative aspect-[4/3] overflow-hidden rounded border border-border bg-muted transition-all hover:border-primary/60",
        isSelected && "border-primary ring-2 ring-primary/40",
      )}
    >
      <img
        src={thumbnailUrl(variant.fileName)}
        alt={variant.title}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </button>
  );
}

function TagRow({ label, tags }: { label: string; tags: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span
            key={t}
            className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
