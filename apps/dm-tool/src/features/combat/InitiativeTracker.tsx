import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, Dice5, Heart, Trash2, UploadCloud, UserPlus, X } from 'lucide-react';
import { Skull } from 'lucide-react';
import type { Combatant, Encounter, MonsterDetail, MonsterSummary, PushEncounterResult } from '@dm-tool/shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { reserveMonsterName, rollD20, sortedCombatants } from './util';
import { PushResultDialog } from './PushResultDialog';

interface Props {
  encounter: Encounter;
  onChange: (next: Encounter) => Promise<void>;
}

export function InitiativeTracker({ encounter, onChange }: Props) {
  const [addMode, setAddMode] = useState<'none' | 'monster' | 'pc'>('none');
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<PushEncounterResult | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const monsterCount = encounter.combatants.filter((c) => c.kind === 'monster').length;

  const handlePushToFoundry = useCallback(async () => {
    if (pushing || monsterCount === 0) return;
    setPushing(true);
    setPushError(null);
    try {
      const result = await api.pushEncounterToFoundry(encounter.id);
      setPushResult(result);
    } catch (e) {
      setPushError((e as Error).message || 'Push failed.');
    } finally {
      setPushing(false);
    }
  }, [encounter.id, monsterCount, pushing]);

  const order = sortedCombatants(encounter.combatants);
  const currentId = order[encounter.turnIndex]?.id ?? null;

  const update = useCallback((next: Partial<Encounter>) => onChange({ ...encounter, ...next }), [encounter, onChange]);

  const updateCombatant = useCallback(
    (id: string, patch: Partial<Combatant>) =>
      update({
        combatants: encounter.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }),
    [encounter.combatants, update],
  );

  const removeCombatant = useCallback(
    (id: string) => {
      // Keep turnIndex pointed at "the same actor" if possible — otherwise
      // clamp it so we don't point past the end of the list.
      const removedIdx = order.findIndex((c) => c.id === id);
      const remaining = encounter.combatants.filter((c) => c.id !== id);
      let nextTurn = encounter.turnIndex;
      if (removedIdx !== -1 && removedIdx < encounter.turnIndex) nextTurn -= 1;
      nextTurn = Math.max(0, Math.min(nextTurn, remaining.length - 1));
      return update({ combatants: remaining, turnIndex: Math.max(0, nextTurn) });
    },
    [encounter.combatants, encounter.turnIndex, order, update],
  );

  const rollMonsters = useCallback(() => {
    const rolled = encounter.combatants.map((c) =>
      c.kind === 'monster' ? { ...c, initiative: rollD20(c.initiativeMod) } : c,
    );
    return update({ combatants: rolled, turnIndex: 0, round: 1 });
  }, [encounter.combatants, update]);

  const clearInitiative = useCallback(
    () =>
      update({
        combatants: encounter.combatants.map((c) => ({ ...c, initiative: null })),
        turnIndex: 0,
        round: 1,
      }),
    [encounter.combatants, update],
  );

  const nextTurn = useCallback(() => {
    if (order.length === 0) return;
    const next = encounter.turnIndex + 1;
    if (next >= order.length) return update({ turnIndex: 0, round: encounter.round + 1 });
    return update({ turnIndex: next });
  }, [encounter.round, encounter.turnIndex, order.length, update]);

  const prevTurn = useCallback(() => {
    if (order.length === 0) return;
    const prev = encounter.turnIndex - 1;
    if (prev < 0) return update({ turnIndex: Math.max(0, order.length - 1), round: Math.max(1, encounter.round - 1) });
    return update({ turnIndex: prev });
  }, [encounter.round, encounter.turnIndex, order.length, update]);

  const setCurrent = useCallback(
    (id: string) => {
      const idx = order.findIndex((c) => c.id === id);
      if (idx >= 0) return update({ turnIndex: idx });
    },
    [order, update],
  );

  const addMonster = useCallback(
    (monster: MonsterSummary, detail: MonsterDetail) => {
      const { existing, next } = reserveMonsterName(encounter.combatants, monster.name);
      const combatant: Combatant = {
        id: crypto.randomUUID(),
        kind: 'monster',
        monsterName: monster.name,
        displayName: next,
        initiativeMod: detail.perception,
        initiative: null,
        hp: detail.hp,
        maxHp: detail.hp,
      };
      return update({ combatants: [...existing, combatant] });
    },
    [encounter.combatants, update],
  );

  const addPc = useCallback(
    (pc: { name: string; initiativeMod: number; maxHp: number }) => {
      const combatant: Combatant = {
        id: crypto.randomUUID(),
        kind: 'pc',
        displayName: pc.name,
        initiativeMod: pc.initiativeMod,
        initiative: null,
        hp: pc.maxHp,
        maxHp: pc.maxHp,
      };
      return update({ combatants: [...encounter.combatants, combatant] });
    },
    [encounter.combatants, update],
  );

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      {/* Header: encounter name + turn controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid hsl(var(--border))',
        }}
      >
        <Input
          value={encounter.name}
          onChange={(e) => update({ name: e.target.value })}
          className="h-7 max-w-xs text-sm font-semibold"
        />
        <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
          Round {encounter.round}
        </span>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={() => void prevTurn()} disabled={order.length === 0}>
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
          Prev
        </Button>
        <Button size="sm" onClick={() => void nextTurn()} disabled={order.length === 0}>
          Next
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Secondary toolbar: roll / clear */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid hsl(var(--border))',
          fontSize: 12,
          color: 'hsl(var(--muted-foreground))',
        }}
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => void rollMonsters()}
          disabled={encounter.combatants.length === 0}
        >
          <Dice5 className="mr-1 h-3.5 w-3.5" />
          Roll monsters
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void clearInitiative()}
          disabled={encounter.combatants.length === 0}
        >
          Clear
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handlePushToFoundry()}
          disabled={pushing || monsterCount === 0}
          title={
            monsterCount === 0
              ? 'Add monster combatants first'
              : 'Create a Foundry actor for each monster in a folder named after the encounter'
          }
        >
          <UploadCloud className="mr-1 h-3.5 w-3.5" />
          {pushing ? 'Pushing…' : 'Push to Foundry'}
        </Button>
        <div style={{ flex: 1 }} />
        <span className="text-[11px]">
          {encounter.combatants.length} combatant{encounter.combatants.length === 1 ? '' : 's'}
        </span>
      </div>
      {pushError && (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: 'hsl(var(--destructive))',
            background: 'hsl(var(--destructive) / 0.1)',
            borderBottom: '1px solid hsl(var(--destructive) / 0.4)',
          }}
        >
          {pushError}
        </div>
      )}
      {pushResult && <PushResultDialog result={pushResult} onClose={() => setPushResult(null)} />}

      {/* Initiative list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {order.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'hsl(var(--muted-foreground))',
              fontSize: 13,
            }}
          >
            No combatants yet. Add monsters or PCs below.
          </div>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {order.map((c, i) => (
              <CombatantRow
                key={c.id}
                combatant={c}
                index={i}
                isCurrent={c.id === currentId}
                onSetCurrent={() => void setCurrent(c.id)}
                onPatch={(patch) => void updateCombatant(c.id, patch)}
                onRemove={() => void removeCombatant(c.id)}
              />
            ))}
          </ol>
        )}
      </div>

      {/* Add toolbar */}
      <div
        style={{
          borderTop: '1px solid hsl(var(--border))',
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {addMode === 'none' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="outline" onClick={() => setAddMode('monster')}>
              <Skull className="mr-1 h-3.5 w-3.5" />
              Add monster
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddMode('pc')}>
              <UserPlus className="mr-1 h-3.5 w-3.5" />
              Add PC
            </Button>
          </div>
        )}
        {addMode === 'monster' && (
          <AddMonsterPanel
            existing={encounter.combatants}
            onAdd={(m, d) => void addMonster(m, d)}
            onClose={() => setAddMode('none')}
          />
        )}
        {addMode === 'pc' && (
          <AddPcPanel
            onAdd={(pc) => {
              void addPc(pc);
            }}
            onClose={() => setAddMode('none')}
          />
        )}
      </div>
    </div>
  );
}

