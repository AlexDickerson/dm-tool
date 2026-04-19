import { ipcMain, shell } from 'electron';
import { join } from 'node:path';
import type { MapDb } from '../db.js';
import type { DmToolConfig } from '../config.js';
import type { MapDetail, SearchParams } from '@dm-tool/shared/types';
import { getAdditionalHooks } from '../hooks-store.js';

export function registerMapHandlers(db: MapDb, cfg: DmToolConfig): void {
  ipcMain.handle('searchMaps', (_e, params: SearchParams) => {
    return db.search(params ?? {});
  });

  // The base detail comes from the read-only DB; we layer on the
  // dm-tool-owned override list of additional encounter hooks before
  // returning. Renderer doesn't have to know the two storage layers exist.
  ipcMain.handle('getMapDetail', (_e, fileName: string): MapDetail | null => {
    const detail = db.getDetail(fileName);
    if (!detail) return null;
    return {
      ...detail,
      additionalEncounterHooks: getAdditionalHooks(fileName),
    };
  });

  ipcMain.handle('getFacets', () => {
    return db.getFacets();
  });

  ipcMain.handle('getLibraryPath', () => {
    return cfg.libraryPath;
  });

  ipcMain.handle('openInExplorer', async (_e, fileName: string) => {
    // shell.showItemInFolder opens the OS file browser with the file
    // selected — on Windows that's Explorer, on macOS that's Finder.
    // We deliberately only accept a plain filename (no separators) to
    // avoid any path traversal via the renderer.
    if (fileName.includes('/') || fileName.includes('\\')) {
      throw new Error('openInExplorer: fileName must not contain path separators');
    }
    const fullPath = join(cfg.libraryPath, fileName);
    shell.showItemInFolder(fullPath);
  });
}
