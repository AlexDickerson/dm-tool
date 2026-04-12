// Wires the MapDb into ipcMain handlers matching the ElectronAPI surface.
//
// Every handler name here must match exactly the method name on
// `shared/types.ts::ElectronAPI` and the corresponding contextBridge
// exposure in preload.ts — the three files form one contract.

import { ipcMain, shell } from "electron";
import { join } from "node:path";
import type { MapDb } from "./db.js";
import type { DmToolConfig } from "./config.js";
import type { MapDetail, SearchParams } from "../shared/types.js";
import {
  appendAdditionalHooks,
  getAdditionalHooks,
} from "./hooks-store.js";
import { generateEncounterHooks } from "./anthropic.js";

export function registerIpcHandlers(db: MapDb, cfg: DmToolConfig): void {
  ipcMain.handle("searchMaps", (_e, params: SearchParams) => {
    return db.search(params ?? {});
  });

  // The base detail comes from the read-only DB; we layer on the
  // dm-tool-owned override list of additional encounter hooks before
  // returning. Renderer doesn't have to know the two storage layers exist.
  ipcMain.handle("getMapDetail", (_e, fileName: string): MapDetail | null => {
    const detail = db.getDetail(fileName);
    if (!detail) return null;
    return {
      ...detail,
      additionalEncounterHooks: getAdditionalHooks(fileName),
    };
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

  // Regenerate encounter hooks via the Anthropic API and persist them to
  // the override store. Returns the FULL list of additional hooks (newest
  // first) so the renderer can swap its local state in one assignment.
  ipcMain.handle(
    "regenerateEncounterHooks",
    async (
      _e,
      args: { fileName: string; apiKey: string },
    ): Promise<string[]> => {
      if (!args || typeof args.fileName !== "string") {
        throw new Error("regenerateEncounterHooks: fileName is required");
      }
      // Reject anything but a plain filename — same defense as
      // openInExplorer. The fileName flows into a disk path inside
      // anthropic.ts and we don't want a renderer bug to walk the FS.
      if (args.fileName.includes("/") || args.fileName.includes("\\")) {
        throw new Error(
          "regenerateEncounterHooks: fileName must not contain path separators",
        );
      }

      const baseDetail = db.getDetail(args.fileName);
      if (!baseDetail) {
        throw new Error(`Unknown map: ${args.fileName}`);
      }
      // Build a MapDetail with the current additional hooks merged in so
      // the prompt can ask the model not to repeat them.
      const detail: MapDetail = {
        ...baseDetail,
        additionalEncounterHooks: getAdditionalHooks(args.fileName),
      };

      const newHooks = await generateEncounterHooks({
        apiKey: args.apiKey,
        libraryPath: cfg.libraryPath,
        detail,
      });
      return appendAdditionalHooks(args.fileName, newHooks);
    },
  );
}
