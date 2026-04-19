import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ItemBrowserDetail, ItemBrowserRow, ItemFacets, ItemSearchParams } from '@dm-tool/shared/types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Debounced search against the PF2e item database. Callers must pass
 *  stable param references (via useMemo) to avoid re-firing on every
 *  render — same pattern as useMapSearch. */
export function useItemSearch(
  params: ItemSearchParams,
  debounceMs = 150,
): AsyncState<ItemBrowserRow[]> & { refresh: () => void } {
  const [state, setState] = useState<AsyncState<ItemBrowserRow[]>>({
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
        const rows = await api.searchItemsBrowser(params);
        if (requestIdRef.current !== id) return;
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

export function useItemFacets(): AsyncState<ItemFacets> {
  const [state, setState] = useState<AsyncState<ItemFacets>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .getItemFacets()
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

export function useItemDetail(id: string | null): AsyncState<ItemBrowserDetail> {
  const [state, setState] = useState<AsyncState<ItemBrowserDetail>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!id) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    api
      .getItemBrowserDetail(id)
      .then((detail) => {
        if (!cancelled) setState({ data: detail, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}
