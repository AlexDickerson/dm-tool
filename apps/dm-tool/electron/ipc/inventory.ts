// Inventory CRUD + live-sync push to the sidecar. SQLite remains the DM's
// source of truth; every mutation fires off a best-effort POST to the
// sidecar so connected players see the update in real time. If the sidecar
// is unreachable the local write still succeeds — the next successful push
// will bring the sidecar back in sync.

import { ipcMain } from 'electron';
import type { DmToolConfig } from '../config.js';
import type { PartyInventoryItem } from '@dm-tool/shared/types';
import { deleteInventory, listInventory, upsertInventory } from '../pf2e-db.js';

async function pushSnapshot(cfg: DmToolConfig): Promise<void> {
  if (!cfg.sidecarUrl || !cfg.sidecarSecret) return;
  const items = listInventory();
  try {
    const res = await fetch(`${cfg.sidecarUrl.replace(/\/+$/, '')}/api/inventory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.sidecarSecret}`,
      },
      body: JSON.stringify({ items, updatedAt: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.warn(`inventory sidecar push failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn('inventory sidecar push error:', (err as Error).message);
  }
}

export function registerInventoryHandlers(cfg: DmToolConfig): void {
  ipcMain.handle('inventoryList', (): PartyInventoryItem[] => listInventory());

  ipcMain.handle('inventoryUpsert', async (_e, item: PartyInventoryItem): Promise<void> => {
    upsertInventory(item);
    await pushSnapshot(cfg);
  });

  ipcMain.handle('inventoryDelete', async (_e, id: string): Promise<void> => {
    deleteInventory(id);
    await pushSnapshot(cfg);
  });
}
