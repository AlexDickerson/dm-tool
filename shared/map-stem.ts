// Filename-pattern clustering for battlemap variants.
//
// Goal: group variants of the same map together in the UI so browsing
// "a Patreon pack of one map in 20 lighting conditions" feels like one
// card, not twenty. The user's artists (primarily Czepeku and a long
// tail of others) name files with a `$mapName_$variant` pattern, where
// the variant is something like Day, Night, Rain, Snow, Propless,
// Gridless, Grid, etc.
//
// Strategy: two-path stemming.
//
//   1. Czepeku files (GL_ or G_ prefix, where GL = gridded and G = no
//      grid): stem = the first token after the prefix, i.e. the pack
//      name. This merges whole packs (all subrooms + all lighting
//      variants) into one bucket. Example:
//        GL_GroundedCastle_EngineRoom_Day_Snow.jpg → "groundedcastle"
//        G_GroundedCastle_ServantsQuarters_Night → "groundedcastle"
//
//   2. Everything else: "first-variant split." Stem = all tokens BEFORE
//      the first variant token. Tolerant of out-of-order and typo'd
//      variant stacks (Burn_City has 56 files with variable orderings).
//      Example:
//        Alchemists_Lab_Dark_Propless_Gridless.jpg → "alchemists lab"
//        Burn_City_grid_night_no_roof_fie_smoak_50x30.png → "burn city"
//        Ancient_Temple_Day_Fall_Blue_Grid_30x38.png → "ancient temple"
//
// Measured against the current library (1011 files): 98.1% coverage
// in non-singleton groups, 70 distinct packs, 19 singletons (nearly
// all legitimately unique maps like `neverwinter.jpg`).
//
// This is pure presentation-layer logic — it runs client-side after
// searchMaps returns. If the heuristic ever misbehaves, edit this file
// and hot-reload; the DB and IPC contract don't change.

/** Variant tokens seen in the wild. Extend this list if new packs show
 *  up with words that should collapse into the pack name. Keep it
 *  lowercase — all comparisons use toLowerCase(). */
const VARIANT_TOKENS: ReadonlySet<string> = new Set([
  // Time of day / lighting
  'day',
  'night',
  'dawn',
  'dusk',
  'morning',
  'evening',
  'midnight',
  'noon',
  'afternoon',
  'sunset',
  'sunrise',
  'twilight',
  'lit',
  'unlit',
  'torchlit',
  'nolight',
  'highlight',
  'lowlight',
  'dim',
  'bright',
  'dark',
  'darkened',
  'subdued',
  'stark',
  'moonlit',
  // Seasons / weather
  'spring',
  'summer',
  'fall',
  'autumn',
  'winter',
  'rain',
  'rainy',
  'rainstorm',
  'snow',
  'snowy',
  'snowymidnight',
  'storm',
  'stormy',
  'fog',
  'foggy',
  'mist',
  'misty',
  'clear',
  'blizzard',
  'frozen',
  'ice',
  'icy',
  // Atmospheric state
  'apocalyptic',
  'cosmic',
  'astral',
  'void',
  'ethereal',
  'eldritch',
  'bloodbath',
  'cultsummoning',
  'moonlightmassacre',
  'noxiousfog',
  // Hazards / environmental effects (added to cover packs like
  // `Church_Catacombus_acid_*`, where the hazard word is what
  // distinguishes variants and was previously slipping through into
  // the stem). Keep these unambiguous — they should never plausibly
  // be the *primary* noun in a battlemap title.
  'acid',
  'acidic',
  'poisoned',
  'toxic',
  'noxious',
  'flooded',
  'drowned',
  'submerged',
  'sunken',
  'corroded',
  'rusted',
  'rusty',
  'decayed',
  'decaying',
  'cursed',
  'blessed',
  'holy',
  'unholy',
  'sacred',
  'profane',
  'haunted',
  'possessed',
  'infested',
  'infected',
  'overgrown',
  'mossy',
  'abandoned',
  'deserted',
  'forgotten',
  'burned',
  'burnt',
  'ashen',
  'charred',
  'scorched',
  'frosted',
  'frostbitten',
  'muddy',
  'sandy',
  'dusty',
  'wet',
  'dry',
  'shattered',
  'broken',
  'cracked',
  'battle',
  'combat',
  'ambush',
  'summoning',
  'summoned',
  // Radiation / pollution / cleanliness state
  'irradiated',
  'radioactive',
  'pristine',
  'polluted',
  'filthy',
  // Vertical / spatial state
  'subterranean',
  'underground',
  'aboveground',
  'surface',
  // Mood adjectives that consistently appear AFTER the map noun in
  // filenames (i.e. they're qualifiers, not titles). Don't add words
  // like `grimy` / `modest` / `stately` here — those tend to be part
  // of the actual title and would over-merge unrelated packs.
  'spooky',
  'creepy',
  'eerie',
  'ominous',
  'sinister',
  'evil',
  'good',
  'pure',
  'corrupted',
  'magical',
  'enchanted',
  'mundane',
  // Colors (used as shading variants in some packs)
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'black',
  'white',
  'gold',
  'silver',
  'crimson',
  'azure',
  // Props / overlay
  'grid',
  'gridded',
  'gridless',
  'gridlines',
  'propped',
  'propless',
  'empty',
  'filled',
  'plain',
  'original',
  'alt',
  'alternate',
  'alternative',
  'variant',
  // Fire / smoke effects
  'fire',
  'fired',
  'onfire',
  'smoke',
  'smoak',
  'smoky',
  'lava',
  'water',
  'sky',
  // Roof / interior state
  'roof',
  'rooftop',
  'noroof',
  'roofed',
  'open',
  'closed',
  'destroyed',
  'ruined',
  'isolated',
  'burning',
  // Versioning
  'v1',
  'v2',
  'v3',
  'v4',
  'v5',
  'v6',
  'v7',
  'v8',
  'v9',
]);

