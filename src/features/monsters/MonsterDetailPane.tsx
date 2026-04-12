import { useState } from 'react';
import { ExternalLink, Image, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import type { MonsterDetail } from '@shared/types';

const RARITY_BADGE: Record<string, string> = {
  common: 'bg-zinc-600 text-zinc-100',
  uncommon: 'bg-amber-700 text-amber-100',
  rare: 'bg-blue-700 text-blue-100',
  unique: 'bg-purple-700 text-purple-100',
};

interface Props {
  detail: MonsterDetail;
  onOpenExternal: (url: string) => void;
}

export function MonsterDetailPane({ detail, onOpenExternal }: Props) {
  const mod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{detail.name}</h3>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
          Lvl {detail.level}
        </span>
      </div>

      {/* Art + Token hover previews */}
      {(detail.imageUrl || detail.tokenUrl) && (
        <div className="flex items-center gap-2">
          {detail.imageUrl && <ImageThumb src={detail.imageUrl} label="Art" icon={<Image className="h-3.5 w-3.5" />} />}
          {detail.tokenUrl && (
            <ImageThumb src={detail.tokenUrl} label="Token" icon={<User className="h-3.5 w-3.5" />} />
          )}
        </div>
      )}

      {/* Rarity + Size + Traits */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
            RARITY_BADGE[detail.rarity.toLowerCase()] ?? 'bg-zinc-600 text-zinc-100',
          )}
        >
          {detail.rarity}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize">{detail.size}</span>
        {detail.traits.map((t) => (
          <span key={t} className="rounded border border-border px-1.5 py-0.5 text-[10px] capitalize">
            {t}
          </span>
        ))}
      </div>

      <Separator />

      {/* Ability scores */}
      <section>
        <SectionLabel>Ability Modifiers</SectionLabel>
        <div className="grid grid-cols-6 gap-2">
          {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => (
            <div key={a} className="text-center">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">{a}</div>
              <div className="text-sm font-medium tabular-nums">{mod(detail[a])}</div>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* Defenses */}
      <section>
        <SectionLabel>Defenses</SectionLabel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <Stat label="AC" value={String(detail.ac)} />
          <Stat label="HP" value={String(detail.hp)} />
          <Stat label="Fort" value={mod(detail.fort)} />
          <Stat label="Ref" value={mod(detail.ref)} />
          <Stat label="Will" value={mod(detail.will)} />
          <Stat label="Perception" value={mod(detail.perception)} />
        </div>
      </section>

      {(detail.immunities || detail.weaknesses || detail.resistances) && (
        <section className="space-y-1 text-xs">
          {detail.immunities && <Stat label="Immunities" value={detail.immunities} />}
          {detail.weaknesses && <Stat label="Weaknesses" value={detail.weaknesses} />}
          {detail.resistances && <Stat label="Resistances" value={detail.resistances} />}
        </section>
      )}

      <Separator />

      {/* Speed + Skills */}
      <section className="space-y-1 text-xs">
        <Stat label="Speed" value={detail.speed} />
        {detail.skills && <Stat label="Skills" value={detail.skills} />}
      </section>

      {/* Attacks */}
      {(detail.melee || detail.ranged) && (
        <>
          <Separator />
          <section>
            <SectionLabel>Attacks</SectionLabel>
            <div className="space-y-1.5 text-xs">
              {detail.melee && (
                <div>
                  <span className="font-semibold">Melee </span>
                  {detail.melee}
                </div>
              )}
              {detail.ranged && (
                <div>
                  <span className="font-semibold">Ranged </span>
                  {detail.ranged}
                </div>
              )}
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
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{detail.abilities}</pre>
          </section>
        </>
      )}

      {/* Description */}
      {detail.description && (
        <>
          <Separator />
          <section>
            <SectionLabel>Description</SectionLabel>
            <p className="text-xs leading-relaxed text-muted-foreground">{detail.description}</p>
          </section>
        </>
      )}

      {/* Source + AoN link */}
      <Separator />
      <div className="flex items-center justify-between">
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
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-semibold text-foreground">{label} </span>
      <span className="text-foreground/80">{value}</span>
    </div>
  );
}

function ImageThumb({ src, label, icon }: { src: string; label: string; icon: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (imgError) return null;

  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <div className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-border bg-muted text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
        {icon}
      </div>
      <span className="mt-0.5 block text-center text-[9px] text-muted-foreground">{label}</span>
      {show && (
        <div
          className="absolute left-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
          style={{ width: 280 }}
        >
          <img
            src={src}
            alt={label}
            className="h-auto w-full object-contain"
            style={{ maxHeight: 400 }}
            onError={() => setImgError(true)}
          />
        </div>
      )}
    </div>
  );
}
