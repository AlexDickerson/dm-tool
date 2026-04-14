import { ipcMain } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { MapDb } from '../db.js';
import type { DmToolConfig } from '../config.js';
import { pushSceneToFoundry } from '../foundry-push.js';
import { uvttPath } from './auto-wall.js';

export function registerFoundryHandlers(db: MapDb, cfg: DmToolConfig): void {
  const validatePlainFileName = (fileName: string, caller: string) => {
    if (fileName.includes('/') || fileName.includes('\\')) {
      throw new Error(`${caller}: fileName must not contain path separators`);
    }
  };

  ipcMain.handle('getMapUvtt', (_e, fileName: string): Record<string, unknown> | null => {
    validatePlainFileName(fileName, 'getMapUvtt');
    const path = uvttPath(cfg.libraryPath, fileName);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  });

  ipcMain.handle(
    'pushToFoundry',
    async (
      _e,
      fileName: string,
    ): Promise<{ sceneId: string; sceneName: string; wallsCreated: number; doorsCreated: number }> => {
      if (!cfg.foundryMcpUrl) throw new Error('foundryMcpUrl not configured in config.json');
      validatePlainFileName(fileName, 'pushToFoundry');

      const uvttFile = uvttPath(cfg.libraryPath, fileName);
      if (!existsSync(uvttFile)) throw new Error('No .uvtt file found for this map');

      const uvttRaw = JSON.parse(readFileSync(uvttFile, 'utf-8')) as {
        resolution: { pixels_per_grid: number; map_size: { x: number; y: number } };
        line_of_sight: Array<Array<{ x: number; y: number }>>;
        portals?: Array<{
          position: { x: number; y: number };
          bounds: Array<{ x: number; y: number }>;
          closed?: boolean;
        }>;
      };
      const imagePath = join(cfg.libraryPath, fileName);
      const detail = db.getDetail(fileName);
      const name = detail?.title ?? fileName.replace(/\.[^.]+$/, '');

      return pushSceneToFoundry({
        foundryMcpUrl: cfg.foundryMcpUrl,
        name,
        imagePath,
        uvttData: {
          resolution: uvttRaw.resolution,
          line_of_sight: uvttRaw.line_of_sight,
          portals: uvttRaw.portals,
        },
      });
    },
  );
}
