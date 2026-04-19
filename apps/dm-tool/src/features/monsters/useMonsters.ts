import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useDebouncedQuery, useQuery } from '@/hooks/useDebouncedQuery';
import type { MonsterDetail, MonsterFacets, MonsterSearchParams, MonsterSummary } from '@dm-tool/shared/types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const fetchMonsters = (params: MonsterSearchParams) => api.monstersSearch(params);
const fetchMonsterDetail = (name: string) => api.monstersGetDetail(name);

export function useMonsterSearch(params: MonsterSearchParams, debounceMs = 150): AsyncState<MonsterSummary[]> {
  return useDebouncedQuery(fetchMonsters, params, debounceMs);
}

export function useMonsterFacets(): AsyncState<MonsterFacets> {
  const [state, setState] = useState<AsyncState<MonsterFacets>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .monstersFacets()
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

export function useMonsterDetail(name: string | null): AsyncState<MonsterDetail> {
  return useQuery(fetchMonsterDetail, name);
}

export function useOpenExternal() {
  return useCallback(async (url: string) => {
    try {
      await api.openExternal(url);
    } catch (e) {
      console.error('openExternal failed:', e);
    }
  }, []);
}
