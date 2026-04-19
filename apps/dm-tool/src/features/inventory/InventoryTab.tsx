// DM-side view for the shared party inventory. CRUD table; every write
// fires an IPC that persists to SQLite and pushes a snapshot to the sidecar
// so the player portal's /inventory route updates live.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { api } from '@/lib/api';
import type { PartyInventoryCategory, PartyInventoryItem } from '@dm-tool/shared/types';

const CATEGORIES: PartyInventoryCategory[] = ['consumable', 'equipment', 'quest', 'treasure', 'other'];

function blankItem(): PartyInventoryItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: '',
    qty: 1,
    category: 'other',
    bulk: undefined,
    valueCp: undefined,
    aonUrl: undefined,
    note: undefined,
    carriedBy: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function formatCp(cp: number | undefined): string {
  if (cp === undefined) return '';
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const cpRem = cp % 10;
  if (gp > 0) return `${gp}g${sp > 0 ? ` ${sp}s` : ''}${cpRem > 0 ? ` ${cpRem}c` : ''}`;
  if (sp > 0) return `${sp}s${cpRem > 0 ? ` ${cpRem}c` : ''}`;
  return `${cpRem}c`;
}

export function InventoryTab() {
  const [items, setItems] = useState<PartyInventoryItem[]>([]);
  const [editing, setEditing] = useState<PartyInventoryItem | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const list = await api.inventoryList();
    setItems(list);
  }, []);

  useEffect(() => {
    refresh().catch((e) => console.error('inventoryList failed:', e));
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const next: PartyInventoryItem = { ...editing, updatedAt: new Date().toISOString() };
      await api.inventoryUpsert(next);
      await refresh();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      await api.inventoryDelete(id);
      await refresh();
    },
    [refresh],
  );

  const totalBulk = useMemo(() => items.reduce((sum, i) => sum + (i.bulk ?? 0) * i.qty, 0), [items]);
  const totalValue = useMemo(() => items.reduce((sum, i) => sum + (i.valueCp ?? 0) * i.qty, 0), [items]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Party Inventory</h2>
          <p className="text-xs text-muted-foreground">
            {items.length} items · bulk {totalBulk.toFixed(1)} · value {formatCp(totalValue)}
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing(blankItem())}>
          <Plus className="mr-1 h-4 w-4" /> Add item
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto rounded-md border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-[1] bg-background">
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="w-[70px] px-3 py-2 font-medium">Qty</th>
              <th className="w-[120px] px-3 py-2 font-medium">Category</th>
              <th className="w-[120px] px-3 py-2 font-medium">Carried by</th>
              <th className="w-[90px] px-3 py-2 font-medium">Bulk</th>
              <th className="w-[110px] px-3 py-2 font-medium">Value</th>
              <th className="w-[60px] px-3 py-2" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No items yet. Click &ldquo;Add item&rdquo; to get started.
                </td>
              </tr>
            ) : (
              items.map((i) => (
                <tr key={i.id} onClick={() => setEditing(i)} className="cursor-pointer border-b border-border">
                  <td className="px-3 py-2">
                    <div>{i.name || <span className="text-muted-foreground">(unnamed)</span>}</div>
                    {i.aonUrl && (
                      <a
                        href={i.aonUrl}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          api.openExternal(i.aonUrl!);
                        }}
                        className="text-[11px] text-blue-500 hover:underline"
                      >
                        AoN
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">{i.qty}</td>
                  <td className="px-3 py-2">{i.category}</td>
                  <td className="px-3 py-2">{i.carriedBy ?? '—'}</td>
                  <td className="px-3 py-2">{i.bulk ?? '—'}</td>
                  <td className="px-3 py-2">{i.valueCp ? formatCp(i.valueCp) : '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(i.id);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Delete item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ItemEditor
          item={editing}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}
    </div>
  );
}

function ItemEditor({
  item,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  item: PartyInventoryItem;
  onChange: (next: PartyInventoryItem) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[480px] max-w-[90vw] flex-col gap-3 rounded-lg border border-border bg-background p-6"
      >
        <h3 className="text-base font-semibold">Item details</h3>
        <div>
          <Label htmlFor="item-name">Name</Label>
          <Input
            id="item-name"
            value={item.name}
            onChange={(e) => onChange({ ...item, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="item-qty">Quantity</Label>
            <Input
              id="item-qty"
              type="number"
              min={1}
              value={item.qty}
              onChange={(e) => onChange({ ...item, qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
          </div>
          <div>
            <Label htmlFor="item-category">Category</Label>
            <select
              id="item-category"
              value={item.category}
              onChange={(e) => onChange({ ...item, category: e.target.value as PartyInventoryCategory })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="item-bulk">Bulk</Label>
            <Input
              id="item-bulk"
              type="number"
              step={0.1}
              value={item.bulk ?? ''}
              onChange={(e) =>
                onChange({ ...item, bulk: e.target.value === '' ? undefined : parseFloat(e.target.value) })
              }
            />
          </div>
          <div>
            <Label htmlFor="item-value">Value (copper)</Label>
            <Input
              id="item-value"
              type="number"
              min={0}
              value={item.valueCp ?? ''}
              onChange={(e) =>
                onChange({ ...item, valueCp: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })
              }
            />
          </div>
        </div>
        <div>
          <Label htmlFor="item-aon">Archives of Nethys URL</Label>
          <Input
            id="item-aon"
            placeholder="https://2e.aonprd.com/Equipment.aspx?ID=..."
            value={item.aonUrl ?? ''}
            onChange={(e) => onChange({ ...item, aonUrl: e.target.value || undefined })}
          />
        </div>
        <div>
          <Label htmlFor="item-carriedby">Carried by</Label>
          <Input
            id="item-carriedby"
            list="party-members"
            placeholder="e.g. Sal, Party"
            value={item.carriedBy ?? ''}
            onChange={(e) => onChange({ ...item, carriedBy: e.target.value || undefined })}
          />
          <datalist id="party-members">
            <option value="Sal" />
            <option value="Broccoli" />
            <option value="Jackstone" />
            <option value="Lutharion" />
            <option value="Party" />
          </datalist>
        </div>
        <div>
          <Label htmlFor="item-note">Note</Label>
          <Input
            id="item-note"
            value={item.note ?? ''}
            onChange={(e) => onChange({ ...item, note: e.target.value || undefined })}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || !item.name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
