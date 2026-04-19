// Compact stat block pinned to the right of the combat tab. Always renders
// the current actor — monsters pull their full detail from the DB; PCs show
// just name + HP (no stat block available). Kept visually close to
// MonsterDetailPane but without the header bar / close button.

import { useEffect, useState } from 'react';
import { ExternalLink, Heart, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { cleanFoundryMarkup } from '@/lib/foundry-markup';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { Combatant, MonsterDetail } from '@dm-tool/shared/types';

const RARITY_BADGE: Record<string, string> = {
  common: 'bg-zinc-600 text-zinc-100',
  uncommon: 'bg-amber-700 text-amber-100',
  rare: 'bg-blue-700 text-blue-100',
  unique: 'bg-purple-700 text-purple-100',
};

interface Props {
  combatant: Combatant | null;
  round: number;
}

export function CombatantStatBlock({ combatant, round }: Props) {
  const [detail, setDetail] = useState<MonsterDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!combatant || combatant.kind !== 'monster' || !combatant.monsterName) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .monstersGetDetail(combatant.monsterName)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => console.error('monstersGetDetail failed:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [combatant]);

  if (!combatant) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        No current actor. Roll initiative to begin.
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 12px',
          borderBottom: '1px solid hsl(var(--border))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Current turn</span>
          <span className="text-[10px] text-muted-foreground">· Round {round}</span>
        </div>
        <h2 className="truncate text-sm font-semibold">{combatant.displayName}</h2>
        <HpBar hp={combatant.hp} maxHp={combatant.maxHp} />
      </div>

      {combatant.kind === 'pc' ? (
        <PcBody combatant={combatant} />
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading stat block…</div>
      ) : detail ? (
        <MonsterBody detail={detail} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          Stat block unavailable.
          {combatant.monsterName && (
            <>
              <br />
              <span className="text-[10px]">({combatant.monsterName})</span>
            </>
          )}
        </div>
      )}
    </>
  );
}

function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  const color = pct > 60 ? '#4ade80' : pct > 30 ? '#facc15' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Heart className="h-3 w-3" style={{ color }} />
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          backgroundColor: 'hsl(var(--muted))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: color,
            transition: 'width 200ms ease-out',
          }}
        />
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {hp}/{maxHp}
      </span>
    </div>
  );
}

function PcBody({ combatant }: { combatant: Combatant }) {
  return (
    <div className="flex flex-1 flex-col gap-3 p-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5" />
        <span>
          Initiative mod {combatant.initiativeMod >= 0 ? '+' : ''}
          {combatant.initiativeMod}
          {combatant.initiative != null && (
            <>
              {' · rolled '}
              <span className="font-medium text-foreground">{combatant.initiative}</span>
            </>
          )}
        </span>
      </div>
      <p className="text-[11px] italic">
        PCs don&rsquo;t have a stored stat block — consult the player&rsquo;s character sheet.
      </p>
    </div>
  );
}

function MonsterBody({ detail }: { detail: MonsterDetail }) {
  const mod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    <>
      {/* Traits + AC/HP summary */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid hsl(var(--border))',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
        }}
      >
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
          Lvl {detail.level}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
            RARITY_BADGE[detail.rarity.toLowerCase()] ?? 'bg-zinc-600 text-zinc-100',
          )}
        >
          {detail.rarity}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize">{detail.size}</span>
        {detail.traits.slice(0, 6).map((t) => (
          <span key={t} className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[9px] capitalize">
            {t}
          </span>
        ))}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, fontSize: 11 }}>
            <StatCell label="AC" value={String(detail.ac)} />
            <StatCell label="HP" value={String(detail.hp)} />
            <StatCell label="Perc" value={mod(detail.perception)} />
            <StatCell label="Fort" value={mod(detail.fort)} />
            <StatCell label="Ref" value={mod(detail.ref)} />
            <StatCell label="Will" value={mod(detail.will)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, fontSize: 10 }}>
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => (
              <StatCell key={a} label={a.toUpperCase()} value={mod(detail[a])} />
            ))}
          </div>

          {/* Speed + conditions */}
          <div className="space-y-0.5 text-xs">
            <Line label="Speed" value={detail.speed} />
            {detail.skills && <Line label="Skills" value={formatSkills(detail.skills)} />}
            {detail.immunities && <Line label="Immunities" value={detail.immunities} />}
            {detail.weaknesses && <Line label="Weaknesses" value={detail.weaknesses} />}
            {detail.resistances && <Line label="Resistances" value={detail.resistances} />}
          </div>

          {/* Attacks */}
          {(detail.melee || detail.ranged) && (
            <>
              <Separator />
              <section>
                <SectionLabel>Attacks</SectionLabel>
                <div className="space-y-1 text-xs">
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

          {/* Portrait — pf2e-db serves this via the monster-file:// protocol.
              object-contain so tall portraits don't get squashed and wide
              ones don't overflow the resizable panel. */}
          {detail.imageUrl && (
            <>
              <Separator />
              <img
                src={detail.imageUrl}
                alt={detail.name}
                className="w-full rounded-md object-contain"
                style={{ maxHeight: 360 }}
              />
            </>
          )}

          {/* Archives of Nethys link — opens in the user's default browser
              via the main process's openExternal handler. */}
          {detail.aonUrl && (
            <button
              type="button"
              onClick={() => {
                void api.openExternal(detail.aonUrl);
              }}
              className="flex items-center gap-1.5 self-start text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Archives of Nethys
            </button>
          )}
        </div>
      </ScrollArea>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;
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

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-semibold text-foreground">{label} </span>
      <span className="text-foreground/80">{value}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '4px 2px',
        borderRadius: 4,
        backgroundColor: 'hsl(var(--muted) / 0.4)',
      }}
    >
      <span className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="mt-0.5 text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

function AbilityBlock({ text }: { text: string }) {
  const cleaned = cleanFoundryMarkup(text);
  const lines = cleaned.split('\n');

  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-foreground/90">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return null;
        if (/^-{3,}$/.test(line)) return <Separator key={i} />;
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
