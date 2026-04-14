// Shared types between the Electron main process and the React renderer.
//
// These mirror the shape of rows in the map-tagger SQLite index and of the
// JSON sidecars written next to each map. Keep this file dependency-free so
// both sides of the contextBridge can import it without pulling in runtime
// modules they don't have access to.

/** Controlled vocabulary — kept loose on the TS side since the DB is the
 *  source of truth and we don't want to break the app if the Python side
 *  adds a new value. */
export type InteriorExterior = 'interior' | 'exterior' | 'mixed' | 'unknown';
export type TimeOfDay = 'day' | 'dusk' | 'night' | 'dawn' | 'unknown';
export type GridVisible = 'gridded' | 'gridless' | 'unknown';

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
  ruleset: 'legacy' | 'remastered' | null;
  pageCount: number | null;
  fileSize: number;
  /** True once phase-2 ingest has run — we have a cached cover PNG and a
   *  real page count. Covers are fetched by the renderer via
   *  `book-file://covers/<id>` URLs; if this is false, the UI should show
   *  a placeholder instead of a broken image. */
  ingested: boolean;
  // AI classification (null until classified)
  aiSystem: string | null;
  aiCategory: string | null;
  aiSubcategory: string | null;
  aiTitle: string | null;
  aiPublisher: string | null;
  classified: boolean;
}

export interface BookClassification {
  system: string;
  category: string;
  subcategory: string | null;
  title: string;
  publisher: string | null;
}

export interface BookClassifyProgress {
  type: 'progress' | 'done' | 'error';
  bookId?: number;
  bookTitle?: string;
  current?: number;
  total?: number;
  error?: string;
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

// ---------------------------------------------------------------------------
// Item browser
// ---------------------------------------------------------------------------

export type ItemSortField = 'name' | 'level' | 'price';
export type SortDirection = 'asc' | 'desc';

export interface ItemSearchParams {
  keywords?: string;
  levelMin?: number;
  levelMax?: number;
  rarities?: string[];
  isMagical?: boolean | null;
  usageCategories?: string[];
  traits?: string[];
  sources?: string[];
  sortBy?: ItemSortField;
  sortDir?: SortDirection;
  limit?: number;
}

/** Lightweight row for the item table — no description to keep IPC payloads
 *  small when returning hundreds of results. */
export interface ItemBrowserRow {
  id: string;
  name: string;
  level: number | null;
  traits: string[];
  rarity: string;
  price: string | null;
  bulk: string | null;
  usage: string | null;
  isMagical: boolean;
  hasVariants: boolean;
  /** true = ORC/remastered, false = OGL/legacy, null = unknown. */
  isRemastered: boolean | null;
}

export interface ItemVariant {
  type: string;
  level: number | null;
  price: string | null;
}

/** Full item detail including description and parsed variants. */
export interface ItemBrowserDetail extends ItemBrowserRow {
  description: string;
  source: string | null;
  aonUrl: string | null;
  variants: ItemVariant[];
  hasActivation: boolean;
}

/** Distinct filter values for the item filter panel. */
export interface ItemFacets {
  traits: string[];
  sources: string[];
  usageCategories: string[];
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatModel = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001' | 'claude-opus-4-6';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatChunk {
  type: 'delta' | 'done' | 'error' | 'tool-status';
  text?: string;
  error?: string;
}

export interface AonCreaturePreview {
  type: 'creature';
  name: string;
  level: number;
  hp: number;
  ac: number;
  fortitude: number;
  reflex: number;
  will: number;
  perception: number;
  speed: string;
  size: string;
  traits: string[];
  abilities: string[];
  immunities: string[];
  weaknesses: string;
  rarity: string;
  summary: string;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  /** Raw stat block text — everything after the first `---` separator. */
  statBlock: string;
}

export interface AonGenericPreview {
  type: 'generic';
  name: string;
  category: string;
  text: string;
}

export type AonPreviewData = AonCreaturePreview | AonGenericPreview;

// ---------------------------------------------------------------------------
// Monster browser
// ---------------------------------------------------------------------------

export interface MonsterSearchParams {
  keywords?: string;
  levels?: [number, number];
  rarities?: string[];
  sizes?: string[];
  creatureTypes?: string[];
  traits?: string[];
  sources?: string[];
  hpMin?: number;
  hpMax?: number;
  acMin?: number;
  acMax?: number;
  fortMin?: number;
  refMin?: number;
  willMin?: number;
  sortBy?: 'name' | 'level' | 'hp' | 'ac';
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

export interface MonsterSummary {
  name: string;
  level: number;
  hp: number;
  ac: number;
  fort: number;
  ref: number;
  will: number;
  rarity: string;
  size: string;
  creatureType: string;
  traits: string[];
  source: string;
  aonUrl: string;
}

export interface MonsterDetail {
  name: string;
  level: number;
  source: string;
  rarity: string;
  size: string;
  traits: string[];
  hp: number;
  ac: number;
  fort: number;
  ref: number;
  will: number;
  perception: number;
  skills: string;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  speed: string;
  immunities: string;
  weaknesses: string;
  resistances: string;
  melee: string;
  ranged: string;
  abilities: string;
  description: string;
  aonUrl: string;
  /** Relative path to portrait art image, or null if unavailable. */
  imageUrl: string | null;
  /** Relative path to token image, or null if unavailable. */
  tokenUrl: string | null;
}

export interface MonsterFacets {
  rarities: string[];
  sizes: string[];
  creatureTypes: string[];
  traits: string[];
  sources: string[];
  levelRange: [number, number];
}

// ---------------------------------------------------------------------------
// Config (exposed to renderer for Settings UI / first-run setup)
// ---------------------------------------------------------------------------

/** All config paths surfaced to the renderer. Optional fields use "" when
 *  not configured rather than undefined — simpler for controlled inputs. */
export interface ConfigPaths {
  libraryPath: string;
  indexDbPath: string;
  inboxPath: string;
  quarantinePath: string;
  taggerBinPath: string;
  booksPath: string;
  autoWallBinPath: string;
  pf2eDbPath: string;
  foundryMcpUrl: string;
}

export interface PickPathArgs {
  mode: 'directory' | 'file';
  title?: string;
  filters?: { name: string; extensions: string[] }[];
}

// ---------------------------------------------------------------------------
// Map tagger
// ---------------------------------------------------------------------------

export interface TaggerRunArgs {
  sourcePath: string;
  apiKey: string;
  limit: number;
  concurrency?: number;
}

export interface TaggerProgress {
  type: 'stdout' | 'stderr';
  line: string;
}

export interface TaggerResult {
  exitCode: number | null;
  signal: string | null;
}

/** The IPC surface exposed to the renderer via contextBridge. Every
 *  function here must have a corresponding handler registered in ipc.ts
 *  and a corresponding type declaration on `window.electronAPI` in the
 *  renderer's global types. */
// --- Globe pins --------------------------------------------------------------

export interface GlobePin {
  id: string;
  lng: number;
  lat: number;
  label: string;
  /** game-icons.net icon name (e.g. "crossed-swords"). Empty string = default dot. */
  icon: string;
  /** Zoom level at which the pin was placed. Icons shrink when zoomed out past this. */
  zoom: number;
}

export interface ElectronAPI {
  // -----------------------------------------------------------------------
  // Secure storage (OS keychain-backed via Electron safeStorage)
  // -----------------------------------------------------------------------
  secureStore(key: string, value: string): Promise<void>;
  secureLoad(key: string): Promise<string>;
  secureDelete(key: string): Promise<void>;

