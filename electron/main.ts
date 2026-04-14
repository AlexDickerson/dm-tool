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

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net } from 'electron';
import { dirname, join, normalize, sep, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { configExists, loadConfig, type DmToolConfig } from './config.js';
import { MapDb } from './db.js';
import { BookDb } from './book-db.js';
import { registerIpcHandlers } from './ipc/index.js';
import { registerSetupIpcHandlers } from './setup-ipc.js';
import { scanBookRoot } from './book-scanner.js';
import { openPf2eDb, closePf2eDb } from './pf2e-db.js';

// `map-file://` and `book-file://` must be registered as privileged
// schemes BEFORE app.ready fires, otherwise the CSP rules in index.html
// won't match and images/PDFs will be blocked. `supportFetchAPI` is what
// lets pdfjs's internal `fetch()` target the scheme; `stream: true` lets
// net.fetch on file:// URLs deliver ranged responses for big PDFs, which
// is why the 68 MB AV Hardcover doesn't fully load into memory.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'map-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      stream: true,
    },
  },
  {
    scheme: 'book-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      stream: true,
    },
  },
  {
    scheme: 'monster-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let db: MapDb | null = null;
let bookDb: BookDb | null = null;

// Colors for the native window-control overlay strip. These must match the
// React header so the min/max/close buttons blend into the custom title
// bar. The height is controlled by the renderer at runtime (see the
// `setTitleBarOverlayHeight` IPC handler) because the React header height
// scales with the UI size slider in settings.
const OVERLAY_COLOR = '#0e0e11';
const OVERLAY_SYMBOL_COLOR = '#a1a1aa';
// Default overlay height in CSS pixels. Matches h-12 (3rem) at the default
// root font-size of 18px. If the user has a saved UI scale, the renderer
// will correct this via IPC shortly after window creation.
const DEFAULT_OVERLAY_HEIGHT = 54;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    // Match the app's `--background` token (hsl(240 10% 6%) ≈ #0e0e11)
    // so the pre-paint flash and the window-control overlay strip both
    // blend seamlessly into the React header.
    backgroundColor: '#0e0e11',
    // Hide the native OS title bar and render our own in the renderer.
    // `titleBarOverlay` keeps the native minimize/maximize/close buttons
    // as a transparent overlay on the right side of the window so we
    // don't have to reimplement window controls — we just reserve space
    // for them in the React header via padding-right. The colors match
    // our dark theme so the overlay blends into the custom title bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // Must match the React header height (h-12 = 3rem). Root font-size
      // is controlled by the UI size slider in settings, so the renderer
      // updates this at runtime via the `setTitleBarOverlayHeight` IPC
      // call — see OVERLAY_* constants above.
      color: OVERLAY_COLOR,
      symbolColor: OVERLAY_SYMBOL_COLOR,
      height: DEFAULT_OVERLAY_HEIGHT,
    },
    webPreferences: {
      // electron-vite emits preload to out/preload/index.mjs in both dev
      // and prod. __dirname here resolves into that out/main folder, so
      // the relative path lands in out/preload.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs fs access via ipcRenderer — sandbox=true breaks that
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
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

  protocol.handle('map-file', async (request) => {
    try {
      const url = new URL(request.url);

      // Only accept requests targeting our pinned host. Anything else is
      // likely a malformed URL constructed somewhere we don't control.
      if (url.host !== 'maps') {
        return new Response(`Bad host: ${url.host}`, { status: 400 });
      }

      // url.pathname looks like `/Alchemists_Lab.jpg.thumb.jpg` — strip
      // the leading slash and decode percent-escapes. URL parsing already
      // stripped any query/fragment for us.
      const rawPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      const fileName = decodeURIComponent(rawPath);

      if (!fileName) {
        return new Response('Empty filename', { status: 400 });
      }

      // Hard-reject path-traversal attempts. We require a plain filename
      // with no separators — the map-tagger library is flat.
      if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return new Response('Forbidden', { status: 403 });
      }

      const target = normalize(join(libraryRoot, fileName));
      // Belt-and-suspenders: after normalization, ensure we're still
      // inside the library root.
      if (!target.startsWith(libraryRoot + sep) && target !== libraryRoot) {
        return new Response('Forbidden', { status: 403 });
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

/** Register the `book-file://` protocol handler.
 *
 *  Two URL shapes, distinguished by host:
 *
 *    book-file://files/<id>    → the PDF at books[id].path
 *    book-file://covers/<id>   → the cached cover PNG at
 *                                <userData>/book-covers/<id>.png
 *
 *  The renderer never sees absolute paths — it just hands the URL to
 *  pdfjs (or an <img> tag). Main resolves the id to a real path here, so
 *  a renderer bug can't be tricked into reading arbitrary filesystem
 *  locations: the id must be an integer that resolves to a known row.
 *
 *  Range-request support for the PDFs comes free via `net.fetch` on the
 *  underlying `file://` URL — the Chromium PDF layer asks for chunks as
 *  the user scrolls, so a 68 MB file doesn't have to be fully loaded to
 *  show page 1. */
function registerBookFileProtocol(getBookDb: () => BookDb | null, coverCacheRoot: string): void {
  protocol.handle('book-file', async (request) => {
    try {
      const url = new URL(request.url);
      const host = url.host;
      const rawPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      const key = decodeURIComponent(rawPath);

      if (!key) {
        return new Response('Empty key', { status: 400 });
      }

      if (host === 'files') {
        const id = Number(key);
        if (!Number.isFinite(id) || !Number.isInteger(id)) {
          return new Response('Bad file id', { status: 400 });
        }
        const b = getBookDb();
        if (!b) return new Response('Book catalog not configured', { status: 503 });
        const absPath = b.getPath(id);
        if (!absPath) return new Response(`Unknown book id ${id}`, { status: 404 });
        if (!existsSync(absPath)) {
          return new Response(`Book file missing: ${absPath}`, { status: 404 });
        }
        return net.fetch(pathToFileURL(absPath).toString());
      }

      if (host === 'covers') {
        const id = Number(key);
        if (!Number.isFinite(id) || !Number.isInteger(id)) {
          return new Response('Bad cover id', { status: 400 });
        }
        // Cover filenames are `<id>.png`. Normalize + verify we stay
        // inside the cover cache root (belt-and-suspenders; the filename
        // is derived from a number so traversal isn't actually possible).
        const target = normalize(join(coverCacheRoot, `${id}.png`));
        if (!target.startsWith(coverCacheRoot + sep) && target !== coverCacheRoot) {
          return new Response('Forbidden', { status: 403 });
        }
        if (!existsSync(target)) {
          // Not an error — the renderer's <img> tag uses onError to fall
          // back to a placeholder until phase-2 ingest runs.
          return new Response('Cover not yet cached', { status: 404 });
        }
        return net.fetch(pathToFileURL(target).toString());
      }

      return new Response(`Bad host: ${host}`, { status: 400 });
    } catch (e) {
      return new Response(`Error: ${(e as Error).message}`, { status: 500 });
    }
  });
}

/** Register the `monster-file://img/<relative-path>` protocol handler.
 *
 *  Serves monster art and token images stored alongside the PF2e DB. The
 *  paths in the database are relative (e.g. `Tools/data/monster_art/x.webp`).
 *  We resolve them by progressively stripping leading path segments and
 *  joining with the PF2e DB's parent directory until we find an existing file.
 */
function registerMonsterFileProtocol(pf2eDbPath: string): void {
  const dbDir = normalize(dirname(resolvePath(pf2eDbPath)));

  protocol.handle('monster-file', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'img') {
        return new Response(`Bad host: ${url.host}`, { status: 400 });
      }

      const rawPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      const relPath = decodeURIComponent(rawPath);
      if (!relPath || relPath.includes('..')) {
        return new Response('Forbidden', { status: 403 });
      }

      // Progressively strip leading segments to find the file relative to dbDir.
      const segments = relPath.replace(/\\/g, '/').split('/');
      for (let i = 0; i < segments.length; i++) {
        const candidate = normalize(join(dbDir, segments.slice(i).join('/')));
        if (candidate.startsWith(dbDir + sep) && existsSync(candidate)) {
          return net.fetch(pathToFileURL(candidate).toString());
        }
      }

      return new Response(`Not found: ${relPath}`, { status: 404 });
    } catch (e) {
      return new Response(`Error: ${(e as Error).message}`, { status: 500 });
    }
  });
}

async function startup(): Promise<void> {
  // First-run: no config.json found anywhere — boot into the setup screen
  // so the user can pick paths via native dialogs. Only the minimal IPC
  // surface is registered; the full app (maps, books, chat, etc.) is
  // unavailable until a valid config exists and the app restarts.
  if (!configExists()) {
    registerSetupIpcHandlers(() => mainWindow);
    Menu.setApplicationMenu(null);

    ipcMain.handle('setTitleBarOverlayHeight', (_e, height: number) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (typeof height !== 'number' || !Number.isFinite(height)) return;
      const clamped = Math.max(24, Math.min(120, Math.round(height)));
      mainWindow.setTitleBarOverlay({
        color: OVERLAY_COLOR,
        symbolColor: OVERLAY_SYMBOL_COLOR,
        height: clamped,
      });
    });

    createWindow();
    return;
  }

  let cfg: DmToolConfig;
  try {
    cfg = loadConfig();
  } catch (e) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'DM Tool — config error',
      message: 'Could not start DM Tool',
      detail: (e as Error).message,
    });
    app.quit();
    return;
  }

  try {
    db = new MapDb(cfg.indexDbPath);
  } catch (e) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'DM Tool — database error',
      message: `Could not open index at ${cfg.indexDbPath}`,
      detail: (e as Error).message,
    });
    app.quit();
    return;
  }

  // Open the dm-tool-owned book catalog DB. Unlike MapDb (which fails
  // startup if the tagger index is missing) this one is optional — we
  // always create the file but only run the phase-1 scan if booksPath is
  // configured. That way users who don't have a PDF library yet can
  // still use the map browser.
  try {
    const bookDbPath = join(app.getPath('userData'), 'books.sqlite');
    bookDb = new BookDb(bookDbPath);
  } catch (e) {
    // Non-fatal — log and disable the book catalog. The IPC handlers
    // will surface a user-friendly error if the renderer tries to use
    // them, so the map browser stays usable.
    console.error('Failed to open book catalog DB:', (e as Error).message);
    bookDb = null;
  }

  // Phase-1 scan: cheap file-metadata walk. Runs here (before window
  // creation) because it completes in well under the 2-second budget
  // for ~100 books and lets the catalog render immediately on first
  // paint. Phase-2 (cover extraction) is lazy — triggered by the
  // renderer when the user opens a book for the first time.
  if (bookDb && cfg.booksPath) {
    try {
      const scanned = scanBookRoot(cfg.booksPath);
      const result = bookDb.reconcile(scanned);
      console.log(`Book scan: +${result.added} ~${result.updated} -${result.removed} (total ${result.total})`);
    } catch (e) {
      console.error('Book scan failed:', (e as Error).message);
    }
  }

  // Open the PF2e rules/monsters/items database if configured.
  if (cfg.pf2eDbPath && existsSync(cfg.pf2eDbPath)) {
    try {
      openPf2eDb(cfg.pf2eDbPath);
      console.log('PF2e DB loaded:', cfg.pf2eDbPath);
    } catch (e) {
      console.error('Failed to open PF2e DB:', (e as Error).message);
    }
  }

  const coverCacheRoot = resolvePath(join(app.getPath('userData'), 'book-covers'));

  // Kill the default Electron application menu (File/Edit/View/...).
  // Our custom title bar in the renderer replaces it. Standard OS
  // accelerators (Alt+F4, copy/paste inside inputs, etc.) still work
  // because they're handled at the OS level, not by the menu.
  Menu.setApplicationMenu(null);

  registerMapFileProtocol(cfg);
  registerBookFileProtocol(() => bookDb, coverCacheRoot);
  if (cfg.pf2eDbPath) registerMonsterFileProtocol(cfg.pf2eDbPath);
  registerIpcHandlers(db, bookDb, cfg, () => mainWindow);

  // Renderer-driven runtime resize of the native window-control overlay.
  // This lives in main.ts (rather than ipc.ts) because it needs the
  // BrowserWindow instance — ipc.ts only sees the DB + config. The
  // renderer calls this on startup and whenever the user moves the UI
  // size slider in settings, so the OS min/max/close button strip stays
  // matched to the React header height.
  ipcMain.handle('setTitleBarOverlayHeight', (_e, height: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (typeof height !== 'number' || !Number.isFinite(height)) return;
    // Clamp defensively — Electron throws if height is <= 0, and a
    // ridiculously tall overlay would eat the entire window.
    const clamped = Math.max(24, Math.min(120, Math.round(height)));
    mainWindow.setTitleBarOverlay({
      color: OVERLAY_COLOR,
      symbolColor: OVERLAY_SYMBOL_COLOR,
      height: clamped,
    });
  });

  createWindow();
}

app.whenReady().then(startup);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && db) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (db) {
    db.close();
    db = null;
  }
  if (bookDb) {
    bookDb.close();
    bookDb = null;
  }
  closePf2eDb();
});
