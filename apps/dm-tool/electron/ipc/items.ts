import { ipcMain } from 'electron';
import type { ItemBrowserDetail, ItemBrowserRow, ItemFacets, ItemSearchParams } from '@dm-tool/shared/types';
import { searchItemsBrowser, getItemBrowserDetail, getItemFacets } from '../pf2e-db.js';

export function registerItemHandlers(): void {
  ipcMain.handle('searchItemsBrowser', (_e, params: ItemSearchParams): ItemBrowserRow[] => {
    return searchItemsBrowser(params ?? {});
  });

  ipcMain.handle('getItemBrowserDetail', (_e, id: string): ItemBrowserDetail | null => {
    return getItemBrowserDetail(id);
  });

  ipcMain.handle('getItemFacets', (): ItemFacets => {
    return getItemFacets();
  });
}
