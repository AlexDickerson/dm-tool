import { ipcMain } from 'electron';
import type { BookDb } from '../book-db.js';
import type { DmToolConfig } from '../config.js';
import type { Book, BookScanResult, FinalizeIngestArgs } from '../../shared/types.js';
import { scanBookRoot } from '../book-scanner.js';

export function registerBookHandlers(bookDb: BookDb | null, cfg: DmToolConfig): void {
  const requireBookDb = (): BookDb => {
    if (!bookDb) {
      throw new Error('Book catalog not configured. Set `booksPath` in config.json to the root of your PDF library.');
    }
    return bookDb;
  };

  ipcMain.handle('booksScan', async (): Promise<BookScanResult> => {
    const b = requireBookDb();
    if (!cfg.booksPath) {
      throw new Error('booksScan: booksPath is not set');
    }
    const scanned = scanBookRoot(cfg.booksPath);
    return b.reconcile(scanned);
  });

  ipcMain.handle('booksList', async (): Promise<Book[]> => {
    return requireBookDb().listAll();
  });

  ipcMain.handle('booksGet', async (_e, id: number): Promise<Book | null> => {
    return requireBookDb().getById(id);
  });

  ipcMain.handle('booksFinalizeIngest', async (_e, args: FinalizeIngestArgs): Promise<Book> => {
    const b = requireBookDb();
    if (!args || typeof args.id !== 'number' || typeof args.pageCount !== 'number') {
      throw new Error('booksFinalizeIngest: id and pageCount are required');
    }
    if (!(args.coverPngBytes instanceof Uint8Array)) {
      throw new Error('booksFinalizeIngest: coverPngBytes must be a Uint8Array');
    }
    const existing = b.getById(args.id);
    if (!existing) {
      throw new Error(`booksFinalizeIngest: unknown book id ${args.id}`);
    }

    const updated = b.finalizeIngest(args.id, args.pageCount, Buffer.from(args.coverPngBytes));
    if (!updated) {
      throw new Error(`booksFinalizeIngest: row vanished for id ${args.id}`);
    }
    return updated;
  });

  ipcMain.handle('booksGetFileUrl', async (_e, id: number): Promise<string> => {
    const b = requireBookDb();
    const path = b.getPath(id);
    if (!path) throw new Error(`booksGetFileUrl: unknown book id ${id}`);
    return `book-file://files/${id}`;
  });

  ipcMain.handle('booksGetCoverUrl', async (_e, id: number): Promise<string> => {
    requireBookDb();
    return `book-file://covers/${id}`;
  });
}
