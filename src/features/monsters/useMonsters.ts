import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { MonsterDetail, MonsterFacets, MonsterSearchParams, MonsterSummary } from '@shared/types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useMonsterSearch(
  params: MonsterSearchParams,
  debounceMs = 150,
): AsyncState<MonsterSummary[]> {
  const [state, setState] = useState<AsyncState<MonsterSummary[]>>({
    data: null,
    loading: true,
    error: null,
  });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    const timer = window.setTimeout(async () => {
      try {
        const rows = await api.monstersSearch(params);
        if (requestIdRef.current !== id) return;
        setState({ data: rows, loading: false, error: null });
      } catch (e) {
        if (requestIdRef.current !== id) return;
        setState({ data: null, loading: false, error: (e as Error).message });
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [params, debounceMs]);

  return state;
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
  const [state, setState] = useState<AsyncState<MonsterDetail>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!name) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    api
      .monstersGetDetail(name)
      .then((detail) => {
        if (!cancelled) setState({ data: detail, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return state;
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
