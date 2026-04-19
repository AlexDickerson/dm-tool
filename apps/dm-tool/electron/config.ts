// Loads dm-tool's config.json from the project root.
//
// The dm-tool is a pure consumer of the map-tagger's outputs. It needs to
// know two paths:
//   - libraryPath:  folder containing the tagged images + thumbnails + sidecars
//   - indexDbPath:  the SQLite file the map-tagger maintains
//
// Both are absolute paths on the host filesystem. They live outside this
// project's tree so the config file is gitignored (see .gitignore).
//
// The config file is read synchronously at app startup — we don't support
// hot-reloading. If the user edits it they need to restart the app. That's
// fine for a personal tool.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';

/** Resolve the bundled map-tagger.exe path.
 *
 *  - Packaged: extraResources puts the frozen PyInstaller exe at
 *    `<resources>/map-tagger.exe`.
 *  - Dev: prefer `tagger/.venv/Scripts/map-tagger.exe`, the editable-install
 *    shim created as a side effect of `pip install -e .` in build.bat. It's
 *    a ~100 KB wrapper that loads Python source at runtime, so edits under
 *    `tagger/src/` are picked up on the next spawn with no rebuild. The
 *    67 MB frozen `tagger/dist/map-tagger.exe` is kept as a fallback for
 *    people who built with `pyinstaller` but wiped the venv.
 *
 *  Returns undefined if nothing matches.
 */
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
   *  set, the app falls back to the bundled exe (extraResources in
   *  production, tagger/.venv or tagger/dist in dev). If nothing is
   *  available, map ingestion is disabled — the rest of the app still
   *  works off the pre-tagged library. */
  taggerBinPath?: string;
  /** Absolute path to the Auto-Wall executable. Optional — if missing,
   *  the "Launch Auto-Wall" button is hidden in the detail pane. */
  autoWallBinPath?: string;
  /** Absolute path to the PF2e rules/monsters/items SQLite database.
   *  Optional — if missing, the chat tools fall back to AoN web queries. */
  pf2eDbPath?: string;
  /** URL of the foundry-mcp server (e.g. "http://server.ad:8765").
   *  Optional — if missing, the "Push to Foundry" button is hidden. */
  foundryMcpUrl?: string;
  /** Absolute path to an Obsidian vault folder. Optional — if set, globe
   *  pins can be linked to Obsidian notes for rich annotation. */
  obsidianVaultPath?: string;
  /** SSH target (user@host) for the player-map deploy button. Optional —
   *  defaults to "alex@server.ad". ssh/scp must work without a password
   *  prompt (key-based auth). */
  playerMapDeployHost?: string;
  /** Remote directory on the deploy host. Optional — defaults to
   *  "~/player-map". The dir is created if missing. */
  playerMapDeployPath?: string;
  /** URL players should visit to see the map. Shown in the "Deploy
   *  complete" toast. Optional — defaults to "http://server.ad:30002". */
  playerMapPublicUrl?: string;
  /** Base URL of the live-sync sidecar (e.g. "http://server.ad:30003"). If
   *  unset, live features (inventory, aurus leaderboard) are local-only. */
  sidecarUrl?: string;
  /** Shared secret for authenticating DM writes to the sidecar. Stored in
   *  config.json as a plain string — it's already on the DM's personal
   *  machine and the secret only authorizes writes to their own server. */
  sidecarSecret?: string;
}

/** The config file is looked up in this order:
 *   1. $DM_TOOL_CONFIG (an absolute path to a config.json)
 *   2. <projectRoot>/config.json
 *   3. <userData>/config.json
 *
 * Having an env var override is useful for running the app against multiple
 * libraries (e.g. a dev library vs the real one) without editing files.
 */
