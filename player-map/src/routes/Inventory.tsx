// Shared party inventory view for players. Subscribes to the sidecar's
// inventory stream via WebSocket; any write the DM makes in dm-tool pushes
// an update here within a second or two.

import { useMemo } from 'react';
import { useLiveStream } from '../lib/live';
import type { PartyInventoryItem } from '@shared/types';

interface InventorySnapshot {
  items: PartyInventoryItem[];
  updatedAt: string;
}

const CATEGORY_ORDER: PartyInventoryItem['category'][] = [
  'consumable',
  'equipment',
  'quest',
  'treasure',
  'other',
];

const CATEGORY_LABELS: Record<PartyInventoryItem['category'], string> = {
  consumable: 'Consumables',
  equipment: 'Equipment',
  quest: 'Quest items',
  treasure: 'Treasure',
  other: 'Other',
};

function formatCp(cp: number | undefined): string {
  if (!cp) return '';
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const cpRem = cp % 10;
  const parts: string[] = [];
  if (gp > 0) parts.push(`${gp} gp`);
  if (sp > 0) parts.push(`${sp} sp`);
  if (cpRem > 0) parts.push(`${cpRem} cp`);
  return parts.join(' ');
}

export function Inventory() {
  const { data, status, lastUpdated } = useLiveStream<InventorySnapshot>('/api/inventory/stream');

  const grouped = useMemo(() => {
    const map = new Map<PartyInventoryItem['category'], PartyInventoryItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const item of data?.items ?? []) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [data]);

  const totalBulk = useMemo(
    () => (data?.items ?? []).reduce((sum, i) => sum + (i.bulk ?? 0) * i.qty, 0),
    [data],
  );
  const totalValue = useMemo(
    () => (data?.items ?? []).reduce((sum, i) => sum + (i.valueCp ?? 0) * i.qty, 0),
    [data],
  );

  const stale = status === 'disconnected' || (lastUpdated !== null && Date.now() - lastUpdated > 60_000);

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', color: '#e5e5e5', padding: '24px 32px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>Party Inventory</h1>
            {data && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9a9a9a' }}>
                {data.items.length} items · bulk {totalBulk.toFixed(1)} · value {formatCp(totalValue) || '—'}
              </p>
            )}
          </div>
          <ConnectionIndicator status={status} stale={stale} />
        </header>

        {!data ? (
          <p style={{ color: '#9a9a9a', fontSize: 14 }}>Connecting…</p>
        ) : data.items.length === 0 ? (
          <p style={{ color: '#9a9a9a', fontSize: 14 }}>The party has nothing stashed yet.</p>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={cat} style={{ marginBottom: 28 }}>
                <h2
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#e4a547',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    borderBottom: '1px solid #333',
                    paddingBottom: 6,
                    marginBottom: 10,
                  }}
                >
                  {CATEGORY_LABELS[cat]} <span style={{ color: '#6a6a6a' }}>· {list.length}</span>
                </h2>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {list.map((item) => (
                    <li
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto auto',
                        gap: 16,
                        padding: '8px 0',
                        borderBottom: '1px solid #1f1f1f',
                        alignItems: 'baseline',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: 15 }}>{item.name}</span>
                        {item.aonUrl && (
                          <a
                            href={item.aonUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ marginLeft: 10, fontSize: 11, color: '#6a9acf' }}
                          >
                            AoN
                          </a>
                        )}
                        {item.note && (
                          <div style={{ fontSize: 12, color: '#8a8a8a', marginTop: 2, fontStyle: 'italic' }}>
                            {item.note}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: '#9a9a9a', whiteSpace: 'nowrap' }}>
                        {item.bulk ? `bulk ${(item.bulk * item.qty).toFixed(1)}` : ''}
                        {item.bulk && item.valueCp ? ' · ' : ''}
                        {item.valueCp ? formatCp(item.valueCp * item.qty) : ''}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 500, textAlign: 'right', minWidth: 40 }}>×{item.qty}</div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function ConnectionIndicator({ status, stale }: { status: string; stale: boolean }) {
  const color = status === 'connected' ? (stale ? '#d19a3a' : '#4ade80') : '#ef4444';
  const label = status === 'connected' ? (stale ? 'Stale' : 'Live') : status === 'connecting' ? 'Connecting…' : 'Offline';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9a9a9a' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, display: 'inline-block' }} />
      {label}
    </div>
  );
}
