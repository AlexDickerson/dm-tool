import { describe, expect, it } from 'vitest';
import { groupByStem, mapStem } from './map-stem';

// ---------------------------------------------------------------------------
// mapStem — pure stem extraction
// ---------------------------------------------------------------------------

describe('mapStem — Czepeku path', () => {
  it('strips the GL_ prefix and uses the first token as the stem', () => {
    expect(mapStem('GL_GroundedCastle_EngineRoom_Day_Snow.jpg')).toBe('groundedcastle');
  });

  it('strips the G_ prefix and uses the first token as the stem', () => {
    expect(mapStem('G_GroundedCastle_ServantsQuarters_Night.jpg')).toBe('groundedcastle');
  });

  it('normalises the extracted stem to lowercase', () => {
    expect(mapStem('GL_MixedCase.jpg')).toBe('mixedcase');
  });

  it('does NOT treat G_ as a prefix when the next character is lowercase or absent', () => {
    // `Grimoire_Keep_Day` starts with G but not G_, so it goes through the
    // first-variant path.
    expect(mapStem('Grimoire_Keep_Day.jpg')).toBe('grimoire keep');
  });
});

describe('mapStem — first-variant split', () => {
  it('takes all tokens before the first variant word', () => {
    expect(mapStem('Alchemists_Lab_Dark_Propless_Gridless.jpg')).toBe('alchemists lab');
  });

  it('is tolerant of variant words in any order', () => {
    expect(mapStem('Burn_City_grid_night_no_roof_fire_smoak.jpg')).toBe('burn city');
  });

  it('strips grid dimensions like 30x38 before stemming', () => {
    expect(mapStem('Ancient_Temple_Day_Fall_Blue_Grid_30x38.png')).toBe('ancient temple');
  });

  it('strips grid dimensions with spaces around the x', () => {
    expect(mapStem('Ancient_Temple 30 x 38.png')).toBe('ancient temple');
  });

  it('strips a dedup suffix like " (2)"', () => {
    expect(mapStem('Ancient_Temple (2).png')).toBe('ancient temple');
  });

  it('treats a numeric-suffixed variant word as a variant (e.g. "Night2")', () => {
    expect(mapStem('Castle_Night2.jpg')).toBe('castle');
  });

  it('treats a pure-digit token as a variant', () => {
    expect(mapStem('Castle_3.jpg')).toBe('castle');
  });

  it('treats v1/v2/v3 tokens as variants', () => {
    expect(mapStem('Castle_v2.jpg')).toBe('castle');
  });

  it('breaks on "no <noun>" (variant signal: noun absent)', () => {
    expect(mapStem('Church_no_bridge.jpg')).toBe('church');
  });

  it('breaks on "with <noun>" (variant signal: noun present)', () => {
    expect(mapStem('Tavern_with_props.jpg')).toBe('tavern');
  });

  it('breaks on "without <noun>" (variant signal: noun absent)', () => {
    expect(mapStem('Castle_without_grid.jpg')).toBe('castle');
  });

  it('falls back to the first token when every token is a variant', () => {
    expect(mapStem('Day_Night.jpg')).toBe('day');
  });

  it('returns the whole filename as the stem when no variant word is present', () => {
    expect(mapStem('Neverwinter.jpg')).toBe('neverwinter');
  });

  it('returns an empty string for pathological inputs (the extension-strip consumes everything)', () => {
    // `.gitkeep` matches /\.[a-zA-Z0-9]+$/ so normalize strips the whole
    // string. The function documents that callers should filter empty
    // stems out of grouping — groupByStem handles this by falling back
    // to the filename.
    expect(mapStem('.gitkeep')).toBe('');
  });
});

describe('mapStem — known-stem overrides', () => {
  it('collapses qualifier-prefixed files into the curated stem', () => {
    // `vampire manor` is in KNOWN_STEMS — qualifiers before it should be
    // absorbed even though they are not variant tokens.
    expect(mapStem('Old_Vampire_Manor_Day.jpg')).toBe('vampire manor');
    expect(mapStem('Vampire_Manor_Night.jpg')).toBe('vampire manor');
  });

  it('only matches KNOWN_STEMS on whole-word boundaries', () => {
    // `vampiremanorsmith` has no space boundary around "vampire manor"
    // once tokenised, so it should not match.
    expect(mapStem('Vampiremanorsmith.jpg')).toBe('vampiremanorsmith');
  });
});

// ---------------------------------------------------------------------------
// groupByStem — bucketing + suffix-merge
// ---------------------------------------------------------------------------

describe('groupByStem', () => {
  const file = (fileName: string) => ({ fileName });

  it('buckets files that share a stem into one group', () => {
    const groups = groupByStem([
      file('Alchemists_Lab_Day.jpg'),
      file('Alchemists_Lab_Night.jpg'),
      file('Throne_Room_Day.jpg'),
    ]);
    expect(groups).toHaveLength(2);
    const alchemists = groups.find((g) => g.stem === 'alchemists lab');
    expect(alchemists?.variants).toHaveLength(2);
  });

  it('preserves input order when choosing the representative', () => {
    const a = file('Alchemists_Lab_Night.jpg');
    const b = file('Alchemists_Lab_Day.jpg');
    const groups = groupByStem([a, b]);
    expect(groups[0].representative).toBe(a);
  });

  it('sorts variants within a group alphabetically by filename', () => {
    const night = file('Alchemists_Lab_Night.jpg');
    const day = file('Alchemists_Lab_Day.jpg');
    const groups = groupByStem([night, day]);
    expect(groups[0].variants.map((v) => v.fileName)).toEqual([day.fileName, night.fileName]);
  });

  it('merges a qualifier-prefixed stem into its shorter suffix (multi-word only)', () => {
    // `plains mead hall` should absorb into `mead hall` because the longer
    // stem is a suffix-match of the shorter one.
    const groups = groupByStem([
      file('Mead_Hall_Day.jpg'),
      file('Mead_Hall_Night.jpg'),
      file('Plains_Mead_Hall_Day.jpg'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].stem).toBe('mead hall');
    expect(groups[0].variants).toHaveLength(3);
  });

  it('does NOT absorb single-word stems as suffixes (would create magnets)', () => {
    // `castle` is single word — Goblin_Castle_* must not collapse into
    // a hypothetical standalone `castle` bucket.
    const groups = groupByStem([file('Castle_Day.jpg'), file('Goblin_Castle_Day.jpg')]);
    expect(groups).toHaveLength(2);
  });

  it('walks the longest suffix first so chains resolve in a single pass', () => {
    // `cold plains mead hall` → `plains mead hall` → `mead hall`
    const groups = groupByStem([
      file('Mead_Hall_Day.jpg'),
      file('Plains_Mead_Hall_Day.jpg'),
      file('Cold_Plains_Mead_Hall_Day.jpg'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].stem).toBe('mead hall');
    expect(groups[0].variants).toHaveLength(3);
  });

  it('falls back to the filename (lowercased) when the stem is empty', () => {
    // mapStem('.gitkeep') returns '' — groupByStem's `|| m.fileName.toLowerCase()`
    // fallback kicks in so we still produce a group with a sensible key.
    const groups = groupByStem([{ fileName: '.gitkeep' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].stem).toBe('.gitkeep');
  });
});
