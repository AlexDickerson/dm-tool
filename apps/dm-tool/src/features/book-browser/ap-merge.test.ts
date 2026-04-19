import { describe, expect, it } from 'vitest';
import { apTotalPages, groupAdventurePaths, parseApPart, partSubtitle } from './ap-merge';
import type { Book } from '@dm-tool/shared/types';

function mkBook(partial: Partial<Book> & { id: number; title: string }): Book {
  return {
    category: 'Adventure Paths',
    subcategory: null,
    ruleset: null,
    pageCount: null,
    fileSize: 0,
    ingested: true,
    aiSystem: null,
    aiCategory: null,
    aiSubcategory: null,
    aiTitle: null,
    aiPublisher: null,
    classified: false,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// parseApPart
// ---------------------------------------------------------------------------

describe('parseApPart', () => {
  it('matches the full "Part N of M" form', () => {
    const book = mkBook({ id: 1, title: 'Abomination Vaults AP - Part 1 of 3 - Ruins of Gauntlight' });
    expect(parseApPart(book)).toEqual({ book, partNumber: 1, totalParts: 3 });
  });

  it('matches the short "N of M" form (no "Part" prefix)', () => {
    const book = mkBook({ id: 2, title: 'Outlaws of Alkenstar AP - 1 of 3 - Punks in a Powderkeg' });
    expect(parseApPart(book)?.partNumber).toBe(1);
    expect(parseApPart(book)?.totalParts).toBe(3);
  });

  it('is case-insensitive on the word "Part"', () => {
    const book = mkBook({ id: 3, title: 'Foo - part 2 of 6 - Bar' });
    expect(parseApPart(book)?.partNumber).toBe(2);
  });

  it('returns null when the title has no N of M pattern', () => {
    expect(parseApPart(mkBook({ id: 4, title: "Player's Guide" }))).toBeNull();
  });

  it('picks the first match when multiple candidates exist', () => {
    // Matches "1 of 3" first; ignores any later number patterns.
    const book = mkBook({ id: 5, title: 'AP 1 of 3 - Year 2015' });
    expect(parseApPart(book)?.partNumber).toBe(1);
    expect(parseApPart(book)?.totalParts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// groupAdventurePaths
// ---------------------------------------------------------------------------

describe('groupAdventurePaths', () => {
  it('routes books outside "Adventure Paths" into otherBooks', () => {
    const rulebook = mkBook({ id: 1, title: 'Core Rulebook', category: 'Rulebooks', subcategory: null });
    const { apGroups, otherBooks } = groupAdventurePaths([rulebook]);
    expect(apGroups).toEqual([]);
    expect(otherBooks).toEqual([rulebook]);
  });

  it('routes books with no subcategory into otherBooks', () => {
    const orphan = mkBook({ id: 1, title: 'Orphan', category: 'Adventure Paths', subcategory: null });
    const { apGroups, otherBooks } = groupAdventurePaths([orphan]);
    expect(apGroups).toEqual([]);
    expect(otherBooks).toEqual([orphan]);
  });

  it('groups parts of the same AP and sorts them by partNumber', () => {
    const books = [
      mkBook({ id: 2, title: 'AV AP - 2 of 3 - Part Two', subcategory: 'Abomination Vaults' }),
      mkBook({ id: 1, title: 'AV AP - 1 of 3 - Part One', subcategory: 'Abomination Vaults' }),
      mkBook({ id: 3, title: 'AV AP - 3 of 3 - Part Three', subcategory: 'Abomination Vaults' }),
    ];
    const { apGroups } = groupAdventurePaths(books);
    expect(apGroups).toHaveLength(1);
    expect(apGroups[0].parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });

  it('collects un-numbered AP books as supplements alongside the parts', () => {
    const books = [
      mkBook({ id: 1, title: 'AV - 1 of 3 - One', subcategory: 'Abomination Vaults' }),
      mkBook({ id: 2, title: "Player's Guide", subcategory: 'Abomination Vaults' }),
    ];
    const { apGroups } = groupAdventurePaths(books);
    expect(apGroups).toHaveLength(1);
    expect(apGroups[0].parts).toHaveLength(1);
    expect(apGroups[0].supplements.map((b) => b.id)).toEqual([2]);
  });

  it('sorts apGroups alphabetically by subcategory', () => {
    const books = [
      mkBook({ id: 1, title: 'Zephyr Winds AP - 1 of 3 - One', subcategory: 'Zephyr Winds' }),
      mkBook({ id: 2, title: 'Abomination Vaults AP - 1 of 3 - One', subcategory: 'Abomination Vaults' }),
    ];
    const { apGroups } = groupAdventurePaths(books);
    expect(apGroups.map((g) => g.subcategory)).toEqual(['Abomination Vaults', 'Zephyr Winds']);
  });
});

// ---------------------------------------------------------------------------
// apTotalPages
// ---------------------------------------------------------------------------

describe('apTotalPages', () => {
  const build = (pages: (number | null)[]) => ({
    subcategory: 'Test AP',
    parts: pages.map((p, i) => ({
      book: mkBook({ id: i + 1, title: `P${i + 1}`, pageCount: p }),
      partNumber: i + 1,
      totalParts: pages.length,
    })),
    supplements: [],
  });

  it('sums the page counts across all parts', () => {
    expect(apTotalPages(build([100, 120, 140]))).toBe(360);
  });

  it('returns null when any part has no page count (un-ingested)', () => {
    expect(apTotalPages(build([100, null, 140]))).toBeNull();
  });

  it('returns 0 for an AP with no parts', () => {
    expect(apTotalPages({ subcategory: 'Empty', parts: [], supplements: [] })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// partSubtitle
// ---------------------------------------------------------------------------

describe('partSubtitle', () => {
  it('extracts the subtitle after "Part N of M -"', () => {
    expect(partSubtitle('Abomination Vaults AP - Part 1 of 3 - Ruins of Gauntlight')).toBe('Ruins of Gauntlight');
  });

  it('works without the "Part" prefix', () => {
    expect(partSubtitle('Outlaws of Alkenstar AP - 1 of 3 - Punks in a Powderkeg')).toBe('Punks in a Powderkeg');
  });

  it('works when the separator is omitted (just whitespace after N of M)', () => {
    expect(partSubtitle('Quest for the Frozen Flame AP - 1 of 3 Broken Tusk Moon')).toBe('Broken Tusk Moon');
  });

  it('handles en-dash / em-dash separators', () => {
    expect(partSubtitle('X – 2 of 3 – Y')).toBe('Y');
    expect(partSubtitle('X — 2 of 3 — Y')).toBe('Y');
  });

  it('returns the original title when no N of M is present', () => {
    expect(partSubtitle("Player's Guide")).toBe("Player's Guide");
  });

  it('returns the original title when the subtitle after "N of M" is empty', () => {
    expect(partSubtitle('AP - 1 of 3 -')).toBe('AP - 1 of 3 -');
  });
});
