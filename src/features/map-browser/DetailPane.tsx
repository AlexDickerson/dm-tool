import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
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
  /** Anthropic API key from Settings. Required for the encounter-hook
   *  refresh button. Empty string disables the button (with a tooltip
   *  pointing the user back to settings). */
  anthropicApiKey?: string;
}

export function DetailPane({
  fileName,
  variants,
  onSelectVariant,
  onClose,
  anthropicApiKey = "",
}: DetailPaneProps) {
  const { data: detail, loading, error } = useMapDetail(fileName);
  const openInExplorer = useOpenInExplorer();

  // Local copy of the additional (AI-generated) hooks. We mirror the
  // value from detail when it loads so we can later swap it out in one
  // assignment after a regenerate, without re-fetching the whole detail
  // object. Reset whenever the user navigates to a different map.
  const [additionalHooks, setAdditionalHooks] = useState<string[]>([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  useEffect(() => {
    setAdditionalHooks(detail?.additionalEncounterHooks ?? []);
    setRegenError(null);
  }, [detail]);

  const handleRegenerate = async () => {
    if (!fileName || regenLoading) return;
    if (!anthropicApiKey) {
      setRegenError("Add an Anthropic API key in Settings first.");
      return;
    }
    setRegenLoading(true);
    setRegenError(null);
    try {
      const next = await api.regenerateEncounterHooks({
        fileName,
        apiKey: anthropicApiKey,
      });
      setAdditionalHooks(next);
    } catch (e) {
      setRegenError((e as Error).message);
    } finally {
      setRegenLoading(false);
    }
  };

  if (!fileName) return null;

  const hasVariantPanel =
    variants !== undefined && variants !== null && variants.length > 1 && !!onSelectVariant;

  return (
    <div className="flex h-full w-full min-w-0 flex-col border-l border-border bg-card">
      {/* Header now carries the map identity (title + filename + dims)
          instead of a generic "Details" label. The whole row is one
          baseline-aligned flex with the title shrink-0 (never truncates)
          and the filename truncating in the middle. Falls back to a
          spinner / placeholder while detail is loading. */}
      <div className="flex h-12 items-center justify-between gap-3 border-b border-border px-3">
        {detail ? (
          <div className="flex min-w-0 flex-1 items-baseline gap-3">
            <h2 className="shrink-0 text-base font-semibold leading-tight">
              {detail.title}
            </h2>
            <p
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}
              title={detail.fileName}
            >
              {detail.fileName}
            </p>
          </div>
        ) : (
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {loading ? "Loading…" : "Details"}
          </span>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

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
                  from pushing the metadata offscreen. Dimensions sit
                  in a small chip at the bottom-left, anchored to the
                  image container (which is `relative`). Inline style
                  for the chip's positioning so it doesn't depend on
                  Tailwind utilities that might not be in the JIT
                  bundle. */}
              <div className="relative overflow-hidden rounded-md border border-border bg-muted">
                <img
                  src={mapFileUrl(detail.fileName)}
                  alt={detail.title}
                  className="mx-auto h-auto max-h-[70vh] w-full object-contain"
                />
                <div
                  className="rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm"
                  style={{ position: "absolute", left: 8, bottom: 8 }}
                >
                  {detail.widthPx}×{detail.heightPx}
                </div>
                <button
                  type="button"
                  onClick={() => openInExplorer(detail.fileName)}
                  className="flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-black/85"
                  style={{ position: "absolute", right: 8, bottom: 8 }}
                  title="Show in folder"
                >
                  <ExternalLink className="h-3 w-3" />
                  Show in folder
                </button>
              </div>

              <EncounterHooksSection
                baseHooks={detail.encounterHooks}
                additionalHooks={additionalHooks}
                onRegenerate={handleRegenerate}
                regenLoading={regenLoading}
                regenError={regenError}
                hasApiKey={!!anthropicApiKey}
              />

            </div>
          )}
        </ScrollArea>

        {/* Variant column lives as a sibling of the main scroll area so
            it pins to the right edge and scrolls independently of the
            map details. Single column of full-width thumbs, fixed
            sidebar width. */}
        {detail && hasVariantPanel && (
          <VariantColumn
            variants={variants!}
            selected={fileName}
            onSelect={onSelectVariant!}
          />
        )}
      </div>
    </div>
  );
}

