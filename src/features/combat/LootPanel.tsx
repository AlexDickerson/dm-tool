// Collapsible loot sub-panel for a single encounter. Sits under the
// initiative tracker in the combat tab's middle column. Two ways to add
// loot: manual entry or the ✨ Auto-generate button that runs the AI loot
// generator in the main process.
//
// The allowInventedItems toggle controls whether the AI may author up to
// 20% of the items itself (true) or must pull everything from pf2e-db
// (false, default).

import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, Coins, ExternalLink, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import type { Encounter, LootItem, LootKind, PartyInventoryCategory, PartyInventoryItem } from '@shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  encounter: Encounter;
  partyLevel: number;
  anthropicApiKey: string;
  onChange: (next: Encounter) => Promise<void>;
}

const LOOT_KIND_LABEL: Record<LootKind, string> = {
  currency: 'Currency',
  item: 'Item',
  consumable: 'Consumable',
  narrative: 'Narrative',
};

const LOOT_KINDS: LootKind[] = ['currency', 'item', 'consumable', 'narrative'];

function formatCp(cp: number): string {
  if (cp <= 0) return '—';
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  const parts: string[] = [];
  if (gp > 0) parts.push(`${gp}g`);
  if (sp > 0) parts.push(`${sp}s`);
  if (c > 0) parts.push(`${c}c`);
  return parts.join(' ') || '—';
}

function lootKindToInventoryCategory(kind: LootKind): PartyInventoryCategory {
  switch (kind) {
    case 'consumable':
      return 'consumable';
    case 'currency':
      return 'treasure';
    case 'narrative':
      return 'quest';
    case 'item':
    default:
      return 'equipment';
  }
}

