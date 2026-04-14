import { ipcMain } from 'electron';
import type { DmToolConfig } from '../config.js';
import type { ItemBrowserDetail, ItemBrowserRow, ItemFacets, ItemSearchParams } from '../../shared/types.js';
import { searchItemsBrowser, getItemBrowserDetail, getItemFacets } from '../pf2e-db.js';

export function registerItemHandlers(cfg: DmToolConfig): void {
  const hasPf2eDb = (): boolean => !!cfg.pf2eDbPath;

  ipcMain.handle('searchItemsBrowser', (_e, params: ItemSearchParams): ItemBrowserRow[] => {
    if (!hasPf2eDb()) return [];
    return searchItemsBrowser(params ?? {});
  });

  ipcMain.handle('getItemBrowserDetail', (_e, id: string): ItemBrowserDetail | null => {
    if (!hasPf2eDb()) return null;
    return getItemBrowserDetail(id);
  });

  ipcMain.handle('getItemFacets', (): ItemFacets => {
    if (!hasPf2eDb()) return { traits: [], sources: [], usageCategories: [] };
    return getItemFacets();
  });
}
