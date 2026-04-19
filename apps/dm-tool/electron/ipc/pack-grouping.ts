import { dialog, ipcMain } from 'electron';
import type { MapDb } from '../db.js';
import { buildGroupingPrompt, getCachedPackMapping, mergePacks, parseAndCacheMapping } from '../pack-grouper.js';

export function registerPackGroupingHandlers(db: MapDb): void {
  ipcMain.handle('getPackMapping', () => {
    const fileNames = db.allFileNames();
    return getCachedPackMapping(fileNames);
  });

  ipcMain.handle('exportPackGroupingPrompt', () => {
    const fileNames = db.allFileNames();
    return buildGroupingPrompt(fileNames);
  });

  ipcMain.handle('importPackMappingFromFile', async (): Promise<Record<string, string> | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import pack grouping JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    const { readFileSync } = await import('node:fs');
    const jsonText = readFileSync(filePaths[0], 'utf-8');
    const fileNames = db.allFileNames();
    return parseAndCacheMapping(jsonText, fileNames);
  });

  ipcMain.handle('mergePacks', (_e, args: { sourcePacks: string[]; targetName: string }): Record<string, string> => {
    const fileNames = db.allFileNames();
    return mergePacks(args.sourcePacks, args.targetName, fileNames);
  });
}
