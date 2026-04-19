/** @vitest-environment happy-dom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Facets, MapDetail, MapSummary, SearchParams } from '@dm-tool/shared/types';

// vi.hoisted lifts the mock fn above the vi.mock factory (itself hoisted
// above all imports). Supported pattern for a single spy shared between
// the test and the mocked module.
const { searchMapsMock, getFacetsMock, getMapDetailMock, openInExplorerMock, getPackMappingMock, mergePacksMock } =
  vi.hoisted(() => ({
    searchMapsMock: vi.fn(),
    getFacetsMock: vi.fn(),
    getMapDetailMock: vi.fn(),
    openInExplorerMock: vi.fn(),
    getPackMappingMock: vi.fn(),
    mergePacksMock: vi.fn(),
  }));

vi.mock('@/lib/api', () => ({
  api: {
    searchMaps: searchMapsMock,
    getFacets: getFacetsMock,
    getMapDetail: getMapDetailMock,
    openInExplorer: openInExplorerMock,
    getPackMapping: getPackMappingMock,
    mergePacks: mergePacksMock,
  },
}));

import { useFacets, useMapDetail, useMapSearch, useOpenInExplorer, usePackMapping } from './useMaps';

// NOTE: useMapSearch's `params` must be a stable reference — passing an
// inline `{}` re-triggers the debounce effect every render, causing an
// infinite loop documented in the hook itself. Tests must hold params
// outside the render callback.
const DEBOUNCE_MS = 10;
const SETTLE_MS = 200;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkRow(fileName: string): MapSummary {
  return {
    fileName,
    title: fileName,
    description: '',
    interiorExterior: null,
    timeOfDay: null,
    gridVisible: null,
    gridCells: null,
    approxPartyScale: null,
  };
}

function mkDetail(fileName: string): MapDetail {
  return {
    ...mkRow(fileName),
    fileHashSha256: 'hash',
    phash: 'phash',
    widthPx: 1000,
    heightPx: 800,
    biomes: [],
    locationTypes: [],
    mood: [],
    features: [],
    encounterHooks: [],
    additionalEncounterHooks: [],
    taggedAt: '2026-01-01T00:00:00.000Z',
    model: 'test-model',
  };
}

beforeEach(() => {
  searchMapsMock.mockReset();
  getFacetsMock.mockReset();
  getMapDetailMock.mockReset();
  openInExplorerMock.mockReset();
  getPackMappingMock.mockReset();
  mergePacksMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

describe('useMapSearch — debounce', () => {
  it('does not call searchMaps synchronously on mount', () => {
    searchMapsMock.mockResolvedValue([]);
    const params: SearchParams = {};
    renderHook(() => useMapSearch(params, DEBOUNCE_MS));
    expect(searchMapsMock).not.toHaveBeenCalled();
  });

  it('calls searchMaps once after the debounce interval elapses', async () => {
    searchMapsMock.mockResolvedValue([]);
    const params: SearchParams = {};
    renderHook(() => useMapSearch(params, DEBOUNCE_MS));
    await waitFor(() => expect(searchMapsMock).toHaveBeenCalledTimes(1), { timeout: SETTLE_MS });
  });

  it('collapses rapid parameter changes into a single request', async () => {
    searchMapsMock.mockResolvedValue([]);
    const paramsA: SearchParams = { keywords: 'a' };
    const paramsAB: SearchParams = { keywords: 'ab' };
    const paramsABC: SearchParams = { keywords: 'abc' };
    const { rerender } = renderHook(({ params }: { params: SearchParams }) => useMapSearch(params, DEBOUNCE_MS), {
      initialProps: { params: paramsA },
    });
    rerender({ params: paramsAB });
    rerender({ params: paramsABC });
    await waitFor(() => expect(searchMapsMock).toHaveBeenCalledTimes(1), { timeout: SETTLE_MS });
    expect(searchMapsMock).toHaveBeenLastCalledWith(paramsABC);
  });
});

// ---------------------------------------------------------------------------
// Request-ID tracking (stale response protection)
// ---------------------------------------------------------------------------

describe('useMapSearch — stale response protection', () => {
  it('ignores a stale response when a newer request has already fired', async () => {
    let resolveFirst!: (rows: MapSummary[]) => void;
    const firstPromise = new Promise<MapSummary[]>((r) => {
      resolveFirst = r;
    });
    searchMapsMock.mockImplementationOnce(() => firstPromise);
    searchMapsMock.mockResolvedValueOnce([mkRow('second.jpg')]);

    const paramsA: SearchParams = { keywords: 'first' };
    const paramsB: SearchParams = { keywords: 'second' };
    const { result, rerender } = renderHook(
      ({ params }: { params: SearchParams }) => useMapSearch(params, DEBOUNCE_MS),
      { initialProps: { params: paramsA } },
    );

    await waitFor(() => expect(searchMapsMock).toHaveBeenCalledTimes(1), { timeout: SETTLE_MS });
    rerender({ params: paramsB });
    await waitFor(() => expect(searchMapsMock).toHaveBeenCalledTimes(2), { timeout: SETTLE_MS });
    await waitFor(() => expect(result.current.data).toEqual([mkRow('second.jpg')]), { timeout: SETTLE_MS });

    // Resolve the stale promise — the hook must NOT overwrite fresh data.
    await act(async () => {
      resolveFirst([mkRow('first.jpg')]);
      await wait(20);
    });
    expect(result.current.data).toEqual([mkRow('second.jpg')]);
  });

  it('surfaces errors from the latest request', async () => {
    searchMapsMock.mockRejectedValueOnce(new Error('boom'));
    const params: SearchParams = {};
    const { result } = renderHook(() => useMapSearch(params, DEBOUNCE_MS));
    await waitFor(() => expect(result.current.error).toBe('boom'), { timeout: SETTLE_MS });
    expect(result.current.loading).toBe(false);
  });

  it('ignores an error from a stale request', async () => {
    let rejectFirst!: (err: Error) => void;
    const firstPromise = new Promise<MapSummary[]>((_resolve, reject) => {
      rejectFirst = reject;
    });
    searchMapsMock.mockImplementationOnce(() => firstPromise);
    searchMapsMock.mockResolvedValueOnce([mkRow('latest.jpg')]);

    const paramsA: SearchParams = { keywords: 'a' };
    const paramsB: SearchParams = { keywords: 'b' };
    const { result, rerender } = renderHook(
      ({ params }: { params: SearchParams }) => useMapSearch(params, DEBOUNCE_MS),
      { initialProps: { params: paramsA } },
    );
    await waitFor(() => expect(searchMapsMock).toHaveBeenCalledTimes(1), { timeout: SETTLE_MS });
    rerender({ params: paramsB });
    await waitFor(() => expect(result.current.data).toEqual([mkRow('latest.jpg')]), { timeout: SETTLE_MS });

    await act(async () => {
      rejectFirst(new Error('stale error'));
      await wait(20);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual([mkRow('latest.jpg')]);
  });
});

// ---------------------------------------------------------------------------
// refresh()
// ---------------------------------------------------------------------------

describe('useMapSearch — refresh', () => {
  it('re-fires the request when refresh() is called even if params are unchanged', async () => {
    searchMapsMock.mockResolvedValue([]);
    const params: SearchParams = {};
    const { result } = renderHook(() => useMapSearch(params, DEBOUNCE_MS));
    await waitFor(() => expect(searchMapsMock).toHaveBeenCalledTimes(1), { timeout: SETTLE_MS });

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(searchMapsMock).toHaveBeenCalledTimes(2), { timeout: SETTLE_MS });
  });
});

describe('useFacets', () => {
  it('loads facets successfully', async () => {
    const facets: Facets = { biomes: ['forest'], locationTypes: ['dungeon'], moods: ['grim'], features: ['ruins'] };
    getFacetsMock.mockResolvedValue(facets);
    const { result } = renderHook(() => useFacets());
    await waitFor(() => expect(result.current.data).toEqual(facets), { timeout: SETTLE_MS });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces load errors', async () => {
    getFacetsMock.mockRejectedValueOnce(new Error('facets failed'));
    const { result } = renderHook(() => useFacets());
    await waitFor(() => expect(result.current.error).toBe('facets failed'), { timeout: SETTLE_MS });
    expect(result.current.loading).toBe(false);
  });
});

describe('useMapDetail', () => {
  it('stays idle when fileName is null', () => {
    const { result } = renderHook(() => useMapDetail(null));
    expect(getMapDetailMock).not.toHaveBeenCalled();
    expect(result.current).toEqual({ data: null, loading: false, error: null });
  });

  it('loads detail for a selected file', async () => {
    const detail = mkDetail('map-a.jpg');
    getMapDetailMock.mockResolvedValue(detail);
    const { result } = renderHook(() => useMapDetail('map-a.jpg'));
    await waitFor(() => expect(result.current.data).toEqual(detail), { timeout: SETTLE_MS });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getMapDetailMock).toHaveBeenCalledWith('map-a.jpg');
  });

  it('surfaces detail load errors', async () => {
    getMapDetailMock.mockRejectedValueOnce(new Error('detail failed'));
    const { result } = renderHook(() => useMapDetail('map-a.jpg'));
    await waitFor(() => expect(result.current.error).toBe('detail failed'), { timeout: SETTLE_MS });
    expect(result.current.loading).toBe(false);
  });

  it('ignores stale response when selection changes', async () => {
    let resolveFirst!: (value: MapDetail | null) => void;
    const firstPromise = new Promise<MapDetail | null>((resolve) => {
      resolveFirst = resolve;
    });
    getMapDetailMock.mockImplementationOnce(() => firstPromise);
    getMapDetailMock.mockResolvedValueOnce(mkDetail('new.jpg'));

    const { result, rerender } = renderHook(({ fileName }: { fileName: string | null }) => useMapDetail(fileName), {
      initialProps: { fileName: 'old.jpg' },
    });
    rerender({ fileName: 'new.jpg' });
    await waitFor(() => expect(result.current.data?.fileName).toBe('new.jpg'), { timeout: SETTLE_MS });

    await act(async () => {
      resolveFirst(mkDetail('old.jpg'));
      await wait(20);
    });
    expect(result.current.data?.fileName).toBe('new.jpg');
  });
});

describe('useOpenInExplorer', () => {
  it('calls api.openInExplorer with the file name', async () => {
    openInExplorerMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOpenInExplorer());
    await act(async () => {
      await result.current('map-a.jpg');
    });
    expect(openInExplorerMock).toHaveBeenCalledWith('map-a.jpg');
  });

  it('swallows API errors and logs', async () => {
    openInExplorerMock.mockRejectedValue(new Error('cannot open'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useOpenInExplorer());
    await act(async () => {
      await result.current('map-a.jpg');
    });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('usePackMapping', () => {
  it('loads cached mapping on mount', async () => {
    getPackMappingMock.mockResolvedValueOnce({ 'a.jpg': 'Pack A' });
    const { result } = renderHook(() => usePackMapping());
    await waitFor(() => expect(result.current.mapping).toEqual({ 'a.jpg': 'Pack A' }), { timeout: SETTLE_MS });
    expect(result.current.error).toBeNull();
  });

  it('keeps mapping null when cache is empty', async () => {
    getPackMappingMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => usePackMapping());
    await waitFor(() => expect(getPackMappingMock).toHaveBeenCalledTimes(1), { timeout: SETTLE_MS });
    expect(result.current.mapping).toBeNull();
  });

  it('reloads mapping when version changes', async () => {
    getPackMappingMock.mockResolvedValueOnce({ 'a.jpg': 'Pack A' }).mockResolvedValueOnce({ 'b.jpg': 'Pack B' });
    const { result, rerender } = renderHook(({ version }: { version: number }) => usePackMapping(version), {
      initialProps: { version: 0 },
    });
    await waitFor(() => expect(result.current.mapping).toEqual({ 'a.jpg': 'Pack A' }), { timeout: SETTLE_MS });
    rerender({ version: 1 });
    await waitFor(() => expect(result.current.mapping).toEqual({ 'b.jpg': 'Pack B' }), { timeout: SETTLE_MS });
  });

  it('updates mapping after merge()', async () => {
    getPackMappingMock.mockResolvedValueOnce(null);
    mergePacksMock.mockResolvedValueOnce({ 'a.jpg': 'Merged Pack' });
    const { result } = renderHook(() => usePackMapping());
    await act(async () => {
      await result.current.merge(['Pack A', 'Pack B'], 'Merged Pack');
    });
    expect(mergePacksMock).toHaveBeenCalledWith({ sourcePacks: ['Pack A', 'Pack B'], targetName: 'Merged Pack' });
    expect(result.current.mapping).toEqual({ 'a.jpg': 'Merged Pack' });
    expect(result.current.error).toBeNull();
  });

  it('stores merge error without clobbering existing mapping', async () => {
    getPackMappingMock.mockResolvedValueOnce({ 'a.jpg': 'Pack A' });
    mergePacksMock.mockRejectedValueOnce(new Error('merge failed'));
    const { result } = renderHook(() => usePackMapping());
    await waitFor(() => expect(result.current.mapping).toEqual({ 'a.jpg': 'Pack A' }), { timeout: SETTLE_MS });
    await act(async () => {
      await result.current.merge(['Pack A'], 'Pack B');
    });
    expect(result.current.mapping).toEqual({ 'a.jpg': 'Pack A' });
    expect(result.current.error).toBe('merge failed');
  });
});