export function resolveConfigPath(): string {
  const fromEnv = process.env.DM_TOOL_CONFIG;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  // In production the app is packaged and the working directory isn't
  // reliable, so we fall back to app.getAppPath(). In dev, check the
  // dm-tool app dir (cwd) first, then the monorepo root — existing users
  // who keep config.json at the repo root still work.
  if (app.isPackaged) {
    const packagedConfig = join(app.getAppPath(), 'config.json');
    if (existsSync(packagedConfig)) return packagedConfig;
  } else {
    for (const root of devSearchRoots()) {
      const p = join(root, 'config.json');
      if (existsSync(p)) return p;
    }
  }

  const userDataConfig = join(app.getPath('userData'), 'config.json');
  if (existsSync(userDataConfig)) return userDataConfig;

  // Nothing found — return the preferred location for new installs so
  // the error message points the user at where to create the file.
  return app.isPackaged ? join(app.getAppPath(), 'config.json') : join(process.cwd(), 'config.json');
}

/** Returns true if a config.json file exists at any of the search locations.
 *  Used by the startup flow to decide between setup mode and normal mode
 *  without loading/parsing the file. */
export function configExists(): boolean {
  const fromEnv = process.env.DM_TOOL_CONFIG;
  if (fromEnv && existsSync(fromEnv)) return true;

  if (app.isPackaged) {
    if (existsSync(join(app.getAppPath(), 'config.json'))) return true;
  } else {
    for (const root of devSearchRoots()) {
      if (existsSync(join(root, 'config.json'))) return true;
    }
  }

  if (existsSync(join(app.getPath('userData'), 'config.json'))) return true;

  return false;
}

