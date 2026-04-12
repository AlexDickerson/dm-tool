// Minimal IPC handlers registered in setup mode (first run, no config.json).
// Only exposes the handful of channels needed for the setup screen and the
// shared title-bar overlay. Everything else (maps, books, chat, tagger, etc.)
// is unavailable until a valid config exists and the app restarts.

import { app, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { ConfigPaths, PickPathArgs } from '../shared/types.js';

export function registerSetupIpcHandlers(_getMainWindow: () => Electron.BrowserWindow | null): void {
  ipcMain.handle('getAppMode', (): 'normal' | 'setup' => 'setup');

  // Config is not loaded yet — return empty paths.
  ipcMain.handle(
    'getConfig',
    (): ConfigPaths => ({
      libraryPath: '',
      indexDbPath: '',
      inboxPath: '',
      quarantinePath: '',
      taggerBinPath: '',
      booksPath: '',
      autoWallBinPath: '',
      pf2eDbPath: '',
    }),
  );

  ipcMain.handle('pickPath', async (_e, args: PickPathArgs): Promise<string | null> => {
    const properties: ('openDirectory' | 'openFile')[] = [args.mode === 'directory' ? 'openDirectory' : 'openFile'];
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: args.title ?? (args.mode === 'directory' ? 'Select folder' : 'Select file'),
      properties,
      filters: args.filters,
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  ipcMain.handle('saveConfigAndRestart', async (_e, paths: ConfigPaths): Promise<void> => {
    const required = ['libraryPath', 'indexDbPath', 'inboxPath', 'quarantinePath'] as const;
    for (const field of required) {
      if (!paths[field] || typeof paths[field] !== 'string' || !paths[field].trim()) {
        throw new Error(`${field} is required`);
      }
    }

    const config: Record<string, string> = {
      libraryPath: paths.libraryPath,
      indexDbPath: paths.indexDbPath,
      inboxPath: paths.inboxPath,
      quarantinePath: paths.quarantinePath,
    };
    if (paths.taggerBinPath?.trim()) config.taggerBinPath = paths.taggerBinPath;
    if (paths.booksPath?.trim()) config.booksPath = paths.booksPath;
    if (paths.autoWallBinPath?.trim()) config.autoWallBinPath = paths.autoWallBinPath;
    if (paths.pf2eDbPath?.trim()) config.pf2eDbPath = paths.pf2eDbPath;

    const outPath = join(app.getPath('userData'), 'config.json');
    await writeFile(outPath, JSON.stringify(config, null, 2), 'utf-8');

    app.relaunch();
    app.exit(0);
  });
}
