import { ipcMain } from 'electron';
import type { DmToolConfig } from '../config.js';
import { listGlobePins, upsertGlobePin, deleteGlobePin } from '../pf2e-db.js';
import type { GlobePin } from '../../shared/types.js';

export function registerGlobeHandlers(cfg: DmToolConfig): void {
  const hasPf2eDb = (): boolean => !!cfg.pf2eDbPath;

  ipcMain.handle('globePinsList', () => {
    if (!hasPf2eDb()) return [];
    return listGlobePins();
  });

  ipcMain.handle('globePinsUpsert', (_e, pin: GlobePin) => {
    if (!hasPf2eDb()) return;
    upsertGlobePin(pin);
  });

  ipcMain.handle('globePinsDelete', (_e, id: string) => {
    if (!hasPf2eDb()) return;
    deleteGlobePin(id);
  });
}
