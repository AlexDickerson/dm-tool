// Party inventory — persisted as JSON rows so schema changes stay localized
// to shared/types.ts. The sidecar is the live-sync authority; SQLite here
// is the DM's source of truth.

import type { PartyInventoryItem } from '@dm-tool/shared/types';
import { getPf2eDb } from './connection.js';

export function listInventory(): PartyInventoryItem[] {
  const rows = getPf2eDb().prepare('SELECT data FROM party_inventory ORDER BY updated_at DESC').all() as {
    data: string;
  }[];
  return rows.map((r) => JSON.parse(r.data) as PartyInventoryItem);
}

export function upsertInventory(item: PartyInventoryItem): void {
  getPf2eDb()
    .prepare(
      'INSERT INTO party_inventory (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    )
    .run(item.id, JSON.stringify(item), item.updatedAt);
}

export function deleteInventory(id: string): void {
  getPf2eDb().prepare('DELETE FROM party_inventory WHERE id = ?').run(id);
}
