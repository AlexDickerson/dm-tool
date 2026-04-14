import { dialog, ipcMain } from 'electron';
import type { DmToolConfig } from '../config.js';
import type { TaggerRunArgs, TaggerResult } from '../../shared/types.js';
import { runTagger, cancelTagger, isTaggerRunning } from '../tagger.js';

export function registerTaggerHandlers(
  cfg: DmToolConfig,
  getMainWindow: () => Electron.BrowserWindow | null,
): void {
  ipcMain.handle('taggerPickSource', async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select folder containing new maps',
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  const sendTaggerProgress = (p: { type: string; line: string }) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('tagger-progress', p);
    }
  };

  ipcMain.handle('taggerPreview', async (_e, args: TaggerRunArgs): Promise<TaggerResult> => {
    return runTagger(cfg, { ...args, preview: true }, sendTaggerProgress);
  });

  ipcMain.handle('taggerIngest', async (_e, args: TaggerRunArgs): Promise<TaggerResult> => {
    return runTagger(cfg, { ...args, preview: false }, sendTaggerProgress);
  });

  ipcMain.handle('taggerCancel', (): boolean => {
    return cancelTagger();
  });

  ipcMain.handle('taggerIsRunning', (): boolean => {
    return isTaggerRunning();
  });
}
