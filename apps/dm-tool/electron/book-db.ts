// Read/write SQLite wrapper for the book catalog.
//
// Unlike MapDb (which opens the map-tagger's read-only Python-managed DB),
// this file owns a dm-tool-specific SQLite file living in userData. We own
// the schema, so migrations run idempotently on startup in the constructor.
//
// Cover images are stored as PNG blobs directly in the database. When the
// user reorganises their PDF library (renaming folders, changing booksPath),
// reconcile() carries covers forward: exact path match first, then a soft
// match on filename so covers survive moves without re-extraction.
//
// Keep this file free of Electron imports — it should be testable in a
// plain Node process.

import { basename } from 'node:path';
import Database, { type Database as BetterSqliteDB } from 'better-sqlite3';
import type { Book, BookClassification } from '@dm-tool/shared/types';

/** Raw row shape as it comes back from the SELECT (excludes cover_blob
 *  which is only fetched on demand to keep list queries lightweight). */
interface BookRow {
  id: number;
  path: string;
  title: string;
  category: string;
  subcategory: string | null;
  ruleset: string | null;
  page_count: number | null;
  file_size: number;
  mtime: number;
  ingested_at: number | null;
  ai_system: string | null;
  ai_category: string | null;
  ai_subcategory: string | null;
  ai_title: string | null;
  ai_publisher: string | null;
  ai_classified_at: number | null;
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
        cover_blob BLOB,
        mtime INTEGER NOT NULL,
        ingested_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
    `);

    // Migration v1→v2: replace cover_path (file on disk) with cover_blob.
    const cols = this.db.pragma('table_info(books)') as Array<{ name: string }>;
    const hasOldCol = cols.some((c) => c.name === 'cover_path');
    const hasNewCol = cols.some((c) => c.name === 'cover_blob');
    if (hasOldCol && !hasNewCol) {
      this.db.exec('ALTER TABLE books ADD COLUMN cover_blob BLOB');
    }
    if (hasOldCol) {
      try {
        this.db.exec('ALTER TABLE books DROP COLUMN cover_path');
      } catch {
        // SQLite < 3.35 doesn't support DROP COLUMN — harmless, just ignore.
      }
    }

    // Migration v2→v3: AI classification columns.
    if (!cols.some((c) => c.name === 'ai_system')) {
      this.db.exec('ALTER TABLE books ADD COLUMN ai_system TEXT');
      this.db.exec('ALTER TABLE books ADD COLUMN ai_category TEXT');
      this.db.exec('ALTER TABLE books ADD COLUMN ai_subcategory TEXT');
      this.db.exec('ALTER TABLE books ADD COLUMN ai_title TEXT');
      this.db.exec('ALTER TABLE books ADD COLUMN ai_publisher TEXT');
      this.db.exec('ALTER TABLE books ADD COLUMN ai_classified_at INTEGER');
    }
  }

  private static readonly LIST_COLS =
    'id, path, title, category, subcategory, ruleset, page_count, file_size, mtime, ingested_at, ai_system, ai_category, ai_subcategory, ai_title, ai_publisher, ai_classified_at';

  /** All rows in catalog-display order (category → subcategory → title).
   *  Excludes cover_blob to keep the result set lightweight. */
  listAll(): Book[] {
    const rows = this.db
      .prepare(`SELECT ${BookDb.LIST_COLS} FROM books ORDER BY category, COALESCE(subcategory, ''), title`)
      .all() as BookRow[];
    return rows.map(rowToBook);
  }

  /** Single row by id, or null if unknown. */
  getById(id: number): Book | null {
    const row = this.db.prepare(`SELECT ${BookDb.LIST_COLS} FROM books WHERE id = ?`).get(id) as BookRow | undefined;
    return row ? rowToBook(row) : null;
  }

  /** Absolute path for a book id. */
  getPath(id: number): string | null {
    const row = this.db.prepare('SELECT path FROM books WHERE id = ?').get(id) as { path: string } | undefined;
    return row?.path ?? null;
  }

  /** Return the cover PNG blob for a book, or null if not yet ingested. */
  getCoverBlob(id: number): Buffer | null {
    const row = this.db.prepare('SELECT cover_blob FROM books WHERE id = ?').get(id) as
      | { cover_blob: Buffer | null }
      | undefined;
    return row?.cover_blob ?? null;
  }

  /** Reconcile the books table with a fresh directory walk. Runs inside a
   *  single transaction so a partial failure doesn't leave the catalog in
   *  a torn state. Returns summary counts for the UI.
   *
   *  Reconciliation rules:
   *   - Existing path, same mtime → no-op
   *   - Existing path, newer mtime → UPDATE metadata (keep cover — same
   *     file, likely a re-download)
   *   - New path → INSERT, then try to inherit a cover from an orphaned
   *     row with the same filename (soft match)
   *   - Orphaned path (in DB, not in scan) → DELETE
   */
  reconcile(scanned: ScannedFile[]): {
    added: number;
    updated: number;
    removed: number;
    total: number;
  } {
    const existing = this.db
      .prepare(
        'SELECT id, path, mtime, cover_blob, page_count, ingested_at, ai_system, ai_category, ai_subcategory, ai_title, ai_publisher, ai_classified_at FROM books',
      )
      .all() as Array<{
      id: number;
      path: string;
      mtime: number;
      cover_blob: Buffer | null;
      page_count: number | null;
      ingested_at: number | null;
      ai_system: string | null;
      ai_category: string | null;
      ai_subcategory: string | null;
      ai_title: string | null;
      ai_publisher: string | null;
      ai_classified_at: number | null;
    }>;
    const byPath = new Map<string, (typeof existing)[0]>();
    for (const row of existing) {
      byPath.set(row.path, row);
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
           mtime = @mtime
       WHERE path = @path`,
    );
    const deleteStmt = this.db.prepare('DELETE FROM books WHERE id = ?');
    const transferMetadata = this.db.prepare(
      `UPDATE books SET cover_blob = ?, page_count = ?, ingested_at = ?,
       ai_system = ?, ai_category = ?, ai_subcategory = ?, ai_title = ?, ai_publisher = ?, ai_classified_at = ?
       WHERE path = ?`,
    );

    let added = 0;
    let updated = 0;
    let removed = 0;

    const tx = this.db.transaction(() => {
      // Pass 1: update existing, insert new.
      const newPaths: string[] = [];
      for (const s of scanned) {
        const prior = byPath.get(s.path);
        if (!prior) {
          insert.run(s);
          newPaths.push(s.path);
          added++;
        } else if (prior.mtime !== s.mtime) {
          update.run(s);
          updated++;
        }
      }

      // Pass 2: identify orphans (in DB but not in scan) that have metadata worth transferring.
      const orphansWithMetadata = new Map<string, (typeof existing)[0]>();
      const orphanIds: number[] = [];
      for (const row of existing) {
        if (!scannedPaths.has(row.path)) {
          orphanIds.push(row.id);
          if (row.cover_blob || row.ai_classified_at) {
            orphansWithMetadata.set(basename(row.path).toLowerCase(), row);
          }
        }
      }

      // Pass 3: soft-match orphan metadata to newly inserted rows by filename.
      if (orphansWithMetadata.size > 0 && newPaths.length > 0) {
        for (const newPath of newPaths) {
          const key = basename(newPath).toLowerCase();
          const donor = orphansWithMetadata.get(key);
          if (donor) {
            transferMetadata.run(
              donor.cover_blob,
              donor.page_count,
              donor.ingested_at,
              donor.ai_system,
              donor.ai_category,
              donor.ai_subcategory,
              donor.ai_title,
              donor.ai_publisher,
              donor.ai_classified_at,
              newPath,
            );
            orphansWithMetadata.delete(key);
          }
        }
      }

      // Pass 4: delete orphans.
      for (const id of orphanIds) {
        deleteStmt.run(id);
        removed++;
      }
    });
    tx();

    const total = this.db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number };
    return { added, updated, removed, total: total.c };
  }

  /** Finalize a phase-2 ingest. Stores the cover PNG blob and page count. */
  finalizeIngest(id: number, pageCount: number, coverPng: Buffer): Book | null {
    const now = Date.now();
    this.db
      .prepare('UPDATE books SET page_count = ?, cover_blob = ?, ingested_at = ? WHERE id = ?')
      .run(pageCount, coverPng, now, id);
    return this.getById(id);
  }

  /** Save AI classification for a single book. */
  saveClassification(id: number, c: BookClassification): void {
    this.db
      .prepare(
        `UPDATE books SET ai_system = ?, ai_category = ?, ai_subcategory = ?,
         ai_title = ?, ai_publisher = ?, ai_classified_at = ? WHERE id = ?`,
      )
      .run(c.system, c.category, c.subcategory ?? null, c.title, c.publisher ?? null, Date.now(), id);
  }

  /** Update individual AI metadata fields for a book. */
  updateMeta(
    id: number,
    fields: { aiSystem?: string; aiCategory?: string; aiSubcategory?: string | null; aiPublisher?: string | null },
  ): Book | null {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.aiSystem !== undefined) {
      sets.push('ai_system = ?');
      vals.push(fields.aiSystem);
    }
    if (fields.aiCategory !== undefined) {
      sets.push('ai_category = ?');
      vals.push(fields.aiCategory);
    }
    if (fields.aiSubcategory !== undefined) {
      sets.push('ai_subcategory = ?');
      vals.push(fields.aiSubcategory);
    }
    if (fields.aiPublisher !== undefined) {
      sets.push('ai_publisher = ?');
      vals.push(fields.aiPublisher);
    }
    if (sets.length === 0) return this.getById(id);
    vals.push(id);
    this.db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getById(id);
  }

  /** All ingested books without AI classification. */
  listUnclassified(): Array<{ id: number; path: string; cover_blob: Buffer }> {
    return this.db
      .prepare('SELECT id, path, cover_blob FROM books WHERE cover_blob IS NOT NULL AND ai_classified_at IS NULL')
      .all() as Array<{ id: number; path: string; cover_blob: Buffer }>;
  }

  /** All ingested books (for reclassify-all). */
  listClassifiable(): Array<{ id: number; path: string; cover_blob: Buffer }> {
    return this.db.prepare('SELECT id, path, cover_blob FROM books WHERE cover_blob IS NOT NULL').all() as Array<{
      id: number;
      path: string;
      cover_blob: Buffer;
    }>;
  }

  /** Migrate cover PNGs from disk files into the database. Called once at
   *  startup by main.ts for the v1→v2 transition. */
  migrateDiskCovers(readFile: (id: number) => Buffer | null): number {
    const rows = this.db
      .prepare('SELECT id FROM books WHERE cover_blob IS NULL AND ingested_at IS NOT NULL')
      .all() as Array<{ id: number }>;
    if (rows.length === 0) return 0;

    const update = this.db.prepare('UPDATE books SET cover_blob = ? WHERE id = ?');
    let migrated = 0;
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const buf = readFile(row.id);
        if (buf) {
          update.run(buf, row.id);
          migrated++;
        }
      }
    });
    tx();
    return migrated;
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
    aiSystem: row.ai_system,
    aiCategory: row.ai_category,
    aiSubcategory: row.ai_subcategory,
    aiTitle: row.ai_title,
    aiPublisher: row.ai_publisher,
    classified: row.ai_classified_at !== null,
  };
}
