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

// ---------------------------------------------------------------------------
// Book catalog + reader
// ---------------------------------------------------------------------------

/** One row in the `books` table. Matches the SQLite schema in
 *  electron/book-db.ts one-to-one except for naming (snake_case in SQL,
 *  camelCase here) and the omitted `path` field — the renderer never sees
 *  the absolute path, it accesses PDFs via `book-file://files/<id>` URLs
 *  served by the main process. */
export interface Book {
  id: number;
  title: string;
  category: string;
  subcategory: string | null;
  ruleset: "legacy" | "remastered" | null;
  pageCount: number | null;
  fileSize: number;
  /** True once phase-2 ingest has run — we have a cached cover PNG and a
   *  real page count. Covers are fetched by the renderer via
   *  `book-file://covers/<id>` URLs; if this is false, the UI should show
   *  a placeholder instead of a broken image. */
  ingested: boolean;
}

/** Result of a phase-1 scan. Summary counts only — if the renderer needs
 *  the new data it calls `listBooks()` after the scan resolves. */
export interface BookScanResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/** Renderer-to-main IPC payload for the phase-2 ingest finalize step. The
 *  renderer does the PDF rendering (so we don't have to build node-canvas
 *  on Windows) and ships the cover PNG bytes back as a plain Uint8Array
 *  via structured clone. */
export interface FinalizeIngestArgs {
  id: number;
  pageCount: number;
  /** Raw bytes of a 300 px-wide PNG. Main writes this to
   *  `<userData>/book-covers/<id>.png`. */
  coverPngBytes: Uint8Array;
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

  // -----------------------------------------------------------------------
  // Book catalog + reader
  // -----------------------------------------------------------------------

  /** Walk the configured books root and reconcile the `books` table with
   *  what's on disk. Cheap — file metadata only, no PDF parsing. Runs
   *  automatically at startup; the UI also exposes a "Rescan" button for
   *  manual refresh after the user adds/removes PDFs. */
  booksScan(): Promise<BookScanResult>;
  /** All rows in the catalog, sorted by category → subcategory → title. */
  booksList(): Promise<Book[]>;
  /** Fetch a single book by id. Returns null if the id is unknown (e.g.
   *  the renderer had a stale list and the row was removed by a rescan). */
  booksGet(id: number): Promise<Book | null>;
  /** Finalize phase-2 ingest: main writes the cover PNG to
   *  `<userData>/book-covers/<id>.png`, updates the page_count +
   *  ingested_at columns, and returns the fresh Book row. */
  booksFinalizeIngest(args: FinalizeIngestArgs): Promise<Book>;
  /** The `book-file://files/<id>` URL the renderer should hand to pdfjs.
   *  The main process resolves the id back to the absolute path at fetch
   *  time, so the renderer never sees the real filesystem path — keeps
   *  the renderer out of the file tree entirely. */
  booksGetFileUrl(id: number): Promise<string>;
  /** The `book-file://covers/<id>` URL the renderer should hand to an
   *  <img> tag. Returns the URL even if the cover doesn't exist yet — the
   *  <img> tag's onError handler will fall back to a placeholder, and
   *  once ingest completes the URL starts resolving. */
  booksGetCoverUrl(id: number): Promise<string>;

  // -----------------------------------------------------------------------
  // Pack grouping (AI-driven variant clustering)
  // -----------------------------------------------------------------------

  /** Return the cached pack mapping if it's up-to-date with the current
   *  library. Returns null when an import is needed. */
  getPackMapping(): Promise<Record<string, string> | null>;
  /** Build the prompt text the user should send to Claude to generate
   *  the pack grouping. The user copies this, pastes it into Claude,
   *  and imports the JSON response back. */
  exportPackGroupingPrompt(): Promise<string>;
  /** Open a file picker for a .json file, parse and cache the pack
   *  mapping from it. Returns the mapping, or null if the user cancelled. */
  importPackMappingFromFile(): Promise<Record<string, string> | null>;
  /** Merge multiple pack names into one and persist the change. */
  mergePacks(args: {
    sourcePacks: string[];
    targetName: string;
  }): Promise<Record<string, string> | null>;
}
