import { ExternalLink, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cleanFoundryMarkup } from '@/lib/foundry-markup';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { MonsterDetail } from '@dm-tool/shared/types';

const RARITY_BADGE: Record<string, string> = {
  common: 'bg-zinc-600 text-zinc-100',
  uncommon: 'bg-amber-700 text-amber-100',
  rare: 'bg-blue-700 text-blue-100',
  unique: 'bg-purple-700 text-purple-100',
};

interface Props {
  detail: MonsterDetail;
  loading: boolean;
  onOpenExternal: (url: string) => void;
  onClose: () => void;
}

export function MonsterDetailPane({ detail, loading, onOpenExternal, onClose }: Props) {
  const mod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  return (
    <>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="shrink-0 text-sm font-semibold">{detail.name}</h2>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
          Lvl {detail.level}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
            RARITY_BADGE[detail.rarity.toLowerCase()] ?? 'bg-zinc-600 text-zinc-100',
          )}
        >
          {detail.rarity}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize">{detail.size}</span>
        {detail.traits.map((t) => (
          <span key={t} className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] capitalize">
            {t}
          </span>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left stat column */}
          <div className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-border py-3 text-[10px]">
            <StatCell label="AC" value={String(detail.ac)} />
            <StatCell label="HP" value={String(detail.hp)} />
            <Separator className="w-8" />
            <StatCell label="Fort" value={mod(detail.fort)} />
            <StatCell label="Ref" value={mod(detail.ref)} />
            <StatCell label="Will" value={mod(detail.will)} />
            <StatCell label="Perc" value={mod(detail.perception)} />
            <Separator className="w-8" />
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => (
              <StatCell key={a} label={a.toUpperCase()} value={mod(detail[a])} />
            ))}
          </div>

          {/* Right content */}
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <div className="space-y-4 p-4">
              {/* Description */}
              {detail.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">{detail.description}</p>
              )}

              {/* Speed, Skills, Immunities/Weaknesses/Resistances */}
              <div className="space-y-1 text-xs">
                <Stat label="Speed" value={detail.speed} />
                {detail.skills && <Stat label="Skills" value={formatSkills(detail.skills)} />}
                {detail.immunities && <Stat label="Immunities" value={detail.immunities} />}
                {detail.weaknesses && <Stat label="Weaknesses" value={detail.weaknesses} />}
                {detail.resistances && <Stat label="Resistances" value={detail.resistances} />}
              </div>

              {/* Attacks */}
              {(detail.melee || detail.ranged) && (
                <>
                  <Separator />
                  <section>
                    <SectionLabel>Attacks</SectionLabel>
                    <div className="space-y-1.5 text-xs">
                      {detail.melee &&
                        cleanFoundryMarkup(detail.melee)
                          .split(';')
                          .map((a) => a.trim())
                          .filter(Boolean)
                          .map((a, i) => (
                            <div key={`m${i}`}>
                              <span className="font-semibold text-muted-foreground">Melee </span>
                              {a}
                            </div>
                          ))}
                      {detail.ranged &&
                        cleanFoundryMarkup(detail.ranged)
                          .split(';')
                          .map((a) => a.trim())
                          .filter(Boolean)
                          .map((a, i) => (
                            <div key={`r${i}`}>
                              <span className="font-semibold text-muted-foreground">Ranged </span>
                              {a}
                            </div>
                          ))}
                    </div>
                  </section>
                </>
              )}

              {/* Abilities */}
              {detail.abilities && (
                <>
                  <Separator />
                  <section>
                    <SectionLabel>Abilities</SectionLabel>
                    <AbilityBlock text={detail.abilities} />
                  </section>
                </>
              )}

              {/* Full art */}
              {detail.imageUrl && (
                <>
                  <Separator />
                  <img src={detail.imageUrl} alt={detail.name} className="w-full rounded-md object-contain" />
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Source + AoN link — pinned to bottom */}
      {!loading && (
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-1.5">
          <span className="text-[11px] text-muted-foreground">{detail.source}</span>
          {detail.aonUrl && (
            <button
              type="button"
              onClick={() => onOpenExternal(detail.aonUrl)}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Archives of Nethys
            </button>
          )}
        </div>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
  );
}

function formatSkills(raw: string): string {
  try {
    const obj: Record<string, number> = JSON.parse(raw);
    return Object.entries(obj)
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)} ${v >= 0 ? '+' : ''}${v}`)
      .join(', ');
  } catch {
    return raw;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-semibold text-foreground">{label} </span>
      <span className="text-foreground/80">{value}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className="font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Render ability text as formatted blocks with separators. */
function AbilityBlock({ text }: { text: string }) {
  const cleaned = cleanFoundryMarkup(text);
  const lines = cleaned.split('\n');

  return (
    <div className="space-y-2 text-xs leading-relaxed text-foreground/90">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return null;
        if (/^-{3,}$/.test(line)) return <Separator key={i} />;

        // Detect ability name: optional action glyphs, then Title-Case words
        // before a parenthetical trait list or a sentence continuation.
        const m = line.match(/^(◆{1,3}\s*)?([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*(?:\s+\d+)?)\s*(.*)/);
        if (m) {
          const [, actions, name, rest] = m;
          return (
            <p key={i}>
              {actions && <span className="text-foreground/50">{actions}</span>}
              <span className="font-semibold">{name}</span>
              {rest && ` ${rest}`}
            </p>
          );
        }

        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}
