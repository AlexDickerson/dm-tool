// Preload script — the only module with access to both Node APIs and the
// renderer's window. Exposes a narrow, typed surface via contextBridge so
// the React code never sees ipcRenderer directly.
//
// Every method exposed here must be named identically to the corresponding
// ipcMain.handle() call in ipc.ts. Changes here must be mirrored in
// src/vite-env.d.ts which declares `window.electronAPI` for TypeScript.

import { contextBridge, ipcRenderer } from "electron";
import type {
  Book,
  BookScanResult,
  ElectronAPI,
  Facets,
  FinalizeIngestArgs,
  MapDetail,
  MapSummary,
  SearchParams,
} from "../shared/types.js";

const api: ElectronAPI = {
  searchMaps: (params: SearchParams): Promise<MapSummary[]> =>
    ipcRenderer.invoke("searchMaps", params),
  getMapDetail: (fileName: string): Promise<MapDetail | null> =>
    ipcRenderer.invoke("getMapDetail", fileName),
  getFacets: (): Promise<Facets> => ipcRenderer.invoke("getFacets"),
  getLibraryPath: (): Promise<string> => ipcRenderer.invoke("getLibraryPath"),
  openInExplorer: (fileName: string): Promise<void> =>
    ipcRenderer.invoke("openInExplorer", fileName),
  setTitleBarOverlayHeight: (height: number): Promise<void> =>
    ipcRenderer.invoke("setTitleBarOverlayHeight", height),
  regenerateEncounterHooks: (args: {
    fileName: string;
    apiKey: string;
  }): Promise<string[]> =>
    ipcRenderer.invoke("regenerateEncounterHooks", args),

  // Book catalog + reader
  booksScan: (): Promise<BookScanResult> => ipcRenderer.invoke("booksScan"),
  booksList: (): Promise<Book[]> => ipcRenderer.invoke("booksList"),
  booksGet: (id: number): Promise<Book | null> =>
    ipcRenderer.invoke("booksGet", id),
  booksFinalizeIngest: (args: FinalizeIngestArgs): Promise<Book> =>
    ipcRenderer.invoke("booksFinalizeIngest", args),
  booksGetFileUrl: (id: number): Promise<string> =>
    ipcRenderer.invoke("booksGetFileUrl", id),
  booksGetCoverUrl: (id: number): Promise<string> =>
    ipcRenderer.invoke("booksGetCoverUrl", id),
};

contextBridge.exposeInMainWorld("electronAPI", api);
