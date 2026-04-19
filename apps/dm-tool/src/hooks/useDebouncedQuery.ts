// Generic data-fetching hooks that encapsulate the debounce + stale-
// request-cancellation pattern used across every browser/search feature.
// Replaces the identical boilerplate that was copy-pasted into useMaps,
// useItems, and useMonsters.

import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// useDebouncedQuery — debounced parameterised search with manual refresh
// ---------------------------------------------------------------------------

/**
 * Debounced query with stale-request cancellation and optional manual
 * refresh. Mirrors the pattern previously inlined in useMapSearch,
 * useItemSearch, and useMonsterSearch.
 *
 * @param fetcher  Async function that performs the actual query.
 * @param params   Search parameters — the effect re-runs when this
 *                 reference changes, so callers must stabilise it with
 *                 useMemo if the object is constructed inline.
 * @param debounceMs  Debounce delay in ms (default 150).
 */
export function useDebouncedQuery<TParams, TResult>(
  fetcher: (params: TParams) => Promise<TResult>,
  params: TParams,
  debounceMs = 150,
): AsyncState<TResult> & { refresh: () => void } {
  const [state, setState] = useState<AsyncState<TResult>>({
    data: null,
    loading: true,
    error: null,
  });
  const requestIdRef = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    const timer = window.setTimeout(async () => {
      try {
        const result = await fetcher(params);
        if (requestIdRef.current !== id) return;
        setState({ data: result, loading: false, error: null });
      } catch (e) {
        if (requestIdRef.current !== id) return;
        setState({ data: null, loading: false, error: (e as Error).message });
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [fetcher, params, debounceMs, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { ...state, refresh };
}

// ---------------------------------------------------------------------------
// useQuery — one-shot query keyed on a nullable identifier
// ---------------------------------------------------------------------------

/**
 * Fires a single async query when `key` is non-null. Resets to idle
 * when key becomes null. Guards against stale responses via a
 * `cancelled` flag.
 */
export function useQuery<TKey, TResult>(
  fetcher: (key: TKey) => Promise<TResult>,
  key: TKey | null,
): AsyncState<TResult> {
  const [state, setState] = useState<AsyncState<TResult>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (key === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    fetcher(key)
      .then((result) => {
        if (!cancelled) setState({ data: result, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, key]);

  return state;
}
