/** @vitest-environment happy-dom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapSummary, SearchParams } from '@dm-tool/shared/types';

// vi.hoisted lifts the mock fn above the vi.mock factory (itself hoisted
// above all imports). Supported pattern for a single spy shared between
// the test and the mocked module.
const { searchMapsMock } = vi.hoisted(() => ({ searchMapsMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { searchMaps: searchMapsMock },
}));

import { useMapSearch } from './useMaps';

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

beforeEach(() => {
  searchMapsMock.mockReset();
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