  // -----------------------------------------------------------------------
  // App mode + config
  // -----------------------------------------------------------------------

  /** Returns "setup" on first run (no config.json found), "normal" otherwise. */
  getAppMode(): Promise<'normal' | 'setup'>;
  /** Current config paths for display in the Settings UI. */
  getConfig(): Promise<ConfigPaths>;
  /** Open a native folder or file picker dialog. */
  pickPath(args: PickPathArgs): Promise<string | null>;
  /** Write config.json to userData and restart the app. */
  saveConfigAndRestart(paths: ConfigPaths): Promise<void>;

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
  regenerateEncounterHooks(args: { fileName: string; apiKey: string }): Promise<string[]>;

  /** Open a URL in the user's default browser. Only accepts http/https. */
  openExternal(url: string): Promise<void>;
  /** Fetch AoN preview data for a hover card. */
  aonPreview(urlPath: string): Promise<AonPreviewData | null>;

  // -----------------------------------------------------------------------
  // Chat
  // -----------------------------------------------------------------------

  /** Send a chat message and begin streaming the assistant response.
   *  Resolves when the stream completes. Text chunks arrive via
   *  onChatChunk before the promise settles. */
  chatSend(args: {
    messages: ChatMessage[];
    apiKey: string;
    model?: ChatModel;
    toolContext?: string;
    rulesMode?: boolean;
  }): Promise<void>;
  /** Extract the visible text content from an embedded tool iframe by its base URL. */
  getToolPageContent(toolUrl: string): Promise<string>;
  /** Subscribe to chat stream chunks. Returns an unsubscribe function.
   *  Same push-event pattern as onTaggerProgress. */
  onChatChunk(callback: (chunk: ChatChunk) => void): () => void;

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

  /** Update AI metadata fields for a single book (manual reclassification). */
  booksUpdateMeta(args: {
    id: number;
    fields: { aiSystem?: string; aiCategory?: string; aiSubcategory?: string | null; aiPublisher?: string | null };
  }): Promise<Book | null>;

