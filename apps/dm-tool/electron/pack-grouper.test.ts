import { beforeEach, describe, expect, it, vi } from 'vitest';

// pack-grouper.ts delegates persistence to pf2e-db, which wraps
// better-sqlite3. The native addon is built against Electron's Node ABI
// and can't load under the host Node that vitest runs in. Replace the
// five pf2e-db exports pack-grouper uses with an in-memory Map so tests
// exercise the real parsing/merge logic without touching SQLite.
vi.mock('./pf2e-db', () => {
  let store = new Map<string, string>();
  return {
    hasPackMappings: () => store.size > 0,
    listPackMappings: () => Object.fromEntries(store.entries()),
    replacePackMappings: (mapping: Record<string, string>) => {
      store = new Map(Object.entries(mapping));
    },
    upsertPackMapping: (fileName: string, packName: string) => {
      store.set(fileName, packName);
    },
    renamePackMappings: (sourcePacks: string[], targetName: string) => {
      const sources = new Set(sourcePacks);
      for (const [fn, pack] of store.entries()) {
        if (sources.has(pack)) store.set(fn, targetName);
      }
    },
    // Test-only reset hook — lets us start each case with an empty store.
    __reset: () => {
      store = new Map();
    },
  };
});

// Import AFTER the mock is registered so pack-grouper binds to the stubs.
const { buildGroupingPrompt, getCachedPackMapping, mergePacks, parseAndCacheMapping } = await import('./pack-grouper');
const { __reset } = (await import('./pf2e-db')) as unknown as { __reset: () => void };

beforeEach(() => {
  __reset();
});

// ---------------------------------------------------------------------------
// buildGroupingPrompt — pure string template
// ---------------------------------------------------------------------------

