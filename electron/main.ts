// Electron main process entry.
//
// Responsibilities:
//   1. Load config + open the SQLite DB before creating the window
//   2. Register a custom `map-file://` protocol that serves library images
//      to the renderer with path-traversal protection
//   3. Register IPC handlers
//   4. Create the BrowserWindow and load the renderer (dev server or
//      packaged bundle)
//
// Failures during startup show an error dialog and quit rather than
// leaving the user staring at a blank window.

import { app, BrowserWindow, dialog, protocol, net } from "electron";
import { join, normalize, sep, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { loadConfig, type DmToolConfig } from "./config.js";
import { MapDb } from "./db.js";
import { registerIpcHandlers } from "./ipc.js";

// `map-file://` must be registered as a privileged scheme BEFORE app.ready
// fires, otherwise the CSP `img-src map-file:` rule in index.html won't
// match and images will be blocked.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "map-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let db: MapDb | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // electron-vite emits preload to out/preload/index.mjs in both dev
      // and prod. __dirname here resolves into that out/main folder, so
      // the relative path lands in out/preload.
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs fs access via ipcRenderer — sandbox=true breaks that
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** Register the `map-file://maps/<filename>` protocol handler.
 *
 * The renderer references thumbnails and full-size images via URLs like
 * `map-file://maps/Alchemists_Lab.jpg.thumb.jpg`. The fixed "maps" host
 * is important — when a custom scheme is registered with `standard:
 * true`, Chromium normalizes bare `map-file://<filename>` URLs by
 * treating the filename as the hostname. That (a) lowercases the
 * filename and (b) appends a trailing `/`. Pinning the host to "maps"
 * keeps the filename in the URL path, where it survives normalization.
 *
 * The handler resolves filenames to absolute paths inside the configured
 * library folder, with explicit path-traversal protection: any resolved
 * path that escapes the library root is rejected.
 */
function registerMapFileProtocol(cfg: DmToolConfig): void {
  const libraryRoot = resolvePath(cfg.libraryPath);

  protocol.handle("map-file", async (request) => {
    try {
      const url = new URL(request.url);

      // Only accept requests targeting our pinned host. Anything else is
      // likely a malformed URL constructed somewhere we don't control.
      if (url.host !== "maps") {
        return new Response(`Bad host: ${url.host}`, { status: 400 });
      }

      // url.pathname looks like `/Alchemists_Lab.jpg.thumb.jpg` — strip
      // the leading slash and decode percent-escapes. URL parsing already
      // stripped any query/fragment for us.
      const rawPath = url.pathname.startsWith("/")
        ? url.pathname.slice(1)
        : url.pathname;
      const fileName = decodeURIComponent(rawPath);

      if (!fileName) {
        return new Response("Empty filename", { status: 400 });
      }

      // Hard-reject path-traversal attempts. We require a plain filename
      // with no separators — the map-tagger library is flat.
      if (
        fileName.includes("..") ||
        fileName.includes("/") ||
        fileName.includes("\\")
      ) {
        return new Response("Forbidden", { status: 403 });
      }

      const target = normalize(join(libraryRoot, fileName));
      // Belt-and-suspenders: after normalization, ensure we're still
      // inside the library root.
      if (!target.startsWith(libraryRoot + sep) && target !== libraryRoot) {
        return new Response("Forbidden", { status: 403 });
      }

      if (!existsSync(target)) {
        return new Response(`Not found: ${fileName}`, { status: 404 });
      }

      // net.fetch can handle file:// URLs natively, which gives us range
      // requests and streaming for free.
      return net.fetch(pathToFileURL(target).toString());
    } catch (e) {
      return new Response(`Error: ${(e as Error).message}`, { status: 500 });
    }
  });
}

async function startup(): Promise<void> {
  let cfg: DmToolConfig;
  try {
    cfg = loadConfig();
  } catch (e) {
    await dialog.showMessageBox({
      type: "error",
      title: "DM Tool — config error",
      message: "Could not start DM Tool",
      detail: (e as Error).message,
    });
    app.quit();
    return;
  }

  try {
    db = new MapDb(cfg.indexDbPath);
  } catch (e) {
    await dialog.showMessageBox({
      type: "error",
      title: "DM Tool — database error",
      message: `Could not open index at ${cfg.indexDbPath}`,
      detail: (e as Error).message,
    });
    app.quit();
    return;
  }

  registerMapFileProtocol(cfg);
  registerIpcHandlers(db, cfg);
  createWindow();
}

app.whenReady().then(startup);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && db) {
    createWindow();
  }
});

app.on("will-quit", () => {
  if (db) {
    db.close();
    db = null;
  }
});
