// Aurus team CRUD + live-sync push to the sidecar. Same pattern as
// inventory — SQLite is source of truth, sidecar gets best-effort pushes.

import { ipcMain } from 'electron';
import type { DmToolConfig } from '../config.js';
import type { AurusTeam } from '@dm-tool/shared/types';
import { deleteAurusTeam, listAurusTeams, upsertAurusTeam } from '../pf2e-db.js';

async function pushSnapshot(cfg: DmToolConfig): Promise<void> {
  if (!cfg.sidecarUrl || !cfg.sidecarSecret) return;
  const teams = listAurusTeams();
  try {
    const res = await fetch(`${cfg.sidecarUrl.replace(/\/+$/, '')}/api/aurus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.sidecarSecret}`,
      },
      body: JSON.stringify({ teams, updatedAt: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.warn(`aurus sidecar push failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn('aurus sidecar push error:', (err as Error).message);
  }
}

export function registerAurusHandlers(cfg: DmToolConfig): void {
  ipcMain.handle('aurusList', (): AurusTeam[] => listAurusTeams());

  ipcMain.handle('aurusUpsert', async (_e, team: AurusTeam): Promise<void> => {
    upsertAurusTeam(team);
    await pushSnapshot(cfg);
  });

  ipcMain.handle('aurusDelete', async (_e, id: string): Promise<void> => {
    deleteAurusTeam(id);
    await pushSnapshot(cfg);
  });
}