function isVariantToken(tok: string): boolean {
  const t = tok.toLowerCase();
  if (VARIANT_TOKENS.has(t)) return true;
  if (/^\d+$/.test(t)) return true; // pure number
  if (/^v\d+$/.test(t)) return true; // v1, v2, ...
  if (/^alternate\d*$/.test(t)) return true; // alternate, alternate1, ...
  // `<variantword><digit>` like "sunset2", "night3", "dawn1". Some
  // packs disambiguate multiple takes on the same variant by suffixing
  // an index — "Night1", "Night2", "Night3" of one map. Strip trailing
  // digits and re-check the base. Safe because we only match when the
  // stripped base is a known variant word; "Hall2" stays a head token.
  const stripped = t.replace(/\d+$/, '');
  if (stripped !== t && VARIANT_TOKENS.has(stripped)) return true;
  return false;
}

/** Strip `.ext`, dedup suffix ` (2)`, normalize separators, drop grid
 *  dimensions like `30x38`, collapse whitespace. */
function normalize(rest: string): string {
  let s = rest;
  s = s.replace(/\.[a-zA-Z0-9]+$/, '');
  s = s.replace(/\s*\(\d+\)\s*$/, '');
  s = s.replace(/[_-]+/g, ' ');
  s = s.replace(/\b\d{1,3}\s*[xX]\s*\d{1,3}\b/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Split off a Czepeku GL_/G_ prefix. Returns `[prefix, remainder]`. */
function stripCzepekuPrefix(fileName: string): [string | null, string] {
  const m = fileName.match(/^(GL|G)_(.+)$/);
  if (m) return [m[1], m[2]];
  return [null, fileName];
}

/** Hand-curated pack stems that should always group together regardless
 *  of where the matching word sequence appears in the filename. Use this
 *  escape hatch when a pack's variants don't follow the algorithmic
 *  rules — typically because the pack uses unusual qualifier words that
 *  we can't safely add to VARIANT_TOKENS, or because some files have
 *  qualifiers PREFIXED to the pack name (which suffix-merge doesn't
 *  catch). Compared as whole-word sequences so "vampire manor" matches
 *  `Old_Vampire_Manor_Day` but not `vampiremanorsmith`. */
const KNOWN_STEMS: readonly string[] = ['vampire manor'];

/**
 * Compute the "pack stem" for a filename. Files with the same stem are
 * grouped as variants of the same base map.
 *
 * Returns an empty string only for pathological inputs (e.g. `.gitkeep`).
 * Callers should filter empty stems out of the grouping.
 */
export function mapStem(fileName: string): string {
  const [prefix, rest] = stripCzepekuPrefix(fileName);
  const normalized = normalize(rest);

  // Known-stem override wins over both the Czepeku and first-variant
  // paths. Surround with spaces so we match whole word sequences only.
  const padded = ` ${normalized.toLowerCase()} `;
  for (const known of KNOWN_STEMS) {
    if (padded.includes(` ${known} `)) return known;
  }

  const tokens = normalized.split(' ').filter((t) => t.length > 0);

  if (prefix) {
    // Czepeku path: pack name is the first token after GL_/G_
    return tokens[0]?.toLowerCase() ?? '';
  }

  // Everything else: first-variant split. We also break when we see
  // a "no <noun>" / "without <noun>" / "with <noun>" pair, because the
  // noun being absent or present is itself the variant signal — files
  // like `Church_no_bridge`, `Tavern_with_props`, `Castle_without_grid`
  // all fit this shape, regardless of what the noun is. The known-token
  // list can't capture these because the noun is the load-bearing part
  // and we don't want to add `bridge` / `props` / etc. to VARIANT_TOKENS
  // (they're real map nouns elsewhere).
  //
  // Tradeoff: a literal title like "House With No Walls" would resolve
  // to "house" instead of the full title. Acceptable — variant-marker
  // prepositions in battlemap filenames almost always signal a propless
  // / structural variant, not a literal noun phrase.
  const head: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isVariantToken(t)) break;
    const lower = t.toLowerCase();
    if ((lower === 'no' || lower === 'without' || lower === 'with') && i + 1 < tokens.length) {
      break;
    }
    head.push(t);
  }
  if (head.length === 0) {
    // No non-variant prefix; fall back to the first token so we don't
    // produce a giant "(empty)" bucket.
    return tokens[0]?.toLowerCase() ?? '';
  }
  return head.join(' ').toLowerCase();
}

