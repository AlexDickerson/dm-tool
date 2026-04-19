// Startup config for dm-tool.
//
// Two layers:
//
// 1. Bootstrap config — tells us where the SQLite state file lives. This is
//    all the info we need to open the DB; everything else comes from the
//    DB. Resolution order:
//      - $DM_TOOL_DB_PATH env var (dev override)
//      - HKCU\Software\dm-tool\DbPath (stable per-user registry key — the
//        NSIS installer writes here, so it survives app upgrades)
//      - apps/dm-tool/config.json (or monorepo root, for dev)
//      - <userData>/config.json
//      - default: <userData>/dm-tool.db
//
// 2. Settings — everything else (libraryPath, URL strings, binary paths,
//    etc.) lives in the DB's `settings` table. After openPf2eDb runs,
//    loadConfigFromDb() reads rows, validates, resolves optional bundled-
//    binary fallbacks, and returns the canonical DmToolConfig.

import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getAllSettings, getSetting } from './pf2e-db.js';

/** Stable per-user registry location for the bootstrap db path. Kept
 *  un-versioned on purpose so it survives app upgrades. */
const REGISTRY_KEY = 'HKCU\\Software\\dm-tool';
const REGISTRY_VALUE = 'DbPath';

/** Candidate roots to search for dev-only sibling directories (tagger/,
 *  auto-wall-bin/, config.json). In dev, cwd is the dm-tool app dir
 *  (apps/dm-tool); the monorepo root sits two levels up. Users running
 *  from the old workspace-root layout still work via the cwd entry. */
function devSearchRoots(): string[] {
  const cwd = process.cwd();
  return [cwd, resolve(cwd, '..', '..')];
}

function resolveBundledTagger(): string | undefined {
  if (app.isPackaged) {
    const prodPath = join(process.resourcesPath, 'map-tagger.exe');
    if (existsSync(prodPath)) return prodPath;
    return undefined;
  }

  for (const root of devSearchRoots()) {
    const shim = join(root, 'tagger', '.venv', 'Scripts', 'map-tagger.exe');
    if (existsSync(shim)) return shim;
    const frozen = join(root, 'tagger', 'dist', 'map-tagger.exe');
    if (existsSync(frozen)) return frozen;
  }

  return undefined;
}

/** Resolve the bundled Auto-Wall.exe path. Same logic as the tagger. */
function resolveBundledAutoWall(): string | undefined {
  const prodPath = join(process.resourcesPath, 'Auto-Wall.exe');
  if (existsSync(prodPath)) return prodPath;

  if (app.isPackaged) {
    const devPath = join(app.getAppPath(), 'auto-wall-bin', 'Auto-Wall.exe');
    if (existsSync(devPath)) return devPath;
    return undefined;
  }

  for (const root of devSearchRoots()) {
    const devPath = join(root, 'auto-wall-bin', 'Auto-Wall.exe');
    if (existsSync(devPath)) return devPath;
  }

  return undefined;
}

export interface DmToolConfig {
  /** Absolute path to the map-tagger library folder (maps + thumbs + sidecars). */
  libraryPath: string;
  /** Absolute path to the map-tagger's SQLite index file. */
  indexDbPath: string;
  /** Absolute path to the root folder of TTRPG PDFs (Adventure Paths,
   *  Rulebooks, etc). Optional — if missing, the book catalog feature is
   *  disabled and the tab shows a friendly "configure me" message. */
  booksPath?: string;
  /** Staging folder for new maps before they're processed and moved to
   *  the library. The tagger creates this if it doesn't exist. */
  inboxPath: string;
  /** Folder where maps that fail tagging are quarantined with an error
   *  sidecar. The tagger creates this if it doesn't exist. */
  quarantinePath: string;
  /** Absolute path to the map-tagger CLI executable. Optional — if not
   *  set, the app falls back to the bundled exe. */
  taggerBinPath?: string;
  /** Absolute path to the Auto-Wall executable. Optional — bundled
   *  fallback otherwise. */
  autoWallBinPath?: string;
  /** URL of the foundry-mcp server (e.g. "http://server.ad:8765").
   *  Optional — if missing, the "Push to Foundry" button is hidden. */
  foundryMcpUrl?: string;
  /** Absolute path to an Obsidian vault folder. Optional — if set, globe
   *  pins can be linked to Obsidian notes for rich annotation. */
  obsidianVaultPath?: string;
  /** URL players should visit to see the map. Shown in the resync-
   *  complete toast. Optional. */
  playerMapPublicUrl?: string;
  /** Base URL of the live-sync sidecar (e.g. "http://server.ad:30002"). If
   *  unset, live features (inventory, aurus leaderboard, globe pins) are
   *  local-only. */
  sidecarUrl?: string;
  /** Shared secret for authenticating DM writes to the sidecar. */
  sidecarSecret?: string;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export interface BootstrapConfig {
  /** Absolute path to the SQLite state file that hosts the settings table
   *  plus every dm-tool-owned table (books, globe pins, inventory, etc.). */
  dbPath: string;
}

function findBootstrapConfigPath(): string | null {
  if (app.isPackaged) {
    const p = join(app.getAppPath(), 'config.json');
    return existsSync(p) ? p : null;
  }
  for (const root of devSearchRoots()) {
    const p = join(root, 'config.json');
    if (existsSync(p)) return p;
  }
  const userDataConfig = join(app.getPath('userData'), 'config.json');
  return existsSync(userDataConfig) ? userDataConfig : null;
}

/** Read the bootstrap db path from the Windows registry. Returns null on
 *  non-Windows platforms, when the key/value is missing, or on any error
 *  shelling out to `reg.exe`. We use `reg query` instead of a native module
 *  to keep the dependency footprint zero — this runs once at startup. */
function readDbPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const stdout = execFileSync('reg', ['query', REGISTRY_KEY, '/v', REGISTRY_VALUE], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Output is like:
    //   HKEY_CURRENT_USER\Software\dm-tool
    //       DbPath    REG_SZ    C:\path\to\dm-tool.db
    const match = stdout.match(/^\s+DbPath\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/m);
    if (!match) return null;
    const value = match[1].trim();
    return value.length > 0 ? value : null;
  } catch {
    // reg.exe exits non-zero when the key/value is missing; that's expected.
    return null;
  }
}

