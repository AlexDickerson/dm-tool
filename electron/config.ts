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
import { join, resolve } from "node:path";
import { app } from "electron";

export interface DmToolConfig {
  /** Absolute path to the map-tagger library folder (maps + thumbs + sidecars). */
  libraryPath: string;
  /** Absolute path to the map-tagger's SQLite index file. */
  indexDbPath: string;
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

  const libraryPath = resolve(cfg.libraryPath);
  const indexDbPath = resolve(cfg.indexDbPath);

  if (!existsSync(libraryPath)) {
    throw new Error(`dm-tool: configured libraryPath does not exist: ${libraryPath}`);
  }
  if (!existsSync(indexDbPath)) {
    throw new Error(
      `dm-tool: configured indexDbPath does not exist: ${indexDbPath}. Run the map-tagger ingest first.`,
    );
  }

  return { libraryPath, indexDbPath };
}