  /** Classify all unclassified books (or all if reclassify=true) using AI.
   *  Progress streams via onBookClassifyProgress. */
  booksClassify(args: { apiKey: string; reclassify?: boolean }): Promise<void>;
  /** Cancel an in-progress classification run. */
  booksClassifyCancel(): Promise<void>;
  /** Subscribe to classification progress events. Returns unsubscribe fn. */
  onBookClassifyProgress(callback: (p: BookClassifyProgress) => void): () => void;

  // -----------------------------------------------------------------------
  // Map tagger (ingest new maps)
  // -----------------------------------------------------------------------

  /** Open a folder picker and return the selected path, or null if
   *  cancelled. */
  taggerPickSource(): Promise<string | null>;
  /** Spawn the tagger in --preview mode to get a cost estimate without
   *  calling the API. Progress lines stream via onTaggerProgress. */
  taggerPreview(args: TaggerRunArgs): Promise<TaggerResult>;
  /** Spawn the tagger for real ingest. Progress lines stream via
   *  onTaggerProgress. Resolves when the process exits. */
  taggerIngest(args: TaggerRunArgs): Promise<TaggerResult>;
  /** Kill a running tagger process. Returns true if one was running. */
  taggerCancel(): Promise<boolean>;
  /** Returns true if a tagger subprocess is currently running. */
  taggerIsRunning(): Promise<boolean>;
  /** Subscribe to tagger progress events (stdout/stderr lines). Returns
   *  an unsubscribe function. */
  onTaggerProgress(callback: (p: TaggerProgress) => void): () => void;

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
  mergePacks(args: { sourcePacks: string[]; targetName: string }): Promise<Record<string, string>>;

  // -----------------------------------------------------------------------
  // Item browser
  // -----------------------------------------------------------------------

  /** Search/filter items from the PF2e database. Returns lightweight rows
   *  without descriptions. Returns [] if the PF2e DB is not configured. */
  searchItemsBrowser(params: ItemSearchParams): Promise<ItemBrowserRow[]>;
  /** Full item detail including cleaned description and parsed variants.
   *  Returns null if the item is not found or the DB is not configured. */
  getItemBrowserDetail(id: string): Promise<ItemBrowserDetail | null>;
  /** Distinct filter values (traits, sources, usage categories) for the
   *  item filter panel. Returns empty facets if the DB is not configured. */
  getItemFacets(): Promise<ItemFacets>;

  // -----------------------------------------------------------------------
  // Auto-Wall (wall detection for VTT import)
  // -----------------------------------------------------------------------

  /** Whether the Auto-Wall binary is configured and available. */
  autoWallAvailable(): Promise<boolean>;
  /** Launch Auto-Wall GUI with the given map image pre-loaded. */
  autoWallLaunch(fileName: string): Promise<void>;
  /** Check whether a .uvtt file exists for the given map. */
  autoWallHasUvtt(fileName: string): Promise<boolean>;
  /** Read wall segments from the .uvtt file as pixel coordinates.
   *  Returns null if no .uvtt exists. */
  autoWallGetWalls(fileName: string): Promise<{
    walls: number[][];
    width: number;
    height: number;
  } | null>;
  /** Open a file picker to import a .uvtt file for the given map. */
  autoWallImportUvtt(fileName: string): Promise<boolean>;
  /** Read the raw .uvtt sidecar JSON for a map. Returns null if no
   *  sidecar exists. The returned object can be passed directly to
   *  foundry-mcp's create_scene_from_uvtt tool. */
  getMapUvtt(fileName: string): Promise<Record<string, unknown> | null>;
  /** Push a map + its .uvtt walls to Foundry VTT via foundry-mcp.
   *  Requires foundryMcpUrl to be set in config.json. */
  pushToFoundry(fileName: string): Promise<{
    sceneId: string;
    sceneName: string;
    wallsCreated: number;
    doorsCreated: number;
  }>;

  // -----------------------------------------------------------------------
  // Monster browser
  // -----------------------------------------------------------------------

  /** Search/filter monsters from the PF2e database. */
  monstersSearch(params: MonsterSearchParams): Promise<MonsterSummary[]>;
  /** Distinct facet values for the filter panel. */
  monstersFacets(): Promise<MonsterFacets>;
  /** Full stat block for a single monster by name. */
  monstersGetDetail(name: string): Promise<MonsterDetail | null>;

  // -----------------------------------------------------------------------
  // Globe pins
  // -----------------------------------------------------------------------

  /** All saved globe pins. */
  globePinsList(): Promise<GlobePin[]>;
  /** Create or update a globe pin (upsert by id). */
  globePinsUpsert(pin: GlobePin): Promise<void>;
  /** Delete a globe pin by id. */
  globePinsDelete(id: string): Promise<void>;
}
