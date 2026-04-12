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

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { app } from "electron";

/** Resolve the bundled map-tagger.exe path. In production it lives in the
 *  app's resources directory (via extraResources); in dev it's built locally
 *  under tagger/dist/. Returns undefined if neither exists. */
function resolveBundledTagger(): string | undefined {
  // Production: extraResources puts it at <resources>/map-tagger.exe
  const prodPath = join(process.resourcesPath, "map-tagger.exe");
  if (existsSync(prodPath)) return prodPath;

  // Dev: tagger/dist/map-tagger.exe relative to project root
  const devPath = join(app.isPackaged ? app.getAppPath() : process.cwd(), "tagger", "dist", "map-tagger.exe");
  if (existsSync(devPath)) return devPath;

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
   *  set, the app uses the bundled exe from extraResources (production)
   *  or tagger/dist/ (dev). */
  taggerBinPath: string;
  /** Absolute path to the Auto-Wall executable. Optional — if missing,
   *  the "Launch Auto-Wall" button is hidden in the detail pane. */
  autoWallBinPath?: string;
  /** Absolute path to the PF2e rules/monsters/items SQLite database.
   *  Optional — if missing, the chat tools fall back to AoN web queries. */
  pf2eDbPath?: string;
}

/** The config file is looked up in this order:
 *   1. $DM_TOOL_CONFIG (an absolute path to a config.json)
 *   2. <projectRoot>/config.json
 *   3. <userData>/config.json
 *
 * Having an env var override is useful for running the app against multiple
 * libraries (e.g. a dev library vs the real one) without editing files.
 */
function resolveConfigPath(): string {
  const fromEnv = process.env.DM_TOOL_CONFIG;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  // In dev, electron-vite runs with cwd at project root. In production the
  // app is packaged and the working directory isn't reliable, so we fall
  // back to app.getAppPath().
  const projectRootGuess = app.isPackaged ? app.getAppPath() : process.cwd();
  const projectConfig = join(projectRootGuess, "config.json");
  if (existsSync(projectConfig)) return projectConfig;

  const userDataConfig = join(app.getPath("userData"), "config.json");
  if (existsSync(userDataConfig)) return userDataConfig;

  // Nothing found — return the project root path so the error message
  // points the user at where to create the file.
  return projectConfig;
}

/** Returns true if a config.json file exists at any of the search locations.
 *  Used by the startup flow to decide between setup mode and normal mode
 *  without loading/parsing the file. */
export function configExists(): boolean {
  const fromEnv = process.env.DM_TOOL_CONFIG;
  if (fromEnv && existsSync(fromEnv)) return true;

  const projectRootGuess = app.isPackaged ? app.getAppPath() : process.cwd();
  if (existsSync(join(projectRootGuess, "config.json"))) return true;

  if (existsSync(join(app.getPath("userData"), "config.json"))) return true;

  return false;
}

export function loadConfig(): DmToolConfig {
  const path = resolveConfigPath();
  if (!existsSync(path)) {
    throw new Error(
      `dm-tool: no config.json found. Create one at ${path} using config.example.json as a template.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    throw new Error(`dm-tool: failed to read config at ${path}: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`dm-tool: config.json at ${path} is not valid JSON: ${(e as Error).message}`);
  }

  const cfg = parsed as Partial<DmToolConfig>;
  if (!cfg.libraryPath || typeof cfg.libraryPath !== "string") {
    throw new Error(`dm-tool: config.json missing required string field "libraryPath"`);
  }
  if (!cfg.indexDbPath || typeof cfg.indexDbPath !== "string") {
    throw new Error(`dm-tool: config.json missing required string field "indexDbPath"`);
  }
  if (!cfg.inboxPath || typeof cfg.inboxPath !== "string") {
    throw new Error(`dm-tool: config.json missing required string field "inboxPath"`);
  }
  if (!cfg.quarantinePath || typeof cfg.quarantinePath !== "string") {
    throw new Error(`dm-tool: config.json missing required string field "quarantinePath"`);
  }
  const libraryPath = resolve(cfg.libraryPath);
  const indexDbPath = resolve(cfg.indexDbPath);
  const inboxPath = resolve(cfg.inboxPath);
  const quarantinePath = resolve(cfg.quarantinePath);

  // taggerBinPath: use config value if provided, otherwise fall back to
  // the bundled exe (extraResources in production, tagger/dist/ in dev).
  let taggerBinPath: string;
  if (cfg.taggerBinPath && typeof cfg.taggerBinPath === "string" && cfg.taggerBinPath.trim().length > 0) {
    taggerBinPath = resolve(cfg.taggerBinPath);
  } else {
    const bundled = resolveBundledTagger();
    if (!bundled) {
      throw new Error(
        `dm-tool: no taggerBinPath in config.json and no bundled map-tagger.exe found. ` +
        `Either set taggerBinPath or run "npm run build:tagger" to build the bundled exe.`,
      );
    }
    taggerBinPath = bundled;
  }

  if (!existsSync(libraryPath)) {
    throw new Error(`dm-tool: configured libraryPath does not exist: ${libraryPath}`);
  }
  if (!existsSync(indexDbPath)) {
    throw new Error(
      `dm-tool: configured indexDbPath does not exist: ${indexDbPath}. Run the map-tagger ingest first.`,
    );
  }
  if (!existsSync(taggerBinPath)) {
    throw new Error(
      `dm-tool: configured taggerBinPath does not exist: ${taggerBinPath}. ` +
      `Run "npm run build:tagger" or set taggerBinPath in config.json.`,
    );
  }

  // booksPath is optional — if set, we resolve and lightly validate, but
  // a missing folder at startup isn't fatal: the catalog will just show
  // empty until the user fixes the config. This keeps the rest of the app
  // (map browser) usable even if the books tree is on a network drive
  // that's currently offline.
  let booksPath: string | undefined;
  if (cfg.booksPath && typeof cfg.booksPath === "string" && cfg.booksPath.trim().length > 0) {
    booksPath = resolve(cfg.booksPath);
  }

  // autoWallBinPath is optional — if set, resolve and validate.
  let autoWallBinPath: string | undefined;
  if (cfg.autoWallBinPath && typeof cfg.autoWallBinPath === "string" && cfg.autoWallBinPath.trim().length > 0) {
    autoWallBinPath = resolve(cfg.autoWallBinPath);
    if (!existsSync(autoWallBinPath)) {
      console.warn(`dm-tool: configured autoWallBinPath does not exist: ${autoWallBinPath}. Auto-Wall integration disabled.`);
      autoWallBinPath = undefined;
    }
  }

  let pf2eDbPath: string | undefined;
  if (cfg.pf2eDbPath && typeof cfg.pf2eDbPath === "string" && cfg.pf2eDbPath.trim().length > 0) {
    pf2eDbPath = resolve(cfg.pf2eDbPath);
  }

  return { libraryPath, indexDbPath, booksPath, inboxPath, quarantinePath, taggerBinPath, autoWallBinPath, pf2eDbPath };
}
