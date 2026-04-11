// Wires the MapDb into ipcMain handlers matching the ElectronAPI surface.
//
// Every handler name here must match exactly the method name on
// `shared/types.ts::ElectronAPI` and the corresponding contextBridge
// exposure in preload.ts — the three files form one contract.

import { ipcMain, shell } from "electron";
import { join } from "node:path";
import type { MapDb } from "./db.js";
import type { DmToolConfig } from "./config.js";
import type { SearchParams } from "../shared/types.js";

export function registerIpcHandlers(db: MapDb, cfg: DmToolConfig): void {
  ipcMain.handle("searchMaps", (_e, params: SearchParams) => {
    return db.search(params ?? {});
  });

  ipcMain.handle("getMapDetail", (_e, fileName: string) => {
    return db.getDetail(fileName);
  });

  ipcMain.handle("getFacets", () => {
    return db.getFacets();
  });

  ipcMain.handle("getLibraryPath", () => {
    return cfg.libraryPath;
  });

  ipcMain.handle("openInExplorer", async (_e, fileName: string) => {
    // shell.showItemInFolder opens the OS file browser with the file
    // selected — on Windows that's Explorer, on macOS that's Finder.
    // We deliberately only accept a plain filename (no separators) to
    // avoid any path traversal via the renderer.
    if (fileName.includes("/") || fileName.includes("\\")) {
      throw new Error("openInExplorer: fileName must not contain path separators");
    }
    const fullPath = join(cfg.libraryPath, fileName);
    shell.showItemInFolder(fullPath);
  });
}
