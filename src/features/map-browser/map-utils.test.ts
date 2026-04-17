import { describe, expect, it } from 'vitest';
import { dedupGridVariants, findGridCounterpart, tokenizeForMatch } from './map-utils';
import type { MapSummary } from '@shared/types';

// Minimal MapSummary factory — keeps the tests terse by defaulting
// everything except the fields each test actually cares about.
function mkMap(partial: Partial<MapSummary> & { fileName: string }): MapSummary {
  return {
    title: partial.fileName,
    description: '',
    interiorExterior: null,
    timeOfDay: null,
    gridVisible: null,
    gridCells: null,
    approxPartyScale: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// tokenizeForMatch
// ---------------------------------------------------------------------------

describe('tokenizeForMatch', () => {
  it('splits a filename on _, -, and whitespace into lowercase tokens', () => {
    expect(tokenizeForMatch('Alchemists_Lab-Day Night.jpg')).toEqual(new Set(['alchemists', 'lab', 'day', 'night']));
  });

  it('strips the file extension', () => {
    expect(tokenizeForMatch('Castle.png')).toEqual(new Set(['castle']));
  });

  it('removes grid-related tokens (grid/gridded/gridless/gridlines/gl/g)', () => {
    const tokens = tokenizeForMatch('GL_Castle_Gridded_Day.jpg');
    expect(tokens).toEqual(new Set(['castle', 'day']));
    expect(tokens.has('gridded')).toBe(false);
    expect(tokens.has('gl')).toBe(false);
  });

  it('ignores empty tokens from consecutive separators', () => {
    expect(tokenizeForMatch('Castle__Day.jpg')).toEqual(new Set(['castle', 'day']));
  });
});

// ---------------------------------------------------------------------------
// findGridCounterpart
// ---------------------------------------------------------------------------

describe('findGridCounterpart', () => {
  it('returns null when the detail is missing', () => {
    expect(findGridCounterpart(null, [mkMap({ fileName: 'a.jpg', gridVisible: 'gridless' })])).toBeNull();
  });

  it('returns null when the variant list is null', () => {
    expect(findGridCounterpart({ fileName: 'a.jpg', gridVisible: 'gridded' }, null)).toBeNull();
  });

  it('returns null when there are fewer than 2 variants', () => {
    expect(
      findGridCounterpart({ fileName: 'a.jpg', gridVisible: 'gridded' }, [
        mkMap({ fileName: 'a.jpg', gridVisible: 'gridded' }),
      ]),
    ).toBeNull();
  });

  it('returns null when the current map has an unknown grid state', () => {
    const variants = [
      mkMap({ fileName: 'a.jpg', gridVisible: null }),
      mkMap({ fileName: 'b.jpg', gridVisible: 'gridded' }),
    ];
    expect(findGridCounterpart({ fileName: 'a.jpg', gridVisible: null }, variants)).toBeNull();
  });

  it('returns null when no variant has the opposite grid state', () => {
    const variants = [
      mkMap({ fileName: 'a.jpg', gridVisible: 'gridded' }),
      mkMap({ fileName: 'b.jpg', gridVisible: 'gridded' }),
    ];
    expect(findGridCounterpart({ fileName: 'a.jpg', gridVisible: 'gridded' }, variants)).toBeNull();
  });

  it('returns the lone opposite-grid candidate when only one exists', () => {
    const gridless = mkMap({ fileName: 'a_day.jpg', gridVisible: 'gridless' });
    const variants = [mkMap({ fileName: 'a_day_grid.jpg', gridVisible: 'gridded' }), gridless];
    expect(findGridCounterpart({ fileName: 'a_day_grid.jpg', gridVisible: 'gridded' }, variants)).toBe(gridless);
  });

  it('picks the candidate with the highest token overlap when multiple exist', () => {
    // Current map: day variant, gridded. Two gridless candidates — pick
    // the one that shares more tokens (also "day").
    const dayGridless = mkMap({ fileName: 'castle_day.jpg', gridVisible: 'gridless' });
    const nightGridless = mkMap({ fileName: 'castle_night.jpg', gridVisible: 'gridless' });
    const variants = [
      mkMap({ fileName: 'castle_day_grid.jpg', gridVisible: 'gridded' }),
      dayGridless,
      nightGridless,
    ];
    expect(findGridCounterpart({ fileName: 'castle_day_grid.jpg', gridVisible: 'gridded' }, variants)).toBe(
      dayGridless,
    );
  });
});

// ---------------------------------------------------------------------------
// dedupGridVariants
// ---------------------------------------------------------------------------

describe('dedupGridVariants', () => {
  it('returns null for a null input', () => {
    expect(dedupGridVariants(null, null, null)).toBeNull();
  });

  it('leaves an unpaired map unchanged', () => {
    const v = [mkMap({ fileName: 'solo.jpg', gridVisible: 'gridded' })];
    expect(dedupGridVariants(v, null, 'gridded')).toEqual(v);
  });

  it('collapses a gridded/gridless pair into a single entry', () => {
    const gridded = mkMap({ fileName: 'a_grid.jpg', gridVisible: 'gridded' });
    const gridless = mkMap({ fileName: 'a_gridless.jpg', gridVisible: 'gridless' });
    const result = dedupGridVariants([gridded, gridless], null, 'gridded');
    expect(result).toHaveLength(1);
  });

  it('pins the active file as its cluster representative even when another grid state exists', () => {
    const gridded = mkMap({ fileName: 'a_grid.jpg', gridVisible: 'gridded' });
    const gridless = mkMap({ fileName: 'a_gridless.jpg', gridVisible: 'gridless' });
    const result = dedupGridVariants([gridded, gridless], gridless.fileName, 'gridded');
    expect(result).toEqual([gridless]);
  });

  it('prefers the active grid state for inactive clusters', () => {
    const aGridded = mkMap({ fileName: 'a_grid.jpg', gridVisible: 'gridded' });
    const aGridless = mkMap({ fileName: 'a_gridless.jpg', gridVisible: 'gridless' });
    const bGridded = mkMap({ fileName: 'b_grid.jpg', gridVisible: 'gridded' });
    const bGridless = mkMap({ fileName: 'b_gridless.jpg', gridVisible: 'gridless' });
    // User is viewing aGridless — cluster B should expose its gridless variant.
    const result = dedupGridVariants([aGridded, aGridless, bGridded, bGridless], aGridless.fileName, 'gridless');
    const names = result!.map((m) => m.fileName);
    expect(names).toContain(aGridless.fileName);
    expect(names).toContain(bGridless.fileName);
    expect(names).not.toContain(bGridded.fileName);
  });

  it('falls back to gridded when no member in a cluster matches the preferred grid state', () => {
    // Cluster contains a gridded member and one with unknown grid state;
    // preferred is gridless (which nobody has). Expect gridded winner via
    // the middle fallback branch.
    const gridded = mkMap({ fileName: 'a.jpg', gridVisible: 'gridded' });
    const unknown = mkMap({ fileName: 'a.jpg', gridVisible: null });
    const result = dedupGridVariants([gridded, unknown], null, 'gridless');
    expect(result).toHaveLength(1);
    expect(result![0].gridVisible).toBe('gridded');
  });

  it('preserves the input order of clusters', () => {
    const a = mkMap({ fileName: 'a_grid.jpg', gridVisible: 'gridded' });
    const aAlt = mkMap({ fileName: 'a_gridless.jpg', gridVisible: 'gridless' });
    const b = mkMap({ fileName: 'b.jpg', gridVisible: 'gridded' });
    const result = dedupGridVariants([a, aAlt, b], null, 'gridded');
    // Cluster `a` first (representative=a), then `b`.
    expect(result!.map((m) => m.fileName)).toEqual([a.fileName, b.fileName]);
  });
});