describe('buildGroupingPrompt', () => {
  it('includes the file count in the introduction', () => {
    const prompt = buildGroupingPrompt(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(prompt).toMatch(/Below is a list of 3 battlemap image filenames/);
  });

  it('quotes each filename with two-space indentation on its own line', () => {
    const prompt = buildGroupingPrompt(['a.jpg', 'b.png']);
    expect(prompt).toContain('  "a.jpg"');
    expect(prompt).toContain('  "b.png"');
  });

  it('handles an empty list without throwing', () => {
    expect(() => buildGroupingPrompt([])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseAndCacheMapping
// ---------------------------------------------------------------------------

describe('parseAndCacheMapping', () => {
  const fileNames = ['castle_day.jpg', 'castle_night.jpg', 'tavern.jpg'];

  it('parses a plain JSON object and returns the trimmed mapping', () => {
    const raw = JSON.stringify({
      'castle_day.jpg': 'Castle',
      'castle_night.jpg': 'Castle',
      'tavern.jpg': 'Tavern',
    });
    const mapping = parseAndCacheMapping(raw, fileNames);
    expect(mapping).toEqual({
      'castle_day.jpg': 'Castle',
      'castle_night.jpg': 'Castle',
      'tavern.jpg': 'Tavern',
    });
  });

  it('strips a ```json ... ``` code fence before parsing', () => {
    const raw = '```json\n{"castle_day.jpg":"Castle","castle_night.jpg":"Castle","tavern.jpg":"Tavern"}\n```';
    const mapping = parseAndCacheMapping(raw, fileNames);
    expect(mapping['castle_day.jpg']).toBe('Castle');
  });

  it('strips a bare ``` ... ``` code fence too', () => {
    const raw = '```\n{"castle_day.jpg":"Castle","castle_night.jpg":"Castle","tavern.jpg":"Tavern"}\n```';
    const mapping = parseAndCacheMapping(raw, fileNames);
    expect(mapping['castle_day.jpg']).toBe('Castle');
  });

  it('trims whitespace on both ends of a pack name', () => {
    const raw = JSON.stringify({
      'castle_day.jpg': '  Castle  ',
      'castle_night.jpg': 'Castle',
      'tavern.jpg': 'Tavern',
    });
    const mapping = parseAndCacheMapping(raw, fileNames);
    expect(mapping['castle_day.jpg']).toBe('Castle');
  });

  it('fills missing filenames as singletons (filename without extension)', () => {
    const raw = JSON.stringify({ 'castle_day.jpg': 'Castle' });
    const mapping = parseAndCacheMapping(raw, fileNames);
    expect(mapping['castle_day.jpg']).toBe('Castle');
    expect(mapping['castle_night.jpg']).toBe('castle_night');
    expect(mapping['tavern.jpg']).toBe('tavern');
  });

  it('treats empty strings as missing (singleton fallback)', () => {
    const raw = JSON.stringify({
      'castle_day.jpg': '',
      'castle_night.jpg': '   ',
      'tavern.jpg': 'Tavern',
    });
    const mapping = parseAndCacheMapping(raw, fileNames);
    expect(mapping['castle_day.jpg']).toBe('castle_day');
    expect(mapping['castle_night.jpg']).toBe('castle_night');
    expect(mapping['tavern.jpg']).toBe('Tavern');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseAndCacheMapping('{not json', fileNames)).toThrow(/Invalid JSON/);
  });

  it('throws when the parsed value is not an object', () => {
    expect(() => parseAndCacheMapping('[]', fileNames)).toThrow(/Expected a JSON object/);
    expect(() => parseAndCacheMapping('"string"', fileNames)).toThrow(/Expected a JSON object/);
  });

  it('persists the result and getCachedPackMapping reads it back', () => {
    const raw = JSON.stringify({
      'castle_day.jpg': 'Castle',
      'castle_night.jpg': 'Castle',
      'tavern.jpg': 'Tavern',
    });
    parseAndCacheMapping(raw, fileNames);

    const roundTrip = getCachedPackMapping(fileNames);
    expect(roundTrip).toEqual({
      'castle_day.jpg': 'Castle',
      'castle_night.jpg': 'Castle',
      'tavern.jpg': 'Tavern',
    });
  });
});

// ---------------------------------------------------------------------------
// getCachedPackMapping
// ---------------------------------------------------------------------------

describe('getCachedPackMapping', () => {
  it('returns null when no mapping has ever been saved', () => {
    expect(getCachedPackMapping(['a.jpg'])).toBeNull();
  });

  it('returns the cached mapping unchanged when the library is the same', () => {
    const files = ['a.jpg', 'b.jpg'];
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A', 'b.jpg': 'Pack B' }), files);
    expect(getCachedPackMapping(files)).toEqual({ 'a.jpg': 'Pack A', 'b.jpg': 'Pack B' });
  });

  it('augments the mapping via the stem heuristic when new files appear', () => {
    const initial = ['a.jpg'];
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A' }), initial);

    const next = ['a.jpg', 'Castle_Day.jpg'];
    const mapping = getCachedPackMapping(next);
    expect(mapping).not.toBeNull();
    expect(mapping!['a.jpg']).toBe('Pack A'); // preserved
    expect(mapping!['Castle_Day.jpg']).toBeDefined(); // filled in
  });

  it('excludes entries for files that have been removed from the library', () => {
    const initial = ['a.jpg', 'b.jpg'];
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A', 'b.jpg': 'Pack B' }), initial);

    const next = ['a.jpg'];
    const mapping = getCachedPackMapping(next);
    expect(mapping).toEqual({ 'a.jpg': 'Pack A' });
    expect(mapping!['b.jpg']).toBeUndefined();
  });

  it('persists the augmented mapping so the next call is idempotent', () => {
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A' }), ['a.jpg']);

    const next = ['a.jpg', 'b.jpg'];
    const first = getCachedPackMapping(next);
    const second = getCachedPackMapping(next);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// mergePacks
// ---------------------------------------------------------------------------

describe('mergePacks', () => {
  it('reassigns every file under any source pack to the target pack', () => {
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A', 'b.jpg': 'Pack B', 'c.jpg': 'Pack C' }), [
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ]);
    const result = mergePacks(['Pack A', 'Pack B'], 'Pack AB', ['a.jpg', 'b.jpg', 'c.jpg']);
    expect(result).toEqual({
      'a.jpg': 'Pack AB',
      'b.jpg': 'Pack AB',
      'c.jpg': 'Pack C',
    });
  });

  it('leaves unrelated packs untouched', () => {
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Alpha', 'b.jpg': 'Beta' }), ['a.jpg', 'b.jpg']);
    const result = mergePacks(['Alpha'], 'AlphaRenamed', ['a.jpg', 'b.jpg']);
    expect(result).toEqual({ 'a.jpg': 'AlphaRenamed', 'b.jpg': 'Beta' });
  });

  it('bootstraps from the stem heuristic when no cache exists', () => {
    const fileNames = ['Castle_Day.jpg', 'Castle_Night.jpg', 'Tavern.jpg'];
    const result = mergePacks(['castle'], 'Grand Castle', fileNames);
    expect(result['Castle_Day.jpg']).toBe('Grand Castle');
    expect(result['Castle_Night.jpg']).toBe('Grand Castle');
    expect(result['Tavern.jpg']).toBe('tavern');
  });

  it('persists the merge so subsequent getCachedPackMapping reflects it', () => {
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'A', 'b.jpg': 'B' }), ['a.jpg', 'b.jpg']);
    mergePacks(['A', 'B'], 'Merged', ['a.jpg', 'b.jpg']);
    expect(getCachedPackMapping(['a.jpg', 'b.jpg'])).toEqual({ 'a.jpg': 'Merged', 'b.jpg': 'Merged' });
  });
});
