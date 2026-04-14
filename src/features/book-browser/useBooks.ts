// Data hooks for the book catalog. Same minimal pattern as useMaps.ts —
// no react-query, just useState + useEffect. The data is local and small
// enough that we don't need caching or deduplication.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Book, BookClassifyProgress, BookScanResult } from '@shared/types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Load the full book list. Runs once on mount; call `refetch` after a
 *  scan to pick up changes without remounting. */
export function useBookList(): AsyncState<Book[]> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<Book[]>>({
    data: null,
    loading: true,
    error: null,
  });
  const mountedRef = useRef(true);

  const fetch = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .booksList()
      .then((books) => {
        if (mountedRef.current) setState({ data: books, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (mountedRef.current) setState({ data: null, loading: false, error: e.message });
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => {
      mountedRef.current = false;
    };
  }, [fetch]);

  return { ...state, refetch: fetch };
}

/** Trigger a phase-1 rescan. Returns the scan summary and a loading flag
 *  so the UI can show a spinner while the walk runs. */
export function useBookScan(): {
  scan: () => Promise<BookScanResult>;
  scanning: boolean;
} {
  const [scanning, setScanning] = useState(false);
  const scan = useCallback(async () => {
    setScanning(true);
    try {
      return await api.booksScan();
    } finally {
      setScanning(false);
    }
  }, []);
  return { scan, scanning };
}

// ---------------------------------------------------------------------------
// AI classification
// ---------------------------------------------------------------------------

export function useBookClassify(): {
  classify: (reclassify?: boolean) => Promise<void>;
  cancel: () => void;
  running: boolean;
  current: number;
  total: number;
} {
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const unsub = api.onBookClassifyProgress((p: BookClassifyProgress) => {
      if (p.type === 'progress') {
        setCurrent(p.current ?? 0);
        setTotal(p.total ?? 0);
      } else if (p.type === 'done') {
        setRunning(false);
      }
    });
    return unsub;
  }, []);

  const classify = useCallback(async (reclassify?: boolean) => {
    const apiKey = await api.secureLoad('anthropic-api-key');
    if (!apiKey) throw new Error('No API key configured. Set your Anthropic API key in Settings.');
    setRunning(true);
    setCurrent(0);
    setTotal(0);
    await api.booksClassify({ apiKey, reclassify });
  }, []);

  const cancel = useCallback(() => {
    api.booksClassifyCancel();
  }, []);

  return { classify, cancel, running, current, total };
}

// ---------------------------------------------------------------------------
// Background cover extraction
// ---------------------------------------------------------------------------

const COVER_WIDTH = 300;

/** Extract a 300px cover PNG from page 1 of a book and finalize its
 *  ingest. Shared by the background ingest loop and the reader's
 *  first-open path.
 *
 *  Memory discipline is critical here — the background loop calls this
 *  114 times in a row and the renderer OOMs if we leak canvas bitmaps
 *  or pdfjs internal buffers. Every resource is released in a finally
 *  block, and the canvas bitmap is zeroed immediately after toBlob. */
/** Lazy pdfjs reference. Loaded on first extractCover call so the 1.3 MB
 *  bundle + worker don't parse at app startup and compete with React's
 *  initial render for heap space. */
let _pdfjs: typeof import('pdfjs-dist') | null = null;
async function getPdfjs() {
  if (!_pdfjs) {
    const { pdfjsLib } = await import('@/lib/pdfjs');
    _pdfjs = pdfjsLib;
  }
  return _pdfjs;
}

/** A shared "fake" PDFWorker that runs PDF parsing on the renderer's main
 *  thread instead of in a web worker. The web worker's V8 heap is tiny
 *  (~10 MB) and OOMs when parsing large PDFs (68 MB Abomination Vaults).
 *  The renderer's main thread has GB of heap, so the parsing fits easily.
 *  Brief UI blocking during page-1 extraction is imperceptible. */
let _fakeWorker: InstanceType<typeof import('pdfjs-dist').PDFWorker> | null = null;
async function getFakeWorker() {
  if (!_fakeWorker) {
    const pdfjsLib = await getPdfjs();
    _fakeWorker = new pdfjsLib.PDFWorker({ port: null });
    await _fakeWorker.promise;
  }
  return _fakeWorker;
}

export async function extractCover(bookId: number): Promise<void> {
  const pdfjsLib = await getPdfjs();
  const worker = await getFakeWorker();
  const fileUrl = await api.booksGetFileUrl(bookId);
  const task = pdfjsLib.getDocument({
    url: fileUrl,
    worker,
    disableAutoFetch: true,
    disableStream: true,
  });
  let doc: import('pdfjs-dist/types/src/display/api').PDFDocumentProxy;
  const canvas = document.createElement('canvas');
  try {
    doc = await task.promise;
  } catch {
    // Corrupted, password-protected, or non-standard PDF — skip silently.
    // The catalog will show a placeholder cover for this book.
    task.destroy();
    return;
  }
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = COVER_WIDTH / vp.width;
    const scaledVp = page.getViewport({ scale });

    canvas.width = scaledVp.width;
    canvas.height = scaledVp.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: scaledVp }).promise;

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) return;

    await api.booksFinalizeIngest({
      id: bookId,
      pageCount: doc.numPages,
      coverPngBytes: new Uint8Array(await blob.arrayBuffer()),
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    doc.destroy();
  }
}

/** Processes un-ingested books one at a time in the background. Calls
 *  `onProgress` after each book so the catalog can refresh its covers
 *  incrementally. The effect runs once when `books` first arrives (or
 *  when the list identity changes after a rescan), NOT on every refetch
 *  — otherwise each `onProgress → refetch → books update` would restart
 *  the loop and flash the counter. */
export function useBackgroundIngest(
  books: Book[] | null,
  onProgress: () => void,
): { ingesting: boolean; remaining: number } {
  const [ingesting, setIngesting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const abortRef = useRef(false);
  const runningRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Trigger the loop only once: when we first get a book list with
  // un-ingested entries. Subsequent refetch() calls update the `books`
  // array reference but should NOT restart the loop. We use a "started"
  // flag that only resets on unmount.
  const startedRef = useRef(false);

  useEffect(() => {
    return () => {
      abortRef.current = true;
      startedRef.current = false;
      runningRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!books || startedRef.current) return;
    const pending = books.filter((b) => !b.ingested);
    if (pending.length === 0) return;

    startedRef.current = true;
    runningRef.current = true;
    abortRef.current = false;
    setIngesting(true);
    setRemaining(pending.length);

    (async () => {
      for (const book of pending) {
        if (abortRef.current) break;
        try {
          await extractCover(book.id);
          onProgressRef.current();
        } catch (e) {
          console.error(`Background ingest failed for "${book.title}":`, e);
        }
        setRemaining((r) => Math.max(0, r - 1));
        await new Promise((r) => setTimeout(r, 500));
      }
      setIngesting(false);
      runningRef.current = false;
    })();
  }, [books]);

  return { ingesting, remaining };
}
