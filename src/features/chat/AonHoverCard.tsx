import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AonPreviewData, AonCreaturePreview } from '../../../shared/types';

// Simple in-memory cache so repeated hovers don't re-fetch.
const cache = new Map<string, AonPreviewData | null>();

// --- PF2e action glyphs -----------------------------------------------------

const ACTION_MAP: Record<string, string> = {
  'Single Action': '◆',
  'Two Actions': '◆◆',
  'Three Actions': '◆◆◆',
  'Free Action': '◇',
  Reaction: '⟳',
};

/** Replace action text with unicode glyphs. */
function renderActionIcons(text: string): string {
  return text.replace(/Single Action|Two Actions|Three Actions|Free Action|Reaction/g, (m) => ACTION_MAP[m] ?? m);
}

function extractAonPath(href: string): string | null {
  try {
    const url = new URL(href);
    if (!url.hostname.includes('aonprd.com')) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function formatMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Extract ability and attack descriptions from the stat block text.
 *  The AoN text is a continuous string (no newlines within sections),
 *  so we locate each ability by name and extract until the next boundary. */
function parseStatBlock(text: string, abilityNames: string[]): { name: string; description: string }[] {
  if (!text) return [];
  const entries: { name: string; description: string }[] = [];

  // Boundaries that signal the end of an ability description.
  const boundaries = [...abilityNames, 'Speed ', 'Melee ', 'Ranged ', '---'];

  // Extract named abilities.
  for (const name of abilityNames) {
    const idx = text.indexOf(name);
    if (idx === -1) continue;
    const after = text.slice(idx + name.length);
    let endIdx = after.length;
    for (const b of boundaries) {
      if (b === name) continue;
      const bIdx = after.indexOf(b);
      if (bIdx > 0 && bIdx < endIdx) endIdx = bIdx;
    }
    const desc = after.slice(0, endIdx).trim();
    if (desc) entries.push({ name, description: desc });
  }

  // Extract Melee/Ranged attacks.
  const attackRe = /(?:Melee|Ranged)\s+(?:Single Action|Two Actions|Three Actions|Reaction|Free Action)?\s*/g;
  let m: RegExpExecArray | null;
  while ((m = attackRe.exec(text)) !== null) {
    const label = text.slice(m.index).startsWith('Melee') ? 'Melee' : 'Ranged';
    const after = text.slice(m.index + m[0].length);
    // Runs until the next Melee/Ranged/ability or end.
    let endIdx = after.length;
    for (const b of ['Melee ', 'Ranged ', ...abilityNames]) {
      const bIdx = after.indexOf(b);
      if (bIdx > 0 && bIdx < endIdx) endIdx = bIdx;
    }
    const desc = after.slice(0, endIdx).trim();
    if (desc) entries.push({ name: label, description: desc });
  }

  return entries;
}

function CreatureCard({ data }: { data: AonCreaturePreview }) {
  const abilities = parseStatBlock(data.statBlock, data.abilities);

  return (
    <div className="flex gap-4">
      {/* Left column — core stats */}
      <div className="w-[240px] shrink-0 space-y-2.5">
        {/* Header */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{data.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">Creature {data.level}</span>
        </div>

        {/* Traits */}
        {data.traits.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.rarity !== 'common' && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                  data.rarity === 'uncommon' && 'bg-orange-800/60 text-orange-200',
                  data.rarity === 'rare' && 'bg-blue-800/60 text-blue-200',
                  data.rarity === 'unique' && 'bg-purple-800/60 text-purple-200',
                )}
              >
                {data.rarity}
              </span>
            )}
            {data.traits.map((t) => (
              <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Summary */}
        {data.summary && (
          <p className="text-xs leading-snug text-muted-foreground">
            {data.summary.length > 120 ? data.summary.slice(0, 120) + '…' : data.summary}
          </p>
        )}

        <div className="h-px bg-border" />

        {/* Core stats */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <StatRow label="HP" value={data.hp} />
          <StatRow label="AC" value={data.ac} />
          <StatRow label="Fort" value={formatMod(data.fortitude)} />
          <StatRow label="Ref" value={formatMod(data.reflex)} />
          <StatRow label="Will" value={formatMod(data.will)} />
          <StatRow label="Perc" value={formatMod(data.perception)} />
        </div>

        <div className="h-px bg-border" />

        {/* Ability scores */}
        <div className="grid grid-cols-6 gap-1 text-center text-[10px]">
          {(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const).map((ab) => (
            <div key={ab}>
              <div className="font-medium text-muted-foreground uppercase">{ab.slice(0, 3)}</div>
              <div className="tabular-nums">{formatMod(data[ab])}</div>
            </div>
          ))}
        </div>

        {/* Speed / Size */}
        <div className="flex gap-3 text-xs">
          <span>
            <span className="text-muted-foreground">Spd</span> {data.speed}
          </span>
          <span>
            <span className="text-muted-foreground">Size</span> {data.size}
          </span>
        </div>

        {/* Immunities / Weaknesses */}
        {data.immunities.length > 0 && (
          <p className="text-xs">
            <span className="text-muted-foreground">Imm</span> {data.immunities.join(', ')}
          </p>
        )}
        {data.weaknesses && (
          <p className="text-xs">
            <span className="text-muted-foreground">Weak</span> {data.weaknesses}
          </p>
        )}
      </div>

      {/* Right column — abilities & attacks */}
      {abilities.length > 0 && (
        <>
          <div className="w-px shrink-0 bg-border" />
          <div className="min-w-0 flex-1 space-y-2.5 overflow-y-auto" style={{ maxHeight: 400 }}>
            <span className="text-[10px] font-medium uppercase text-muted-foreground">Abilities & Attacks</span>
            {abilities.map((ab, i) => (
              <div key={i} className="text-xs">
                <span className="font-medium">{renderActionIcons(ab.name)}</span>{' '}
                <span className="text-muted-foreground">{renderActionIcons(ab.description)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GenericCard({ data }: { data: { name: string; category: string; text: string } }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{data.name}</span>
        <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{data.category}</span>
      </div>
      <p className="text-xs leading-snug text-muted-foreground whitespace-pre-wrap">
        {data.text.length > 400 ? data.text.slice(0, 400) + '…' : data.text}
      </p>
    </div>
  );
}

export function AonHoverCard({
  href,
  children,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  const [preview, setPreview] = useState<AonPreviewData | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aonPath = extractAonPath(href);

  const handleEnter = useCallback(() => {
    if (!aonPath) return;
    // Cancel any pending leave.
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    // Small delay to avoid flickering on quick mouse passes.
    hoverTimerRef.current = setTimeout(async () => {
      setVisible(true);

      if (cache.has(aonPath)) {
        setPreview(cache.get(aonPath)!);
        return;
      }

      setLoading(true);
      const data = await api.aonPreview(aonPath);
      cache.set(aonPath, data);
      setPreview(data);
      setLoading(false);
    }, 300);
  }, [aonPath]);

  const handleLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Short delay so the mouse can travel from the link to the card
    // without dismissing it.
    leaveTimerRef.current = setTimeout(() => setVisible(false), 150);
  }, []);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onNavigate();
    },
    [onNavigate],
  );

  // No AoN path — just render as a plain link.
  if (!aonPath) {
    return (
      <a href={href} onClick={handleClick} className="underline text-primary hover:text-primary/80 cursor-pointer">
        {children}
      </a>
    );
  }

  return (
    <span ref={wrapperRef} className="relative inline" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <a href={href} onClick={handleClick} className="underline text-primary hover:text-primary/80 cursor-pointer">
        {children}
      </a>

      {visible && (
        <div
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          className={cn(
            'absolute left-0 top-full z-50 mt-1 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg',
            preview?.type === 'creature' ? 'w-[850px]' : 'w-[500px]',
          )}
        >
          {loading && !preview && <p className="text-xs text-muted-foreground">Loading…</p>}
          {preview?.type === 'creature' && <CreatureCard data={preview} />}
          {preview?.type === 'generic' && <GenericCard data={preview} />}
          {!loading && !preview && <p className="text-xs text-muted-foreground">No preview available</p>}
        </div>
      )}
    </span>
  );
}
