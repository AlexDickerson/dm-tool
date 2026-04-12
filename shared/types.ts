// Shared types between the Electron main process and the React renderer.
//
// These mirror the shape of rows in the map-tagger SQLite index and of the
// JSON sidecars written next to each map. Keep this file dependency-free so
// both sides of the contextBridge can import it without pulling in runtime
// modules they don't have access to.

/** Controlled vocabulary — kept loose on the TS side since the DB is the
 *  source of truth and we don't want to break the app if the Python side
 *  adds a new value. */
export type InteriorExterior = "interior" | "exterior" | "mixed" | "unknown";
export type TimeOfDay = "day" | "dusk" | "night" | "dawn" | "unknown";
export type GridVisible = "gridded" | "gridless" | "unknown";

/** A lightweight row used by the browser grid. This is what `searchMaps`
 *  returns — enough to render a thumbnail, title, and a few chips without
 *  the full sidecar payload. */
export interface MapSummary {
  fileName: string;
  title: string;
  description: string;
  interiorExterior: InteriorExterior | null;
  timeOfDay: TimeOfDay | null;
  gridVisible: GridVisible | null;
  gridCells: string | null;
  approxPartyScale: string | null;
}

/** The full sidecar contents for a single map, used by the detail pane. */
export interface MapDetail extends MapSummary {
  fileHashSha256: string;
  phash: string;
  widthPx: number;
  heightPx: number;
  biomes: string[];
  locationTypes: string[];
  mood: string[];
  features: string[];
  encounterHooks: string[];
  /** Additional encounter hooks generated client-side via the Anthropic
   *  API and persisted to a dm-tool-owned override file (see
   *  electron/hooks-store.ts). The DB is read-only, so these can't live
   *  in the sidecar JSON. Newest first — UI prepends to this list when
   *  the user clicks the refresh button. */
  additionalEncounterHooks: string[];
  taggedAt: string; // ISO 8601
  model: string;
}

export interface SearchParams {
  keywords?: string;
  biomes?: string[];
  locationTypes?: string[];
  mood?: string[];
  features?: string[];
  interiorExterior?: InteriorExterior;
  timeOfDay?: TimeOfDay;
  gridVisible?: GridVisible;
  limit?: number;
}

/** Distinct tag values returned by `listFacets` so the filter panel can
 *  show checkboxes without hardcoding the enum lists. */
export interface Facets {
  biomes: string[];
  locationTypes: string[];
  moods: string[];
  features: string[];
}

/** The IPC surface exposed to the renderer via contextBridge. Every
 *  function here must have a corresponding handler registered in ipc.ts
 *  and a corresponding type declaration on `window.electronAPI` in the
 *  renderer's global types. */
export interface ElectronAPI {
  searchMaps(params: SearchParams): Promise<MapSummary[]>;
  getMapDetail(fileName: string): Promise<MapDetail | null>;
  getFacets(): Promise<Facets>;
  getLibraryPath(): Promise<string>;
  openInExplorer(fileName: string): Promise<void>;
  /** Update the native title bar overlay height at runtime so the OS
   *  min/max/close button strip stays matched to the React header when
   *  the user changes the UI scale in settings. */
  setTitleBarOverlayHeight(height: number): Promise<void>;
  /** Generate fresh encounter hooks for a map via the Anthropic API and
   *  append them to the dm-tool override store. Returns the FULL list of
   *  additional hooks (newest first) so the renderer can replace its
   *  local state in one shot. The API key is passed in by the renderer
   *  rather than read from disk in main — the renderer owns persistence
   *  via localStorage and we want to avoid duplicating that. */
  regenerateEncounterHooks(args: {
    fileName: string;
    apiKey: string;
  }): Promise<string[]>;
}
