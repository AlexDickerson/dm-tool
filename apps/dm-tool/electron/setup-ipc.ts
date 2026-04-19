// Minimal IPC handlers registered in setup mode (first run — DB exists
// but the settings table is empty). Only exposes the handful of channels
// needed for the setup screen and the shared title-bar overlay.
// Everything else (maps, books, chat, tagger, etc.) is unavailable until
// the user completes setup and the app restarts.

import { app, dialog, ipcMain } from 'electron';
import type { ConfigPaths, PickPathArgs } from '@dm-tool/shared/types';
import { replaceSettings } from '@dm-tool/db/pf2e';

export function registerSetupIpcHandlers(_getMainWindow: () => Electron.BrowserWindow | null): void {
  ipcMain.handle('getAppMode', (): 'normal' | 'setup' => 'setup');

  // Config is not loaded yet — return empty paths so the controlled
  // inputs in SetupScreen render cleanly.
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
      foundryMcpUrl: '',
      obsidianVaultPath: '',
      playerMapPublicUrl: '',
      sidecarUrl: '',
      sidecarSecret: '',
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

    writeSettings(paths);

    // app.relaunch() drops electron-vite's dev-server context and leaves
    // the renderer blank. Only auto-relaunch in packaged builds.
    if (app.isPackaged) {
      app.relaunch();
      app.exit(0);
    } else {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Settings saved',
        message: 'Dm-tool will now close.',
        detail: 'Run `npm run dev` again to relaunch with the new settings.',
      });
      app.exit(0);
    }
  });
}

export function writeSettings(paths: ConfigPaths): void {
  const settings: Record<string, string> = {
    libraryPath: paths.libraryPath,
    indexDbPath: paths.indexDbPath,
    inboxPath: paths.inboxPath,
    quarantinePath: paths.quarantinePath,
  };
  const optional: Array<keyof ConfigPaths> = [
    'taggerBinPath',
    'booksPath',
    'autoWallBinPath',
    'foundryMcpUrl',
    'obsidianVaultPath',
    'playerMapPublicUrl',
    'sidecarUrl',
    'sidecarSecret',
  ];
  for (const key of optional) {
    const v = paths[key];
    if (typeof v === 'string' && v.trim().length > 0) settings[key] = v.trim();
  }
  replaceSettings(settings);
}
