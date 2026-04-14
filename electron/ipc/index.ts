// Wires the MapDb and BookDb into ipcMain handlers matching the
// ElectronAPI surface.
//
// Every handler name here must match exactly the method name on
// `shared/types.ts::ElectronAPI` and the corresponding contextBridge
// exposure in preload.ts — the three files form one contract.

import type { MapDb } from '../db.js';
import type { BookDb } from '../book-db.js';
import type { DmToolConfig } from '../config.js';
import { registerMapHandlers } from './maps.js';
import { registerBookHandlers } from './books.js';
import { registerChatHandlers } from './chat.js';
import { registerMonsterHandlers } from './monsters.js';
import { registerItemHandlers } from './items.js';
import { registerTaggerHandlers } from './tagger.js';
import { registerAutoWallHandlers } from './auto-wall.js';
import { registerFoundryHandlers } from './foundry.js';
import { registerPackGroupingHandlers } from './pack-grouping.js';
import { registerConfigHandlers } from './config.js';

export function registerIpcHandlers(
  db: MapDb,
  bookDb: BookDb | null,
  cfg: DmToolConfig,
  getMainWindow: () => Electron.BrowserWindow | null,
): void {
  registerMapHandlers(db, cfg);
  registerBookHandlers(bookDb, cfg, getMainWindow);
  registerChatHandlers(getMainWindow);
  registerMonsterHandlers();
  registerItemHandlers(cfg);
  registerTaggerHandlers(cfg, getMainWindow);
  registerAutoWallHandlers(cfg);
  registerFoundryHandlers(db, cfg);
  registerPackGroupingHandlers(db);
  registerConfigHandlers(db, cfg);
}
