import { Loader2, RefreshCw } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface EncounterHooksSectionProps {
  baseHooks: string[];
  additionalHooks: string[];
  onRegenerate: () => void;
  regenLoading: boolean;
  regenError: string | null;
  hasApiKey: boolean;
}

// Encounter hooks panel. Renders the additional (AI-generated) hooks at
// the top of the list and the base sidecar hooks below, separated by a
// faint divider when both are present. The list itself scrolls inside a
// max-height container so the regenerate button stays in view as the
// list grows. Inline styles for max-height because the JIT pipeline in
// this project sometimes drops freshly-introduced max-h utilities.
export function EncounterHooksSection({
  baseHooks,
  additionalHooks,
  onRegenerate,
  regenLoading,
  regenError,
  hasApiKey,
}: EncounterHooksSectionProps) {
  const hasAny = baseHooks.length > 0 || additionalHooks.length > 0;

  return (
    <>
      <Separator />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Encounter hooks</h3>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenLoading}
            title={
              hasApiKey
                ? 'Generate 3 new encounter hooks via Claude'
                : 'Add an Anthropic API key in Settings to use this'
            }
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              regenLoading && 'cursor-not-allowed opacity-60',
            )}
          >
            {regenLoading ? (
              <Loader2 className="h-3.5 w-3.5" style={{ animation: 'dmtool-spin 1s linear infinite' }} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        {regenError && <p className="mb-2 text-[11px] leading-snug text-destructive">{regenError}</p>}
        {!hasAny && !regenLoading && (
          <p className="text-xs text-muted-foreground">
            No encounter hooks yet. Click the refresh icon to generate some.
          </p>
        )}
        {hasAny && (
          <div className="overflow-y-auto pr-1" style={{ maxHeight: 280 }}>
            <ul className="space-y-1.5 text-sm text-foreground/90">
              {additionalHooks.map((h, i) => (
                <HookListItem key={`add-${i}`} text={h} accent />
              ))}
              {additionalHooks.length > 0 && baseHooks.length > 0 && (
                <li
                  aria-hidden
                  style={{
                    height: 1,
                    background: 'hsl(var(--border))',
                    margin: '6px 0',
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
          display: 'inline-flex',
          alignItems: 'center',
          height: '1.375em',
        }}
      >
        <span
          className={accent ? 'rounded-full bg-primary' : 'rounded-full bg-primary/60'}
          style={{ width: 4, height: 4 }}
        />
      </span>
      <span>{text}</span>
    </li>
  );
}