// Right-side variant column — fixed-width sidebar of full-width thumbs
// stacked vertically. Lives as a sibling of the main detail ScrollArea
// so it scrolls independently. Inline styles for sizing throughout
// because of the Tailwind JIT quirk in this project.
const VARIANT_COL_WIDTH = 168;
const VARIANT_THUMB_GAP = 8;
const VARIANT_THUMB_ASPECT = "4 / 3";

function VariantColumn({
  variants,
  selected,
  onSelect,
}: {
  variants: MapSummary[];
  selected: string | null;
  onSelect: (fileName: string) => void;
}) {
  return (
    <div
      className="flex shrink-0 flex-col border-l border-border bg-background/40"
      style={{ width: VARIANT_COL_WIDTH }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          In pack
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {variants.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col p-2" style={{ gap: VARIANT_THUMB_GAP }}>
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

// Encounter hooks panel. Renders the additional (AI-generated) hooks at
// the top of the list and the base sidecar hooks below, separated by a
// faint divider when both are present. The list itself scrolls inside a
// max-height container so the regenerate button stays in view as the
// list grows. Inline styles for max-height because the JIT pipeline in
// this project sometimes drops freshly-introduced max-h utilities.
function EncounterHooksSection({
  baseHooks,
  additionalHooks,
  onRegenerate,
  regenLoading,
  regenError,
  hasApiKey,
}: {
  baseHooks: string[];
  additionalHooks: string[];
  onRegenerate: () => void;
  regenLoading: boolean;
  regenError: string | null;
  hasApiKey: boolean;
}) {
  const hasAny = baseHooks.length > 0 || additionalHooks.length > 0;

  return (
    <>
      <Separator />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Encounter hooks
          </h3>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenLoading}
            title={
              hasApiKey
                ? "Generate 3 new encounter hooks via Claude"
                : "Add an Anthropic API key in Settings to use this"
            }
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              regenLoading && "cursor-not-allowed opacity-60",
            )}
          >
            {regenLoading ? (
              <Loader2
                className="h-3.5 w-3.5"
                style={{ animation: "dmtool-spin 1s linear infinite" }}
              />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        {regenError && (
          <p className="mb-2 text-[11px] leading-snug text-destructive">
            {regenError}
          </p>
        )}
        {!hasAny && !regenLoading && (
          <p className="text-xs text-muted-foreground">
            No encounter hooks yet. Click the refresh icon to generate some.
          </p>
        )}
        {hasAny && (
          <div
            className="overflow-y-auto pr-1"
            style={{ maxHeight: 280 }}
          >
            <ul className="space-y-1.5 text-sm text-foreground/90">
              {additionalHooks.map((h, i) => (
                <HookListItem key={`add-${i}`} text={h} accent />
              ))}
              {additionalHooks.length > 0 && baseHooks.length > 0 && (
                <li
                  aria-hidden
                  style={{
                    height: 1,
                    background: "hsl(var(--border))",
                    margin: "6px 0",
                  }}
                />
              )}
              {baseHooks.map((h, i) => (
                <HookListItem key={`base-${i}`} text={h} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

// Single bullet row. The bullet vertical-alignment trick (inline-flex
// wrapper sized to leading-snug line-height) survives the JIT quirk
// because the height is hard-coded in em units. The `accent` flag
// brightens the bullet for AI-generated hooks so the user can tell at a
// glance which ones are fresh.
function HookListItem({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <li className="flex gap-2 leading-snug">
      <span
        className="shrink-0"
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: "1.375em",
        }}
      >
        <span
          className={accent ? "rounded-full bg-primary" : "rounded-full bg-primary/60"}
          style={{ width: 4, height: 4 }}
        />
      </span>
      <span>{text}</span>
    </li>
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
        "relative overflow-hidden rounded border border-border bg-muted transition-all hover:border-primary/60",
        isSelected && "border-primary ring-2 ring-primary/40",
      )}
      style={{ width: "100%", aspectRatio: VARIANT_THUMB_ASPECT }}
    >
      <img
        src={thumbnailUrl(variant.fileName)}
        alt={variant.title}
        loading="lazy"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </button>
  );
}

