// Minimal IPC handlers registered in setup mode (first run — DB exists
// but the settings table is empty). Only exposes the handful of channels
// needed for the setup screen and the shared title-bar overlay.
// Everything else (maps, books, chat, tagger, etc.) is unavailable until
// the user completes setup and the app restarts.

import { ipcMain } from 'electron';
import type { ConfigPaths, PickPathArgs } from '@dm-tool/shared/types';
import { replaceSettings } from '@dm-tool/db/pf2e';
import { handlePickPath, handleSaveConfigAndRestart } from './ipc/shared.js';

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

  ipcMain.handle('pickPath', (_e, args: PickPathArgs) => handlePickPath(args));

  ipcMain.handle('saveConfigAndRestart', (_e, paths: ConfigPaths) => handleSaveConfigAndRestart(paths));
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
