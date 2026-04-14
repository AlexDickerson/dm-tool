// Auto-update module using electron-updater.
//
// Checks GitHub Releases for a newer version on startup. Downloads are
// NOT automatic — the renderer must explicitly request a download via
// the `updater:download` IPC call after the user confirms. Once
// downloaded, the renderer can call `updater:install` to quit and
// install the update.
//
// All status changes are pushed to the renderer via webContents.send()
// so the UI can show a notification banner.

import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

function send(win: BrowserWindow | null, status: UpdateStatus): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', status);
  }
}

/** Initialize the auto-updater. Call once after the main window is created.
 *  Does nothing in dev mode (un-packaged builds). */
export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  // Don't auto-download — wait for the user to confirm.
  autoUpdater.autoDownload = false;
  // Don't auto-install on quit — let the user choose when to restart.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    send(getWindow(), { state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    send(getWindow(), {
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on('update-not-available', () => {
    send(getWindow(), { state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    send(getWindow(), { state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    send(getWindow(), { state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
    send(getWindow(), { state: 'error', message: err.message });
  });

  // IPC: renderer asks to download the available update.
  ipcMain.handle('updater:download', async () => {
    await autoUpdater.downloadUpdate();
  });

  // IPC: renderer asks to quit and install.
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall();
  });

  // IPC: renderer asks for the current app version.
  ipcMain.handle('getAppVersion', () => app.getVersion());

  // Check for updates after a short delay so the window has time to load.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Update check failed:', err.message);
    });
  }, 5000);
}
