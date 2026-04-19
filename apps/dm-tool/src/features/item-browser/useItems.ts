import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useDebouncedQuery, useQuery } from '@/hooks/useDebouncedQuery';
import type { ItemBrowserDetail, ItemBrowserRow, ItemFacets, ItemSearchParams } from '@dm-tool/shared/types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const fetchItems = (params: ItemSearchParams) => api.searchItemsBrowser(params);
const fetchItemDetail = (id: string) => api.getItemBrowserDetail(id);

/** Debounced search against the PF2e item database. Callers must pass
 *  stable param references (via useMemo) to avoid re-firing on every
 *  render — same pattern as useMapSearch. */
export function useItemSearch(
  params: ItemSearchParams,
  debounceMs = 150,
): AsyncState<ItemBrowserRow[]> & { refresh: () => void } {
  return useDebouncedQuery(fetchItems, params, debounceMs);
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
  return useQuery(fetchItemDetail, id);
}