export function loadConfig(): DmToolConfig {
  const path = resolveConfigPath();
  if (!existsSync(path)) {
    throw new Error(`dm-tool: no config.json found. Create one at ${path} using config.example.json as a template.`);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new Error(`dm-tool: failed to read config at ${path}: ${(e as Error).message}`, { cause: e });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`dm-tool: config.json at ${path} is not valid JSON: ${(e as Error).message}`, { cause: e });
  }

  const cfg = parsed as Partial<DmToolConfig>;
  if (!cfg.libraryPath || typeof cfg.libraryPath !== 'string') {
    throw new Error(`dm-tool: config.json missing required string field "libraryPath"`);
  }
  if (!cfg.indexDbPath || typeof cfg.indexDbPath !== 'string') {
    throw new Error(`dm-tool: config.json missing required string field "indexDbPath"`);
  }
  if (!cfg.inboxPath || typeof cfg.inboxPath !== 'string') {
    throw new Error(`dm-tool: config.json missing required string field "inboxPath"`);
  }
  if (!cfg.quarantinePath || typeof cfg.quarantinePath !== 'string') {
    throw new Error(`dm-tool: config.json missing required string field "quarantinePath"`);
  }
  const libraryPath = resolve(cfg.libraryPath);
  const indexDbPath = resolve(cfg.indexDbPath);
  const inboxPath = resolve(cfg.inboxPath);
  const quarantinePath = resolve(cfg.quarantinePath);

  // taggerBinPath: use config value if provided, otherwise fall back to
  // the bundled exe (extraResources in production, tagger/.venv or
  // tagger/dist in dev). Missing or non-existent is non-fatal — map
  // ingestion just gets disabled and the rest of the app stays usable.
  let taggerBinPath: string | undefined;
  if (cfg.taggerBinPath && typeof cfg.taggerBinPath === 'string' && cfg.taggerBinPath.trim().length > 0) {
    const configured = resolve(cfg.taggerBinPath);
    if (existsSync(configured)) {
      taggerBinPath = configured;
    } else {
      console.warn(`dm-tool: configured taggerBinPath does not exist: ${configured}. Trying bundled binary.`);
    }
  }
  if (!taggerBinPath) {
    taggerBinPath = resolveBundledTagger();
  }

  if (!existsSync(libraryPath)) {
    throw new Error(`dm-tool: configured libraryPath does not exist: ${libraryPath}`);
  }
  if (!existsSync(indexDbPath)) {
    throw new Error(`dm-tool: configured indexDbPath does not exist: ${indexDbPath}. Run the map-tagger ingest first.`);
  }

  // booksPath is optional — if set, we resolve and lightly validate, but
  // a missing folder at startup isn't fatal: the catalog will just show
  // empty until the user fixes the config. This keeps the rest of the app
  // (map browser) usable even if the books tree is on a network drive
  // that's currently offline.
  let booksPath: string | undefined;
  if (cfg.booksPath && typeof cfg.booksPath === 'string' && cfg.booksPath.trim().length > 0) {
    booksPath = resolve(cfg.booksPath);
  }

  // autoWallBinPath: use config value if provided, otherwise fall back
  // to the bundled exe (extraResources in production, auto-wall-bin/ in dev).
  let autoWallBinPath: string | undefined;
  if (cfg.autoWallBinPath && typeof cfg.autoWallBinPath === 'string' && cfg.autoWallBinPath.trim().length > 0) {
    autoWallBinPath = resolve(cfg.autoWallBinPath);
    if (!existsSync(autoWallBinPath)) {
      console.warn(`dm-tool: configured autoWallBinPath does not exist: ${autoWallBinPath}. Trying bundled binary.`);
      autoWallBinPath = undefined;
    }
  }
  if (!autoWallBinPath) {
    autoWallBinPath = resolveBundledAutoWall();
  }

  let pf2eDbPath: string | undefined;
  if (cfg.pf2eDbPath && typeof cfg.pf2eDbPath === 'string' && cfg.pf2eDbPath.trim().length > 0) {
    pf2eDbPath = resolve(cfg.pf2eDbPath);
  }

  let foundryMcpUrl: string | undefined;
  if (cfg.foundryMcpUrl && typeof cfg.foundryMcpUrl === 'string' && cfg.foundryMcpUrl.trim().length > 0) {
    foundryMcpUrl = cfg.foundryMcpUrl.replace(/\/+$/, '');
  }

  let obsidianVaultPath: string | undefined;
  if (cfg.obsidianVaultPath && typeof cfg.obsidianVaultPath === 'string' && cfg.obsidianVaultPath.trim().length > 0) {
    obsidianVaultPath = resolve(cfg.obsidianVaultPath);
  }

  // Player-map deploy: host/path/url are all optional with sensible
  // defaults. Trim + coerce; leave undefined if empty string.
  const playerMapDeployHost =
    cfg.playerMapDeployHost && typeof cfg.playerMapDeployHost === 'string' && cfg.playerMapDeployHost.trim().length > 0
      ? cfg.playerMapDeployHost.trim()
      : undefined;
  const playerMapDeployPath =
    cfg.playerMapDeployPath && typeof cfg.playerMapDeployPath === 'string' && cfg.playerMapDeployPath.trim().length > 0
      ? cfg.playerMapDeployPath.trim()
      : undefined;
  const playerMapPublicUrl =
    cfg.playerMapPublicUrl && typeof cfg.playerMapPublicUrl === 'string' && cfg.playerMapPublicUrl.trim().length > 0
      ? cfg.playerMapPublicUrl.trim()
      : undefined;

  const sidecarUrl =
    cfg.sidecarUrl && typeof cfg.sidecarUrl === 'string' && cfg.sidecarUrl.trim().length > 0
      ? cfg.sidecarUrl.trim().replace(/\/+$/, '')
      : undefined;
  const sidecarSecret =
    cfg.sidecarSecret && typeof cfg.sidecarSecret === 'string' && cfg.sidecarSecret.trim().length > 0
      ? cfg.sidecarSecret.trim()
      : undefined;

  return {
    libraryPath,
    indexDbPath,
    booksPath,
    inboxPath,
    quarantinePath,
    taggerBinPath,
    autoWallBinPath,
    pf2eDbPath,
    foundryMcpUrl,
    obsidianVaultPath,
    playerMapDeployHost,
    playerMapDeployPath,
    playerMapPublicUrl,
    sidecarUrl,
    sidecarSecret,
  };
}
