// Read/write SQLite wrapper for the book catalog.
//
// Unlike MapDb (which opens the map-tagger's read-only Python-managed DB),
// this file owns a dm-tool-specific SQLite file living in userData. We own
// the schema, so migrations run idempotently on startup in the constructor.
//
// The schema intentionally stores the absolute path as the unique key.
// It's fragile if the user moves their PF2e library, but cheap — a content
// hash would require reading every PDF during the phase-1 scan and blow
// the sub-2-second budget. A rescan after a move deletes the old rows and
// re-inserts the new ones, losing only cached covers and page counts.
//
// Keep this file free of Electron imports — it should be testable in a
// plain Node process.

import Database, { type Database as BetterSqliteDB } from 'better-sqlite3';
import type { Book } from '../shared/types.js';

/** Raw row shape as it comes back from the SELECT. Snake_case mirrors the
 *  schema; the public `Book` type uses camelCase. */
interface BookRow {
  id: number;
  path: string;
  title: string;
  category: string;
  subcategory: string | null;
  ruleset: string | null;
  page_count: number | null;
  file_size: number;
  cover_path: string | null;
  mtime: number;
  ingested_at: number | null;
}

/** A minimal file-system row passed from the scanner. BookDb doesn't walk
 *  the filesystem itself — that lives in book-scanner.ts so this file can
 *  be unit-tested with pure in-memory fixtures. */
export interface ScannedFile {
  path: string;
  title: string;
  category: string;
  subcategory: string | null;
  ruleset: 'legacy' | 'remastered' | null;
  fileSize: number;
  mtime: number;
}

export class BookDb {
  private db: BetterSqliteDB;

  constructor(dbPath: string) {
    // Writers get their own file — WAL mode so reads during a long ingest
    // don't block. The DB is tiny (one small table) so we don't bother
    // with busy_timeout tuning.
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /** Idempotent schema migration. Runs every startup; CREATE IF NOT
   *  EXISTS makes it a no-op on an already-initialized DB. If the schema
   *  ever changes in a backwards-incompatible way we'll add proper
   *  user_version-based migrations here, but for now one table is fine. */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        ruleset TEXT,
        page_count INTEGER,
        file_size INTEGER NOT NULL,
        cover_path TEXT,
        mtime INTEGER NOT NULL,
        ingested_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
    `);
  }

  /** All rows in catalog-display order (category → subcategory → title).
   *  NULL subcategories sort before named ones via COALESCE(''). */
  listAll(): Book[] {
    const rows = this.db
      .prepare("SELECT * FROM books ORDER BY category, COALESCE(subcategory, ''), title")
      .all() as BookRow[];
    return rows.map(rowToBook);
  }

  /** Single row by id, or null if unknown. Used by the reader to hydrate
   *  its view from a click handler that only has the id. */
  getById(id: number): Book | null {
    const row = this.db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined;
    return row ? rowToBook(row) : null;
  }

  /** Absolute path for a book id. Kept internal to main — the renderer
   *  never sees filesystem paths, only `book-file://` URLs. */
  getPath(id: number): string | null {
    const row = this.db.prepare('SELECT path FROM books WHERE id = ?').get(id) as { path: string } | undefined;
    return row?.path ?? null;
  }

  /** Reconcile the books table with a fresh directory walk. Runs inside a
   *  single transaction so a partial failure doesn't leave the catalog in
   *  a torn state. Returns summary counts for the UI.
   *
   *  Reconciliation rules:
   *   - New path → INSERT row with NULL page_count/cover_path/ingested_at
   *   - Existing path, same mtime → no-op
   *   - Existing path, newer mtime → UPDATE metadata AND clear ingested_at
   *     so the next open re-extracts the cover (the PDF may have been
   *     replaced with a corrected version)
   *   - Existing path not in the scan → DELETE
   */
  reconcile(scanned: ScannedFile[]): {
    added: number;
    updated: number;
    removed: number;
    total: number;
  } {
    const existing = this.db.prepare('SELECT id, path, mtime FROM books').all() as Array<{
      id: number;
      path: string;
      mtime: number;
    }>;
    const byPath = new Map<string, { id: number; mtime: number }>();
    for (const row of existing) {
      byPath.set(row.path, { id: row.id, mtime: row.mtime });
    }

    const scannedPaths = new Set(scanned.map((s) => s.path));

    const insert = this.db.prepare(
      `INSERT INTO books (path, title, category, subcategory, ruleset, file_size, mtime)
       VALUES (@path, @title, @category, @subcategory, @ruleset, @fileSize, @mtime)`,
    );
    const update = this.db.prepare(
      `UPDATE books
       SET title = @title,
           category = @category,
           subcategory = @subcategory,
           ruleset = @ruleset,
           file_size = @fileSize,
           mtime = @mtime,
           page_count = NULL,
           cover_path = NULL,
           ingested_at = NULL
       WHERE path = @path`,
    );
    const deleteStmt = this.db.prepare('DELETE FROM books WHERE id = ?');

    let added = 0;
    let updated = 0;
    let removed = 0;

    const tx = this.db.transaction(() => {
      for (const s of scanned) {
        const prior = byPath.get(s.path);
        if (!prior) {
          insert.run(s);
          added++;
        } else if (prior.mtime !== s.mtime) {
          update.run(s);
          updated++;
        }
      }
      for (const row of existing) {
        if (!scannedPaths.has(row.path)) {
          deleteStmt.run(row.id);
          removed++;
        }
      }
    });
    tx();

    const total = this.db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number };
    return { added, updated, removed, total: total.c };
  }

  /** Finalize a phase-2 ingest. Called after the renderer has rendered
   *  page 1 and the main process has written the cover PNG to disk.
   *  `coverPath` is relative to userData for portability across app
   *  installs (stored, not absolute). */
  finalizeIngest(id: number, pageCount: number, coverPath: string): Book | null {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE books
         SET page_count = ?, cover_path = ?, ingested_at = ?
         WHERE id = ?`,
      )
      .run(pageCount, coverPath, now, id);
    return this.getById(id);
  }
}

function rowToBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    subcategory: row.subcategory,
    ruleset: (row.ruleset as Book['ruleset']) ?? null,
    pageCount: row.page_count,
    fileSize: row.file_size,
    ingested: row.ingested_at !== null,
  };
}
