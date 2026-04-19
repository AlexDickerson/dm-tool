// Shared IPC handler helpers used by both setup-ipc.ts and ipc/config.ts.
// Extracted to avoid duplicating the pickPath dialog logic and the
// saveConfigAndRestart validation + relaunch sequence.

import { app, dialog } from 'electron';
import type { ConfigPaths, PickPathArgs } from '@dm-tool/shared/types';
import { writeSettings } from '../setup-ipc.js';

/** Show a native file/folder picker. Returns the selected path, or null
 *  if the user cancelled. */
export async function handlePickPath(args: PickPathArgs): Promise<string | null> {
  const properties: ('openDirectory' | 'openFile')[] = [args.mode === 'directory' ? 'openDirectory' : 'openFile'];
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: args.title ?? (args.mode === 'directory' ? 'Select folder' : 'Select file'),
    properties,
    filters: args.filters,
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
}

/** Validate required config fields, persist to DB, and exit (with
 *  auto-relaunch in packaged builds). */
export async function handleSaveConfigAndRestart(paths: ConfigPaths): Promise<void> {
  const required = ['libraryPath', 'indexDbPath', 'inboxPath', 'quarantinePath'] as const;
  for (const field of required) {
    if (!paths[field] || typeof paths[field] !== 'string' || !paths[field].trim()) {
      throw new Error(`${field} is required`);
    }
  }

  writeSettings(paths);

  // app.relaunch() respawns Electron directly, which works in a
  // packaged build but drops the electron-vite dev-server context in
  // dev mode (renderer comes back blank). Only auto-relaunch in prod;
  // in dev just exit and let the user re-run `npm run dev`.
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
}
