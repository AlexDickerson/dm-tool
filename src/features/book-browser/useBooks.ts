// Data hooks for the book catalog. Same minimal pattern as useMaps.ts —
// no react-query, just useState + useEffect. The data is local and small
// enough that we don't need caching or deduplication.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Book, BookScanResult } from "@shared/types";

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
