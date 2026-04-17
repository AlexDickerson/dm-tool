import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The module under test calls `app.getPath('userData')` to decide where
// to cache the pack mapping. We stub that module to point at a fresh
// temp directory per test so the real fs I/O runs in isolation.
let userDataDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return userDataDir;
      throw new Error(`unexpected getPath(${key})`);
    },
  },
}));

// Import AFTER the mock registration so the module reads the stub.
const { buildGroupingPrompt, getCachedPackMapping, mergePacks, parseAndCacheMapping } = await import('./pack-grouper');

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'dmtool-packtest-'));
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
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
    expect(mapping['tavern.jpg']).toBe('Tavern');
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

  it('persists the result to disk and getCachedPackMapping reads it back', () => {
    const raw = JSON.stringify({
      'castle_day.jpg': 'Castle',
      'castle_night.jpg': 'Castle',
      'tavern.jpg': 'Tavern',
    });
    parseAndCacheMapping(raw, fileNames);

    expect(existsSync(join(userDataDir, 'pack-mapping.json'))).toBe(true);

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
  it('returns null when no cache file exists', () => {
    expect(getCachedPackMapping(['a.jpg'])).toBeNull();
  });

  it('returns the cached mapping unchanged when the file list hash matches', () => {
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

  it('prunes entries for files that have been removed', () => {
    const initial = ['a.jpg', 'b.jpg'];
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A', 'b.jpg': 'Pack B' }), initial);

    const next = ['a.jpg'];
    const mapping = getCachedPackMapping(next);
    expect(mapping).toEqual({ 'a.jpg': 'Pack A' });
    expect(mapping!['b.jpg']).toBeUndefined();
  });

  it('persists the augmented mapping so the next call matches by hash', () => {
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A' }), ['a.jpg']);

    const next = ['a.jpg', 'b.jpg'];
    const first = getCachedPackMapping(next);
    const second = getCachedPackMapping(next); // same list → hash matches
    expect(second).toEqual(first);
  });

  it('returns null when the cache file is corrupt', () => {
    // Write a valid cache then corrupt it.
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'Pack A' }), ['a.jpg']);
    const path = join(userDataDir, 'pack-mapping.json');
    writeFileSync(path, '{ not valid json', 'utf-8');
    expect(getCachedPackMapping(['a.jpg'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergePacks
// ---------------------------------------------------------------------------

describe('mergePacks', () => {
  it('reassigns every file under any source pack to the target pack', () => {
    parseAndCacheMapping(
      JSON.stringify({ 'a.jpg': 'Pack A', 'b.jpg': 'Pack B', 'c.jpg': 'Pack C' }),
      ['a.jpg', 'b.jpg', 'c.jpg'],
    );
    const result = mergePacks(['Pack A', 'Pack B'], 'Pack AB', ['a.jpg', 'b.jpg', 'c.jpg']);
    expect(result).toEqual({
      'a.jpg': 'Pack AB',
      'b.jpg': 'Pack AB',
      'c.jpg': 'Pack C',
    });
  });

  it('leaves unrelated packs untouched', () => {
    parseAndCacheMapping(
      JSON.stringify({ 'a.jpg': 'Alpha', 'b.jpg': 'Beta' }),
      ['a.jpg', 'b.jpg'],
    );
    const result = mergePacks(['Alpha'], 'AlphaRenamed', ['a.jpg', 'b.jpg']);
    expect(result).toEqual({ 'a.jpg': 'AlphaRenamed', 'b.jpg': 'Beta' });
  });

  it('bootstraps from the stem heuristic when no cache exists', () => {
    // No prior parseAndCacheMapping — mergePacks must still work.
    const fileNames = ['Castle_Day.jpg', 'Castle_Night.jpg', 'Tavern.jpg'];
    const result = mergePacks(['castle'], 'Grand Castle', fileNames);
    expect(result['Castle_Day.jpg']).toBe('Grand Castle');
    expect(result['Castle_Night.jpg']).toBe('Grand Castle');
    expect(result['Tavern.jpg']).toBe('tavern'); // untouched stem
  });

  it('persists the merge so subsequent getCachedPackMapping reflects it', () => {
    parseAndCacheMapping(JSON.stringify({ 'a.jpg': 'A', 'b.jpg': 'B' }), ['a.jpg', 'b.jpg']);
    mergePacks(['A', 'B'], 'Merged', ['a.jpg', 'b.jpg']);
    expect(getCachedPackMapping(['a.jpg', 'b.jpg'])).toEqual({ 'a.jpg': 'Merged', 'b.jpg': 'Merged' });
  });
});
