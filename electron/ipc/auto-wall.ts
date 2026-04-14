import { dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { DmToolConfig } from '../config.js';

/** Path where we store a .uvtt sidecar for a given map. Exported so
 *  foundry handlers can reuse it without duplicating the convention. */
export function uvttPath(libraryPath: string, fileName: string): string {
  const stem = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
  return join(libraryPath, `${stem}.uvtt`);
}

export function registerAutoWallHandlers(cfg: DmToolConfig): void {
  const validatePlainFileName = (fileName: string, caller: string) => {
    if (fileName.includes('/') || fileName.includes('\\')) {
      throw new Error(`${caller}: fileName must not contain path separators`);
    }
  };

  ipcMain.handle('autoWallAvailable', (): boolean => {
    return !!cfg.autoWallBinPath;
  });

  ipcMain.handle('autoWallLaunch', async (_e, fileName: string): Promise<void> => {
    if (!cfg.autoWallBinPath) throw new Error('Auto-Wall not configured');
    validatePlainFileName(fileName, 'autoWallLaunch');
    const mapPath = join(cfg.libraryPath, fileName);
    // Launch GUI with the map pre-loaded and the save dialog defaulting
    // to the library directory so the user doesn't have to navigate there.
    const child = spawn(cfg.autoWallBinPath, [mapPath, '--save-dir', cfg.libraryPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
  });

  ipcMain.handle('autoWallHasUvtt', (_e, fileName: string): boolean => {
    validatePlainFileName(fileName, 'autoWallHasUvtt');
    return existsSync(uvttPath(cfg.libraryPath, fileName));
  });

  ipcMain.handle(
    'autoWallGetWalls',
    (
      _e,
      fileName: string,
    ): {
      walls: number[][];
      width: number;
      height: number;
    } | null => {
      validatePlainFileName(fileName, 'autoWallGetWalls');
      const path = uvttPath(cfg.libraryPath, fileName);
      if (!existsSync(path)) return null;
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      const ppg = raw?.resolution?.pixels_per_grid ?? 70;
      const mapSize = raw?.resolution?.map_size ?? { x: 0, y: 0 };
      const los: Array<Array<{ x: number; y: number }>> = raw?.line_of_sight ?? [];
      return {
        walls: los.map((seg) => [seg[0].x * ppg, seg[0].y * ppg, seg[1].x * ppg, seg[1].y * ppg]),
        width: Math.round(mapSize.x * ppg),
        height: Math.round(mapSize.y * ppg),
      };
    },
  );

  ipcMain.handle('autoWallImportUvtt', async (_e, fileName: string): Promise<boolean> => {
    validatePlainFileName(fileName, 'autoWallImportUvtt');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import .uvtt file',
      filters: [{ name: 'Universal VTT', extensions: ['uvtt'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return false;
    await copyFile(filePaths[0], uvttPath(cfg.libraryPath, fileName));
    return true;
  });
}