/** Resolve the DB path at startup. Env override > stable registry key >
 *  bootstrap config.json > default under userData. Never throws — every
 *  missing source just falls through to the next. */
export function loadBootstrapConfig(): BootstrapConfig {
  const fromEnv = process.env.DM_TOOL_DB_PATH;
  if (fromEnv && fromEnv.trim().length > 0) return { dbPath: resolve(fromEnv.trim()) };

  const fromRegistry = readDbPathFromRegistry();
  if (fromRegistry) return { dbPath: resolve(fromRegistry) };

  const configPath = findBootstrapConfigPath();
  if (configPath) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { dbPath?: unknown };
      if (typeof parsed.dbPath === 'string' && parsed.dbPath.trim().length > 0) {
        return { dbPath: resolve(parsed.dbPath.trim()) };
      }
    } catch (e) {
      console.warn(`dm-tool: ignoring bootstrap config at ${configPath}: ${(e as Error).message}`);
    }
  }

  return { dbPath: join(app.getPath('userData'), 'dm-tool.db') };
}

/** Path the setup IPC should write the bootstrap config.json to. Prefers
 *  the dev location (apps/dm-tool/config.json) when not packaged, falls
 *  back to userData otherwise. */
export function bootstrapConfigWritePath(): string {
  if (app.isPackaged) return join(app.getPath('userData'), 'config.json');
  return join(process.cwd(), 'config.json');
}

// ---------------------------------------------------------------------------
// Settings load (reads the DB)
// ---------------------------------------------------------------------------

/** Returns true if the settings table has a populated `libraryPath` —
 *  the minimum signal that the user has completed setup at least once. */
export function isConfigured(): boolean {
  return !!getSetting('libraryPath');
}

function asTrimmedString(raw: string | undefined): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

/** Read the full DmToolConfig from the DB's settings table. Mirrors the
 *  validation + fallback logic that used to live in the old loadConfig:
 *  required fields throw, optional fields coerce empty → undefined,
 *  bundled binaries fill in when user paths are missing/invalid. */
export function loadConfigFromDb(): DmToolConfig {
  const s = getAllSettings();

  const required = ['libraryPath', 'indexDbPath', 'inboxPath', 'quarantinePath'] as const;
  for (const field of required) {
    if (!s[field] || typeof s[field] !== 'string' || !s[field].trim()) {
      throw new Error(`dm-tool: settings missing required field "${field}"`);
    }
  }

  const libraryPath = resolve(s.libraryPath);
  const indexDbPath = resolve(s.indexDbPath);
  const inboxPath = resolve(s.inboxPath);
  const quarantinePath = resolve(s.quarantinePath);

  if (!existsSync(libraryPath)) {
    throw new Error(`dm-tool: configured libraryPath does not exist: ${libraryPath}`);
  }
  if (!existsSync(indexDbPath)) {
    throw new Error(`dm-tool: configured indexDbPath does not exist: ${indexDbPath}. Run the map-tagger ingest first.`);
  }

  let taggerBinPath: string | undefined;
  const taggerFromSettings = asTrimmedString(s.taggerBinPath);
  if (taggerFromSettings) {
    const configured = resolve(taggerFromSettings);
    if (existsSync(configured)) {
      taggerBinPath = configured;
    } else {
      console.warn(`dm-tool: configured taggerBinPath does not exist: ${configured}. Trying bundled binary.`);
    }
  }
  if (!taggerBinPath) taggerBinPath = resolveBundledTagger();

  const booksRaw = asTrimmedString(s.booksPath);
  const booksPath = booksRaw ? resolve(booksRaw) : undefined;

  let autoWallBinPath: string | undefined;
  const autoWallFromSettings = asTrimmedString(s.autoWallBinPath);
  if (autoWallFromSettings) {
    const p = resolve(autoWallFromSettings);
    if (existsSync(p)) {
      autoWallBinPath = p;
    } else {
      console.warn(`dm-tool: configured autoWallBinPath does not exist: ${p}. Trying bundled binary.`);
    }
  }
  if (!autoWallBinPath) autoWallBinPath = resolveBundledAutoWall();

  const foundryRaw = asTrimmedString(s.foundryMcpUrl);
  const foundryMcpUrl = foundryRaw ? foundryRaw.replace(/\/+$/, '') : undefined;

  const obsidianRaw = asTrimmedString(s.obsidianVaultPath);
  const obsidianVaultPath = obsidianRaw ? resolve(obsidianRaw) : undefined;

  const playerMapPublicUrl = asTrimmedString(s.playerMapPublicUrl);

  const sidecarRaw = asTrimmedString(s.sidecarUrl);
  const sidecarUrl = sidecarRaw ? sidecarRaw.replace(/\/+$/, '') : undefined;
  const sidecarSecret = asTrimmedString(s.sidecarSecret);

  return {
    libraryPath,
    indexDbPath,
    booksPath,
    inboxPath,
    quarantinePath,
    taggerBinPath,
    autoWallBinPath,
    foundryMcpUrl,
    obsidianVaultPath,
    playerMapPublicUrl,
    sidecarUrl,
    sidecarSecret,
  };
}
