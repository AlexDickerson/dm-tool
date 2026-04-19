import { basename } from 'node:path';
import { ipcMain } from 'electron';
import type { BookDb } from '../book-db.js';
import type { DmToolConfig } from '../config.js';
import type { Book, BookClassifyProgress, BookScanResult, FinalizeIngestArgs } from '@dm-tool/shared/types';
import { classifyBook } from '@dm-tool/ai/classifier';
import { scanBookRoot } from '../book-scanner.js';

export function registerBookHandlers(
  bookDb: BookDb | null,
  cfg: DmToolConfig,
  getMainWindow: () => Electron.BrowserWindow | null,
): void {
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

  ipcMain.handle(
    'booksUpdateMeta',
    async (
      _e,
      args: {
        id: number;
        fields: { aiSystem?: string; aiCategory?: string; aiSubcategory?: string | null; aiPublisher?: string | null };
      },
    ): Promise<Book | null> => {
      return requireBookDb().updateMeta(args.id, args.fields);
    },
  );

  // --- AI classification ------------------------------------------------------

  let classifyAbort = false;

  const sendProgress = (p: BookClassifyProgress): void => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('book-classify-progress', p);
  };

  const CLASSIFY_CONCURRENCY = 10;

  ipcMain.handle('booksClassify', async (_e, args: { apiKey: string; reclassify?: boolean }): Promise<void> => {
    const b = requireBookDb();
    const books = args.reclassify ? b.listClassifiable() : b.listUnclassified();
    const total = books.length;
    classifyAbort = false;
    let completed = 0;
    let idx = 0;

    // Worker function — each grabs the next unprocessed book until done.
    const worker = async (): Promise<void> => {
      while (idx < books.length && !classifyAbort) {
        const book = books[idx++]!;
        const fileName = basename(book.path);
        try {
          const classification = await classifyBook({
            apiKey: args.apiKey,
            coverImage: book.cover_blob,
            fileName,
          });
          b.saveClassification(book.id, classification);
        } catch (err) {
          console.error(`Classification failed for ${fileName}:`, err);
          sendProgress({ type: 'error', bookId: book.id, bookTitle: fileName, error: (err as Error).message });
        }
        completed++;
        sendProgress({ type: 'progress', bookId: book.id, bookTitle: fileName, current: completed, total });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CLASSIFY_CONCURRENCY, total) }, () => worker()));

    sendProgress({ type: 'done', current: total, total });
  });

  ipcMain.handle('booksClassifyCancel', (): void => {
    classifyAbort = true;
  });
}