export function LootPanel({ encounter, partyLevel, anthropicApiKey, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const totalValueCp = encounter.loot.reduce((sum, l) => sum + (l.valueCp ?? 0) * l.qty, 0);

  const handleGenerate = useCallback(async () => {
    if (!anthropicApiKey) {
      setError('Add an Anthropic API key in Settings first.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const loot = await api.generateEncounterLoot({ encounter, partyLevel, apiKey: anthropicApiKey });
      await onChange({ ...encounter, loot });
      setSentIds(new Set());
    } catch (e) {
      setError((e as Error).message || 'Loot generation failed.');
    } finally {
      setGenerating(false);
    }
  }, [anthropicApiKey, encounter, partyLevel, onChange]);

  const updateLoot = useCallback(
    (id: string, patch: Partial<LootItem>) => {
      const next = encounter.loot.map((l) => (l.id === id ? { ...l, ...patch } : l));
      return onChange({ ...encounter, loot: next });
    },
    [encounter, onChange],
  );

  const removeLoot = useCallback(
    (id: string) => {
      const next = encounter.loot.filter((l) => l.id !== id);
      return onChange({ ...encounter, loot: next });
    },
    [encounter, onChange],
  );

  const addManualLoot = useCallback(
    (draft: Omit<LootItem, 'id' | 'source'>) => {
      const row: LootItem = { ...draft, id: crypto.randomUUID(), source: 'manual' };
      return onChange({ ...encounter, loot: [...encounter.loot, row] });
    },
    [encounter, onChange],
  );

  const handleSendToInventory = useCallback(
    async (item: LootItem) => {
      const now = new Date().toISOString();
      const inv: PartyInventoryItem = {
        id: crypto.randomUUID(),
        name: item.name,
        qty: item.qty,
        category: lootKindToInventoryCategory(item.kind),
        valueCp: item.valueCp,
        aonUrl: item.aonUrl,
        note: item.description || undefined,
        carriedBy: 'Party',
        createdAt: now,
        updatedAt: now,
      };
      await api.inventoryUpsert(inv);
      setSentIds((s) => {
        const next = new Set(s);
        next.add(item.id);
        return next;
      });
    },
    [],
  );

  return (
    <div style={{ borderTop: '1px solid hsl(var(--border))', display: 'flex', flexDirection: 'column' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/30"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Coins className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold">Loot</span>
        <span className="text-muted-foreground">
          {encounter.loot.length} item{encounter.loot.length === 1 ? '' : 's'} · {formatCp(totalValueCp)}
        </span>
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px' }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={encounter.allowInventedItems}
                onChange={(e) => void onChange({ ...encounter, allowInventedItems: e.target.checked })}
              />
              Allow AI-invented items (≤20%)
            </label>
            <div style={{ flex: 1 }} />
            <Button size="sm" variant="outline" onClick={() => setAddingManual((v) => !v)} disabled={generating}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add manual
            </Button>
            <Button size="sm" onClick={() => void handleGenerate()} disabled={generating}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {generating ? 'Generating…' : 'Auto-generate'}
            </Button>
          </div>

          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {error}
            </div>
          )}

          {addingManual && (
            <ManualLootEditor
              onSave={async (draft) => {
                await addManualLoot(draft);
                setAddingManual(false);
              }}
              onCancel={() => setAddingManual(false)}
            />
          )}

          {/* Loot list */}
          {encounter.loot.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
              No loot yet. Click Auto-generate for AI suggestions or Add manual for a custom entry.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {encounter.loot.map((l) => (
                <LootRow
                  key={l.id}
                  item={l}
                  sentToInventory={sentIds.has(l.id)}
                  onPatch={(patch) => void updateLoot(l.id, patch)}
                  onRemove={() => void removeLoot(l.id)}
                  onSendToInventory={() => void handleSendToInventory(l)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// --- Row ---------------------------------------------------------------------

function LootRow({
  item,
  sentToInventory,
  onPatch,
  onRemove,
  onSendToInventory,
}: {
  item: LootItem;
  sentToInventory: boolean;
  onPatch: (patch: Partial<LootItem>) => void;
  onRemove: () => void;
  onSendToInventory: () => void;
}) {
  return (
    <li
      className="group flex items-start gap-2 rounded border border-border/40 bg-accent/10 px-2 py-1.5 text-xs"
    >
      <SourceBadge source={item.source} kind={item.kind} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Input
            value={item.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            size={Math.max(6, item.name.length + 1)}
            style={{ width: 'auto' }}
            className="h-6 border-transparent bg-transparent px-1 text-xs font-medium hover:border-input focus:border-input"
          />
          <span className="text-[10px] text-muted-foreground">× </span>
          <Input
            type="number"
            min={1}
            value={item.qty}
            onChange={(e) => onPatch({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="h-6 w-12 px-1 text-center text-[11px] tabular-nums"
          />
          <Input
            type="number"
            min={0}
            placeholder="cp"
            value={item.valueCp ?? ''}
            onChange={(e) =>
              onPatch({ valueCp: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })
            }
            className="h-6 w-20 px-1 text-[11px] tabular-nums"
            title="Value per unit, in copper"
          />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            = {formatCp((item.valueCp ?? 0) * item.qty)}
          </span>
          {item.aonUrl && (
            <button
              type="button"
              onClick={() => {
                void api.openExternal(item.aonUrl!);
              }}
              className="inline-flex items-center gap-0.5 rounded text-[10px] text-primary hover:underline"
              aria-label="Open on Archives of Nethys"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              AoN
            </button>
          )}
        </div>
        {item.description && <p className="pl-1 text-[10px] leading-snug text-muted-foreground">{item.description}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button
          type="button"
          onClick={onSendToInventory}
          disabled={sentToInventory}
          title={sentToInventory ? 'Already sent to party inventory' : 'Send to party inventory'}
          className={cn(
            'rounded p-1 transition-colors',
            sentToInventory
              ? 'text-primary/40'
              : 'text-muted-foreground hover:bg-primary/15 hover:text-primary',
          )}
        >
          <Upload className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function SourceBadge({ source, kind }: { source: LootItem['source']; kind: LootKind }) {
  const color =
    source === 'db'
      ? 'bg-emerald-700/30 text-emerald-300 border-emerald-700/40'
      : source === 'ai'
        ? 'bg-amber-700/30 text-amber-300 border-amber-700/40'
        : 'bg-zinc-700/30 text-zinc-300 border-zinc-700/40';
  const label = source === 'db' ? 'DB' : source === 'ai' ? 'AI' : 'MAN';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 2 }}>
      <span className={cn('rounded border px-1 py-[1px] text-[9px] font-semibold', color)}>{label}</span>
      <span className="text-[8px] uppercase text-muted-foreground">{LOOT_KIND_LABEL[kind]}</span>
    </div>
  );
}

// --- Manual editor -----------------------------------------------------------

function ManualLootEditor({
  onSave,
  onCancel,
}: {
  onSave: (draft: Omit<LootItem, 'id' | 'source'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [valueCp, setValueCp] = useState('');
  const [kind, setKind] = useState<LootKind>('item');
  const [description, setDescription] = useState('');
  const [aonUrl, setAonUrl] = useState('');

  const canSave = name.trim() !== '';

  const handleSave = async () => {
    if (!canSave) return;
    await onSave({
      name: name.trim(),
      qty: Math.max(1, parseInt(qty, 10) || 1),
      valueCp: valueCp.trim() === '' ? undefined : Math.max(0, parseInt(valueCp, 10) || 0),
      kind,
      description: description.trim(),
      aonUrl: aonUrl.trim() || undefined,
    });
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 0.5fr 0.8fr 1fr auto',
        gap: 6,
        padding: 6,
        border: '1px solid hsl(var(--border))',
        borderRadius: 6,
        background: 'hsl(var(--muted) / 0.3)',
        alignItems: 'end',
      }}
    >
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</Label>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-xs" />
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Qty</Label>
        <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="h-7 text-xs" />
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Value (cp)</Label>
        <Input type="number" min={0} value={valueCp} onChange={(e) => setValueCp(e.target.value)} className="h-7 text-xs" />
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kind</Label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as LootKind)}
          className="flex h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs"
        >
          {LOOT_KINDS.map((k) => (
            <option key={k} value={k}>
              {LOOT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-7 flex-1 text-xs"
        />
        <Input
          placeholder="AoN URL (optional)"
          value={aonUrl}
          onChange={(e) => setAonUrl(e.target.value)}
          className="h-7 w-64 text-xs"
        />
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
          Add
        </Button>
      </div>
    </div>
  );
}
