// DM-side view for the shared party inventory. CRUD table; every write
// fires an IPC that persists to SQLite and pushes a snapshot to the sidecar
// so the player portal's /inventory route updates live.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { PartyInventoryCategory, PartyInventoryItem } from '../../../shared/types';

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
    const list = await window.electronAPI.inventoryList();
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
      await window.electronAPI.inventoryUpsert(next);
      await refresh();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      await window.electronAPI.inventoryDelete(id);
      await refresh();
    },
    [refresh],
  );

  const totalBulk = useMemo(() => items.reduce((sum, i) => sum + (i.bulk ?? 0) * i.qty, 0), [items]);
  const totalValue = useMemo(() => items.reduce((sum, i) => sum + (i.valueCp ?? 0) * i.qty, 0), [items]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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

      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'hsl(var(--background))', zIndex: 1 }}>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid hsl(var(--border))' }}>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Name</th>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 70 }}>Qty</th>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 120 }}>Category</th>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 120 }}>Carried by</th>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 90 }}>Bulk</th>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 110 }}>Value</th>
              <th style={{ padding: '8px 12px', width: 60 }} aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>
                  No items yet. Click &ldquo;Add item&rdquo; to get started.
                </td>
              </tr>
            ) : (
              items.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => setEditing(i)}
                  style={{ borderBottom: '1px solid hsl(var(--border))', cursor: 'pointer' }}
                >
                  <td style={{ padding: '8px 12px' }}>
                    <div>{i.name || <span style={{ color: 'hsl(var(--muted-foreground))' }}>(unnamed)</span>}</div>
                    {i.aonUrl && (
                      <a
                        href={i.aonUrl}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          window.electronAPI.openExternal(i.aonUrl!);
                        }}
                        className="text-[11px] text-blue-500 hover:underline"
                      >
                        AoN
                      </a>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{i.qty}</td>
                  <td style={{ padding: '8px 12px' }}>{i.category}</td>
                  <td style={{ padding: '8px 12px' }}>{i.carriedBy ?? '—'}</td>
                  <td style={{ padding: '8px 12px' }}>{i.bulk ?? '—'}</td>
                  <td style={{ padding: '8px 12px' }}>{i.valueCp ? formatCp(i.valueCp) : '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '90vw',
          backgroundColor: 'hsl(var(--background))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 8,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
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