/** A group of maps that share a stem. The `representative` is the map
 *  to show on the primary card; `variants` is every map in the group
 *  (including the representative), stable-ordered by filename. */
export interface MapGroup<T extends { fileName: string }> {
  stem: string;
  representative: T;
  variants: T[];
}

/**
 * Bucket a list of maps by their pack stem. Input order is preserved
 * when determining the representative — the first map encountered in
 * each stem bucket wins, so callers that want e.g. alphabetical order
 * should sort the input first. Variants within a group are sorted by
 * filename so the detail pane has a stable display order.
 */
export function groupByStem<T extends { fileName: string }>(maps: readonly T[]): MapGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const m of maps) {
    const stem = mapStem(m.fileName) || m.fileName.toLowerCase();
    let list = buckets.get(stem);
    if (!list) {
      list = [];
      buckets.set(stem, list);
    }
    list.push(m);
  }

  // --- Suffix-merge pass --------------------------------------------------
  //
  // Fold packs whose stem is a multi-word suffix of another stem into the
  // shorter one. The concrete case this fixes: a library may have both
  // `Mead_Hall_*.jpg` and `Plains_Mead_Hall_*.jpg` — the same underlying
  // map, with a biome prefix as the only difference. Stem `mead hall`
  // absorbs `plains mead hall`.
  //
  // We can't solve this by extending VARIANT_TOKENS — biome words like
  // `plains` or `forest` are often the actual subject of a map, not a
  // qualifier. The suffix relationship between two existing stems is a
  // much stronger signal that one is a qualified version of the other.
  //
  // Safety constraints:
  //   - Only absorb into suffixes of ≥2 words. Single-word stems like
  //     `lair` or `castle` would otherwise become magnets that swallow
  //     every map ending in those words.
  //   - Strict suffix only — never merge a stem into itself.
  //   - Walk the longest possible suffix first so chains like
  //     `cold_plains_mead_hall → plains_mead_hall → mead_hall` resolve
  //     correctly in a single pass.
  //
  // Known tradeoff: if a library has a generic 2-word pack (e.g.
  // `Throne_Room_*`) AND qualifier-prefixed siblings (`Goblin_Throne_Room_*`,
  // `Dwarven_Throne_Room_*`), all three collapse into one card. Acceptable
  // — flipping Grouped → Flat shows them separately. Bump MIN_SUFFIX_WORDS
  // to 3 if this regression becomes annoying.
  const MIN_SUFFIX_WORDS = 2;
  for (const stem of Array.from(buckets.keys())) {
    const source = buckets.get(stem);
    if (!source) continue; // already merged away in an earlier iteration
    const words = stem.split(' ');
    if (words.length <= MIN_SUFFIX_WORDS) continue;
    for (let start = 1; start <= words.length - MIN_SUFFIX_WORDS; start++) {
      const candidate = words.slice(start).join(' ');
      const target = buckets.get(candidate);
      if (target && target !== source) {
        target.push(...source);
        buckets.delete(stem);
        break;
      }
    }
  }

  const result: MapGroup<T>[] = [];
  for (const [stem, list] of buckets) {
    const sorted = [...list].sort((a, b) => a.fileName.localeCompare(b.fileName));
    result.push({
      stem,
      representative: list[0], // first in input order = "most relevant" if input was sorted by search rank
      variants: sorted,
    });
  }
  return result;
}
