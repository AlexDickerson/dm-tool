// Data-fetching hooks for the map browser. Kept simple — no react-query
// or SWR since the MVP only needs three queries and the data is local.
// If we grow to more complex caching we should pull in react-query and
// move to that.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Facets, MapDetail, MapSummary, SearchParams } from "@shared/types";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Debounced search against the index. The `params` object is serialized
 *  shallowly for the debounce key — if we add array fields (which we do,
 *  for tag filters) callers need to pass stable references to avoid
 *  re-firing on every render. */
export function useMapSearch(
  params: SearchParams,
  debounceMs = 150,
): AsyncState<MapSummary[]> & { refresh: () => void } {
  const [state, setState] = useState<AsyncState<MapSummary[]>>({
    data: null,
    loading: true,
    error: null,
  });
  // Track the latest request so stale responses don't clobber fresh ones.
  const requestIdRef = useRef(0);
  // Bumping this key forces a re-fetch even if params haven't changed
  // (e.g. after the tagger imports new maps into the library).
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    const timer = window.setTimeout(async () => {
      try {
        const rows = await api.searchMaps(params);
        if (requestIdRef.current !== id) return; // a newer request already fired
        setState({ data: rows, loading: false, error: null });
      } catch (e) {
        if (requestIdRef.current !== id) return;
        setState({ data: null, loading: false, error: (e as Error).message });
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [params, debounceMs, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { ...state, refresh };
}

export function useFacets(): AsyncState<Facets> {
  const [state, setState] = useState<AsyncState<Facets>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .getFacets()
      .then((facets) => {
        if (!cancelled) setState({ data: facets, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function useMapDetail(fileName: string | null): AsyncState<MapDetail> {
  const [state, setState] = useState<AsyncState<MapDetail>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!fileName) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    api
      .getMapDetail(fileName)
      .then((detail) => {
        if (!cancelled) setState({ data: detail, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  return state;
}

/** Convenience helper for opening a map's containing folder in the OS
 *  file browser. Returns a stable callback. */
export function useOpenInExplorer() {
  return useCallback(async (fileName: string) => {
    try {
      await api.openInExplorer(fileName);
    } catch (e) {
      console.error("openInExplorer failed:", e);
    }
  }, []);
}

// ---------------------------------------------------------------------------
// Pack mapping (AI-driven variant clustering)
// ---------------------------------------------------------------------------

interface PackMappingState {
  /** The mapping from fileName → packName, or null if not yet loaded. */
  mapping: Record<string, string> | null;
  /** Error from the last import attempt, if any. */
  error: string | null;
}

/** Fetch the cached pack mapping on mount (and whenever `version`
 *  changes, e.g. after an import via Settings). Exposes `merge` for
 *  in-browser pack merging. */
export function usePackMapping(version = 0): PackMappingState & {
  merge: (sourcePacks: string[], targetName: string) => Promise<void>;
} {
  const [state, setState] = useState<PackMappingState>({
    mapping: null,
    error: null,
  });

  // Fetch cached mapping on mount and when version bumps.
  useEffect(() => {
    let cancelled = false;
    api
      .getPackMapping()
      .then((mapping) => {
        if (!cancelled && mapping) {
          setState({ mapping, error: null });
        }
      })
      .catch((e: Error) => {
        if (!cancelled) console.error("Failed to load pack mapping cache:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const merge = useCallback(async (sourcePacks: string[], targetName: string) => {
    try {
      const mapping = await api.mergePacks({ sourcePacks, targetName });
      setState({ mapping, error: null });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    }
  }, []);

  return { ...state, merge };
}
