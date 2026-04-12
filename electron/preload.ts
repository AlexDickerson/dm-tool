// Preload script — the only module with access to both Node APIs and the
// renderer's window. Exposes a narrow, typed surface via contextBridge so
// the React code never sees ipcRenderer directly.
//
// Every method exposed here must be named identically to the corresponding
// ipcMain.handle() call in ipc.ts. Changes here must be mirrored in
// src/vite-env.d.ts which declares `window.electronAPI` for TypeScript.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AonPreviewData,
  Book,
  BookScanResult,
  ChatChunk,
  ChatMessage,
  ChatModel,
  ConfigPaths,
  ElectronAPI,
  Facets,
  FinalizeIngestArgs,
  MapDetail,
  MapSummary,
  PickPathArgs,
  SearchParams,
  TaggerProgress,
  TaggerRunArgs,
  TaggerResult,
} from '../shared/types.js';

const api: ElectronAPI = {
  // App mode + config
  getAppMode: (): Promise<'normal' | 'setup'> => ipcRenderer.invoke('getAppMode'),
  getConfig: (): Promise<ConfigPaths> => ipcRenderer.invoke('getConfig'),
  pickPath: (args: PickPathArgs): Promise<string | null> => ipcRenderer.invoke('pickPath', args),
  saveConfigAndRestart: (paths: ConfigPaths): Promise<void> => ipcRenderer.invoke('saveConfigAndRestart', paths),

  // Maps
  searchMaps: (params: SearchParams): Promise<MapSummary[]> => ipcRenderer.invoke('searchMaps', params),
  getMapDetail: (fileName: string): Promise<MapDetail | null> => ipcRenderer.invoke('getMapDetail', fileName),
  getFacets: (): Promise<Facets> => ipcRenderer.invoke('getFacets'),
  getLibraryPath: (): Promise<string> => ipcRenderer.invoke('getLibraryPath'),
  openInExplorer: (fileName: string): Promise<void> => ipcRenderer.invoke('openInExplorer', fileName),
  setTitleBarOverlayHeight: (height: number): Promise<void> => ipcRenderer.invoke('setTitleBarOverlayHeight', height),
  regenerateEncounterHooks: (args: { fileName: string; apiKey: string }): Promise<string[]> =>
    ipcRenderer.invoke('regenerateEncounterHooks', args),

  // Chat
  chatSend: (args: { messages: ChatMessage[]; apiKey: string; model?: ChatModel }): Promise<void> =>
    ipcRenderer.invoke('chatSend', args),
  onChatChunk: (callback: (chunk: ChatChunk) => void): (() => void) => {
    const handler = (_event: unknown, chunk: ChatChunk) => callback(chunk);
    ipcRenderer.on('chat-chunk', handler);
    return () => ipcRenderer.removeListener('chat-chunk', handler);
  },

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('openExternal', url),
  aonPreview: (urlPath: string): Promise<AonPreviewData | null> => ipcRenderer.invoke('aonPreview', urlPath),

  // Book catalog + reader
  booksScan: (): Promise<BookScanResult> => ipcRenderer.invoke('booksScan'),
  booksList: (): Promise<Book[]> => ipcRenderer.invoke('booksList'),
  booksGet: (id: number): Promise<Book | null> => ipcRenderer.invoke('booksGet', id),
  booksFinalizeIngest: (args: FinalizeIngestArgs): Promise<Book> => ipcRenderer.invoke('booksFinalizeIngest', args),
  booksGetFileUrl: (id: number): Promise<string> => ipcRenderer.invoke('booksGetFileUrl', id),
  booksGetCoverUrl: (id: number): Promise<string> => ipcRenderer.invoke('booksGetCoverUrl', id),

  // Map tagger
  taggerPickSource: (): Promise<string | null> => ipcRenderer.invoke('taggerPickSource'),
  taggerPreview: (args: TaggerRunArgs): Promise<TaggerResult> => ipcRenderer.invoke('taggerPreview', args),
  taggerIngest: (args: TaggerRunArgs): Promise<TaggerResult> => ipcRenderer.invoke('taggerIngest', args),
  taggerCancel: (): Promise<boolean> => ipcRenderer.invoke('taggerCancel'),
  taggerIsRunning: (): Promise<boolean> => ipcRenderer.invoke('taggerIsRunning'),
  onTaggerProgress: (callback: (p: TaggerProgress) => void): (() => void) => {
    const handler = (_event: unknown, p: TaggerProgress) => callback(p);
    ipcRenderer.on('tagger-progress', handler);
    return () => ipcRenderer.removeListener('tagger-progress', handler);
  },

  // Pack grouping
  getPackMapping: (): Promise<Record<string, string> | null> => ipcRenderer.invoke('getPackMapping'),
  exportPackGroupingPrompt: (): Promise<string> => ipcRenderer.invoke('exportPackGroupingPrompt'),
  importPackMappingFromFile: (): Promise<Record<string, string> | null> =>
    ipcRenderer.invoke('importPackMappingFromFile'),
  mergePacks: (args: { sourcePacks: string[]; targetName: string }): Promise<Record<string, string>> =>
    ipcRenderer.invoke('mergePacks', args),

  // Auto-Wall
  autoWallAvailable: (): Promise<boolean> => ipcRenderer.invoke('autoWallAvailable'),
  autoWallLaunch: (fileName: string): Promise<void> => ipcRenderer.invoke('autoWallLaunch', fileName),
  autoWallHasUvtt: (fileName: string): Promise<boolean> => ipcRenderer.invoke('autoWallHasUvtt', fileName),
  autoWallGetWalls: (
    fileName: string,
  ): Promise<{ walls: number[][]; width: number; height: number } | null> =>
    ipcRenderer.invoke('autoWallGetWalls', fileName),
  autoWallImportUvtt: (fileName: string): Promise<boolean> => ipcRenderer.invoke('autoWallImportUvtt', fileName),
};

contextBridge.exposeInMainWorld('electronAPI', api);
