// Inventory CRUD + live-sync push to the sidecar. SQLite remains the DM's
// source of truth; every mutation fires off a best-effort POST to the
// sidecar so connected players see the update in real time. If the sidecar
// is unreachable the local write still succeeds — the next successful push
// will bring the sidecar back in sync.

import { ipcMain } from 'electron';
import type { DmToolConfig } from '../config.js';
import type { PartyInventoryItem } from '@dm-tool/shared/types';
import { deleteInventory, listInventory, upsertInventory } from '@dm-tool/db/pf2e';
import { pushToSidecar } from '../sidecar-client.js';

async function pushSnapshot(cfg: DmToolConfig): Promise<void> {
  await pushToSidecar(
    cfg,
    '/api/inventory',
    { items: listInventory(), updatedAt: new Date().toISOString() },
    'inventory',
  );
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