function CombatantRow({
  combatant,
  index,
  isCurrent,
  onSetCurrent,
  onPatch,
  onRemove,
}: {
  combatant: Combatant;
  index: number;
  isCurrent: boolean;
  onSetCurrent: () => void;
  onPatch: (patch: Partial<Combatant>) => void;
  onRemove: () => void;
}) {
  const hpPct = combatant.maxHp > 0 ? (combatant.hp / combatant.maxHp) * 100 : 0;
  const hpColor = hpPct > 60 ? '#4ade80' : hpPct > 30 ? '#facc15' : '#f87171';

  return (
    <li
      onClick={onSetCurrent}
      className={cn(
        'group flex items-center gap-3 border-b border-border/40 px-3 py-2 text-xs transition-colors hover:bg-accent/30',
        isCurrent && 'bg-primary/10',
      )}
      style={{ cursor: 'pointer' }}
    >
      <span
        className="shrink-0 tabular-nums"
        style={{
          width: 18,
          color: isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
          fontWeight: isCurrent ? 600 : 400,
        }}
      >
        {isCurrent ? '▶' : `${index + 1}.`}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* size attribute sizes the input to its text length; width: auto
            overrides the default w-full so empty space in the row still
            propagates clicks up to the <li> setCurrent handler. +1 padding
            character so the caret doesn't clip on the right. */}
        <Input
          value={combatant.displayName}
          onChange={(e) => onPatch({ displayName: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          size={Math.max(4, combatant.displayName.length + 1)}
          style={{ width: 'auto' }}
          className="h-6 border-transparent bg-transparent px-1 text-xs font-medium hover:border-input focus:border-input"
        />
        <div className="mt-0.5 flex items-center gap-1 pl-1 text-[10px] text-muted-foreground">
          <span className="uppercase">{combatant.kind}</span>
          <span>·</span>
          <span>
            Init mod {combatant.initiativeMod >= 0 ? '+' : ''}
            {combatant.initiativeMod}
          </span>
        </div>
      </div>

      <label
        className="flex flex-col items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
        style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))' }}
      >
        INIT
        <Input
          type="number"
          value={combatant.initiative ?? ''}
          onChange={(e) => onPatch({ initiative: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
          className="h-7 w-14 px-1 text-center text-xs tabular-nums"
        />
      </label>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
      >
        <span
          style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center', gap: 2 }}
        >
          <Heart className="h-2.5 w-2.5" style={{ color: hpColor }} />
          HP
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Input
            type="number"
            value={combatant.hp}
            onChange={(e) => onPatch({ hp: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            className="h-7 w-14 px-1 text-center text-xs tabular-nums"
          />
          <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>/</span>
          <Input
            type="number"
            value={combatant.maxHp}
            onChange={(e) => onPatch({ maxHp: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            className="h-7 w-14 px-1 text-center text-xs tabular-nums"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${combatant.displayName}`}
        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function AddMonsterPanel({
  existing,
  onAdd,
  onClose,
}: {
  existing: Combatant[];
  onAdd: (m: MonsterSummary, d: MonsterDetail) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MonsterSummary[]>([]);
  const [busy, setBusy] = useState(false);

  // Simple manual search on Enter / debounced typing.
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    try {
      const rows = await api.monstersSearch({ keywords: q, limit: 12 });
      setResults(rows);
    } catch (e) {
      console.error('monstersSearch failed:', e);
    }
  }, []);

  const handleChange = (v: string) => {
    setQuery(v);
    void runSearch(v);
  };

  const handlePick = async (m: MonsterSummary) => {
    setBusy(true);
    try {
      const detail = await api.monstersGetDetail(m.name);
      if (detail) onAdd(m, detail);
    } finally {
      setBusy(false);
    }
  };

  const monsterCount = (name: string) => existing.filter((c) => c.monsterName === name).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Input
          autoFocus
          placeholder="Search monsters by name…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          className="h-7 flex-1 text-xs"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {results.length > 0 && (
        <div
          style={{
            maxHeight: 200,
            overflowY: 'auto',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
          }}
        >
          {results.map((m) => {
            const count = monsterCount(m.name);
            return (
              <button
                key={m.name}
                type="button"
                disabled={busy}
                onClick={() => void handlePick(m)}
                className="flex w-full items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent/40 disabled:opacity-50"
              >
                <span className="truncate">{m.name}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  Lvl {m.level} · HP {m.hp} · AC {m.ac}
                  {count > 0 && <span className="ml-2 text-primary">×{count}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddPcPanel({
  onAdd,
  onClose,
}: {
  onAdd: (pc: { name: string; initiativeMod: number; maxHp: number }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [initMod, setInitMod] = useState('0');
  const [maxHp, setMaxHp] = useState('');

  const canSave = name.trim() !== '' && maxHp.trim() !== '';

  const handleSave = () => {
    if (!canSave) return;
    onAdd({
      name: name.trim(),
      initiativeMod: parseInt(initMod, 10) || 0,
      maxHp: Math.max(1, parseInt(maxHp, 10) || 1),
    });
    setName('');
    setInitMod('0');
    setMaxHp('');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
      <div style={{ flex: 1 }}>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className="h-7 text-xs"
        />
      </div>
      <div style={{ width: 70 }}>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Init mod</label>
        <Input
          type="number"
          value={initMod}
          onChange={(e) => setInitMod(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className="h-7 text-xs"
        />
      </div>
      <div style={{ width: 70 }}>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Max HP</label>
        <Input
          type="number"
          value={maxHp}
          onChange={(e) => setMaxHp(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className="h-7 text-xs"
        />
      </div>
      <Button size="sm" onClick={handleSave} disabled={!canSave}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}
