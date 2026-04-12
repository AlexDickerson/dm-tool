// Wires the MapDb and BookDb into ipcMain handlers matching the
// ElectronAPI surface.
//
// Every handler name here must match exactly the method name on
// `shared/types.ts::ElectronAPI` and the corresponding contextBridge
// exposure in preload.ts — the three files form one contract.

import { app, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { MapDb } from "./db.js";
import type { BookDb } from "./book-db.js";
import type { DmToolConfig } from "./config.js";
import type {
  Book,
  BookScanResult,
  ChatMessage,
  ChatModel,
  FinalizeIngestArgs,
  MapDetail,
  SearchParams,
  TaggerRunArgs,
  TaggerResult,
} from "../shared/types.js";
import {
  appendAdditionalHooks,
  getAdditionalHooks,
} from "./hooks-store.js";
import { generateEncounterHooks } from "./anthropic.js";
import { streamChat } from "./chat.js";
import { fetchAonPreview } from "./aon-preview.js";
import { getMonsterPreview } from "./pf2e-db.js";
import { scanBookRoot } from "./book-scanner.js";
import {
  buildGroupingPrompt,
  getCachedPackMapping,
  mergePacks,
  parseAndCacheMapping,
} from "./pack-grouper.js";
import {
  runTagger,
  cancelTagger,
  isTaggerRunning,
} from "./tagger.js";

/** Resolved paths for the book cover cache. Computed once at startup so
 *  every handler doesn't have to recompute them. `relative` is the
 *  per-book subdirectory name that's stored in the DB's cover_path column
 *  — staying relative keeps the DB portable across userData moves. */
interface CoverPaths {
  /** Absolute path to the cover cache root, e.g.
   *  `C:/Users/foo/AppData/Roaming/dm-tool/book-covers`. */
  absRoot: string;
}

export function registerIpcHandlers(
  db: MapDb,
  bookDb: BookDb | null,
  cfg: DmToolConfig,
  getMainWindow: () => Electron.BrowserWindow | null,
): void {
  const coverPaths: CoverPaths = {
    absRoot: join(app.getPath("userData"), "book-covers"),
  };

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

  ipcMain.handle("aonPreview", async (_e, urlPath: string) => {
    if (typeof urlPath !== "string") return null;

    // Try local DB first for creature URLs.
    if (urlPath.includes("Monsters.aspx")) {
      try {
        const fullUrl = `https://2e.aonprd.com${urlPath}`;
        const local = getMonsterPreview(fullUrl);
        if (local) {
          return {
            type: "creature" as const,
            name: local.name,
            level: local.level,
            hp: local.hp,
            ac: local.ac,
            fortitude: local.fort,
            reflex: local.ref,
            will: local.will,
            perception: local.perception,
            speed: local.speed,
            size: local.size,
            traits: local.traits,
            abilities: [],
            immunities: local.immunities ? local.immunities.split(", ") : [],
            weaknesses: local.weaknesses,
            rarity: local.rarity.toLowerCase(),
            summary: local.description.slice(0, 200),
            strength: local.str,
            dexterity: local.dex,
            constitution: local.con,
            intelligence: local.int,
            wisdom: local.wis,
            charisma: local.cha,
            statBlock: local.abilities + "\n---\n" + (local.melee ? `Melee ${local.melee}` : "") + (local.ranged ? `\nRanged ${local.ranged}` : ""),
          };
        }
      } catch { /* fall through to AoN */ }
    }

    return fetchAonPreview(urlPath);
  });

  ipcMain.handle("openExternal", async (_e, url: string) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
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

  // --- Chat ---------------------------------------------------------------

  ipcMain.handle(
    "chatSend",
    async (
      _e,
      args: { messages: ChatMessage[]; apiKey: string; model?: ChatModel },
    ): Promise<void> => {
      if (!args?.apiKey) {
        throw new Error("chatSend: apiKey is required");
      }
      const win = getMainWindow();
      const sendChunk = (chunk: { type: string; text?: string; error?: string }) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("chat-chunk", chunk);
        }
      };

      try {
        await streamChat({
          apiKey: args.apiKey,
          messages: args.messages ?? [],
          model: args.model,
          onChunk: sendChunk,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendChunk({ type: "error", error: message });
      }
    },
  );

  // --- Book catalog + reader --------------------------------------------

  const requireBookDb = (): BookDb => {
    if (!bookDb) {
      throw new Error(
        "Book catalog not configured. Set `booksPath` in config.json to the root of your PDF library.",
      );
    }
    return bookDb;
  };

  ipcMain.handle("booksScan", async (): Promise<BookScanResult> => {
    const b = requireBookDb();
    if (!cfg.booksPath) {
      throw new Error("booksScan: booksPath is not set");
    }
    const scanned = scanBookRoot(cfg.booksPath);
    return b.reconcile(scanned);
  });

  ipcMain.handle("booksList", async (): Promise<Book[]> => {
    return requireBookDb().listAll();
  });

  ipcMain.handle("booksGet", async (_e, id: number): Promise<Book | null> => {
    return requireBookDb().getById(id);
  });

  ipcMain.handle(
    "booksFinalizeIngest",
    async (_e, args: FinalizeIngestArgs): Promise<Book> => {
      const b = requireBookDb();
      if (!args || typeof args.id !== "number" || typeof args.pageCount !== "number") {
        throw new Error("booksFinalizeIngest: id and pageCount are required");
      }
      if (!(args.coverPngBytes instanceof Uint8Array)) {
        throw new Error("booksFinalizeIngest: coverPngBytes must be a Uint8Array");
      }
      const existing = b.getById(args.id);
      if (!existing) {
        throw new Error(`booksFinalizeIngest: unknown book id ${args.id}`);
      }

      await mkdir(coverPaths.absRoot, { recursive: true });
      const relName = `${args.id}.png`;
      const absPath = join(coverPaths.absRoot, relName);
      await writeFile(absPath, args.coverPngBytes);

      const updated = b.finalizeIngest(args.id, args.pageCount, relName);
      if (!updated) {
        throw new Error(`booksFinalizeIngest: row vanished for id ${args.id}`);
      }
      return updated;
    },
  );

  ipcMain.handle("booksGetFileUrl", async (_e, id: number): Promise<string> => {
    const b = requireBookDb();
    const path = b.getPath(id);
    if (!path) throw new Error(`booksGetFileUrl: unknown book id ${id}`);
    return `book-file://files/${id}`;
  });

  ipcMain.handle("booksGetCoverUrl", async (_e, id: number): Promise<string> => {
    requireBookDb();
    return `book-file://covers/${id}`;
  });

  // -----------------------------------------------------------------------
  // Map tagger (ingest new maps)
  // -----------------------------------------------------------------------

  ipcMain.handle(
    "taggerPickSource",
    async (): Promise<string | null> => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: "Select folder containing new maps",
        properties: ["openDirectory"],
      });
      if (canceled || filePaths.length === 0) return null;
      return filePaths[0];
    },
  );

  const sendTaggerProgress = (p: { type: string; line: string }) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("tagger-progress", p);
    }
  };

  ipcMain.handle(
    "taggerPreview",
    async (_e, args: TaggerRunArgs): Promise<TaggerResult> => {
      return runTagger(cfg, { ...args, preview: true }, sendTaggerProgress);
    },
  );

  ipcMain.handle(
    "taggerIngest",
    async (_e, args: TaggerRunArgs): Promise<TaggerResult> => {
      return runTagger(cfg, { ...args, preview: false }, sendTaggerProgress);
    },
  );

  ipcMain.handle("taggerCancel", (): boolean => {
    return cancelTagger();
  });

  ipcMain.handle("taggerIsRunning", (): boolean => {
    return isTaggerRunning();
  });

  // -----------------------------------------------------------------------
  // Pack grouping
  // -----------------------------------------------------------------------

  ipcMain.handle("getPackMapping", () => {
    const fileNames = db.allFileNames();
    return getCachedPackMapping(fileNames);
  });

  ipcMain.handle("exportPackGroupingPrompt", () => {
    const fileNames = db.allFileNames();
    return buildGroupingPrompt(fileNames);
  });

  ipcMain.handle(
    "importPackMappingFromFile",
    async (): Promise<Record<string, string> | null> => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: "Import pack grouping JSON",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });
      if (canceled || filePaths.length === 0) return null;
      const { readFileSync } = await import("node:fs");
      const jsonText = readFileSync(filePaths[0], "utf-8");
      const fileNames = db.allFileNames();
      return parseAndCacheMapping(jsonText, fileNames);
    },
  );

  ipcMain.handle(
    "mergePacks",
    (
      _e,
      args: { sourcePacks: string[]; targetName: string },
    ): Record<string, string> | null => {
      return mergePacks(args.sourcePacks, args.targetName);
    },
  );
}
