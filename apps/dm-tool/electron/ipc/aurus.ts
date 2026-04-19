// Aurus team CRUD + live-sync push to the sidecar. Same pattern as
// inventory — SQLite is source of truth, sidecar gets best-effort pushes.

import { ipcMain } from 'electron';
import type { DmToolConfig } from '../config.js';
import type { AurusTeam } from '@dm-tool/shared/types';
import { deleteAurusTeam, listAurusTeams, upsertAurusTeam } from '@dm-tool/db/pf2e';
import { pushToSidecar } from '../sidecar-client.js';

async function pushSnapshot(cfg: DmToolConfig): Promise<void> {
  await pushToSidecar(cfg, '/api/aurus', { teams: listAurusTeams(), updatedAt: new Date().toISOString() }, 'aurus');
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
