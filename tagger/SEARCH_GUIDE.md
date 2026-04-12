# Map Library Search Guide

This document is written for Claude (or any language model) that has been pointed at a `dnd-map-tagger` library. Read it before querying — it explains the controlled vocabulary, the filter grammar, and the conventions the tagging model uses. Following this guide dramatically improves search quality because it prevents you from inventing tag values that don't exist.

## Two ways to search

**Via the MCP server (preferred).** If this library is exposed through `dnd-map-tagger`'s MCP server, use these tools in roughly this order for each search:

1. `library_stats()` once at the start of a session — tells you how many maps exist and which biomes/locations/moods are well-represented. Useful for calibrating expectations.
2. `list_vocabulary()` if you're unsure what values are valid. Biomes and location types are strict enums; mood and features are free-form short strings.
3. `search_maps(...)` to find candidates.
4. `get_map_thumbnail(file_name)` to actually see the top candidates.
5. `get_map_details(file_name)` for the full description, encounter hooks, and feature list on a chosen map.

**Via the shell.** If you only have filesystem access, run:
```
map-tagger search --json --biome forest --mood cozy --keywords "riverside night"
```
The `--json` output is a list of full sidecar records. You can also `Grep` the sidecar files directly — every `<filename>.json` in the library folder is the canonical metadata for that map.

## Controlled vocabulary

These are the only legal values for their respective fields. Using values outside this list in `search_maps` returns no results.

### Biomes
`forest, jungle, desert, tundra, swamp, mountain, coastal, ocean, river_lake, plains, urban, rural, underdark, underground, planar, celestial, abyssal, feywild, shadowfell, other`

A single map can have multiple biomes (e.g. a riverside forest clearing is `["forest", "river_lake"]`). Maps typically have 1–3 biomes.

### Location types
`tavern, inn, shop, market, temple, shrine, castle, keep, fortress, tower, mansion, house, village, town, city_street, harbor, ship, airship, bridge, road, crossroads, dungeon, crypt, tomb, cave, mine, sewer, prison, library, laboratory, arena, camp, ruins, wilderness, battlefield, lair, portal, other`

Maps also frequently carry multiple location types (a "temple dungeon" might be both `temple` and `dungeon`).

### Interior / exterior
`interior, exterior, mixed, unknown`

Use `mixed` for maps that show both inside and outside a structure in the same image (e.g. a cross-section tavern with a yard).

### Time of day
`day, dusk, night, dawn, unknown`

The tagging model only fills this in when it's visually obvious from lighting, torches, shadows, or sky color. Many maps are correctly `unknown`.

### Grid visible
`gridded, gridless, unknown`

## Free-form fields

**`mood`** is a short list of 1–3 word descriptors. Typical values include: `cozy, sinister, ruined, festive, sacred, haunted, opulent, squalid, serene, chaotic, tense, mysterious, whimsical, grim, bustling, abandoned`. These are deliberately open-ended — feel free to query for moods that aren't in this list, but expect the library to have used the common ones consistently.

**`features`** is free-form short phrases describing notable map elements: `"river bisects map", "hidden passage", "central altar", "collapsed roof", "dock with moored ship"`. When filtering by feature in `search_maps`, you need an exact match, so it's usually better to search features via the `keywords` parameter (which runs full-text search over description + features together) instead.

## Keyword search (FTS5)

The `keywords` parameter runs a SQLite FTS5 match against each map's title, description, and features. You can use:

- **Single terms**: `keywords="riverside"` matches any map with "riverside" in any of those fields.
- **Phrase queries**: `keywords='"broken altar"'` (note the nested quotes) matches that exact phrase.
- **Boolean operators**: `keywords="tavern OR inn"`, `keywords="forest NOT urban"`.
- **Prefix matching**: `keywords="tav*"` matches tavern, tavernkeeper, taverna, etc.

Prefer structured filters (biome, location_type, mood) when the thing you care about has a controlled value. Fall back to keywords when you're looking for something more specific or subjective.

## Composition patterns

All filter arguments AND together. A few examples of idiomatic queries:

```python
# "A cozy forest tavern at dusk"
search_maps(
    biomes=["forest"],
    location_types=["tavern"],
    mood=["cozy"],
    time_of_day="dusk",
)

# "Somewhere the party could fight a large encounter indoors"
search_maps(
    interior_exterior="interior",
    keywords='large OR massive OR "battle room" OR "great hall"',
    limit=10,
)

# "A secret hideout in the sewers"
search_maps(
    location_types=["sewer"],
    keywords='hidden OR secret OR concealed',
)

# "A spooky ruined temple for a horror one-shot"
search_maps(
    location_types=["temple", "ruins"],
    mood=["haunted", "sinister"],
)
```

If an initial query returns zero hits, try widening in this order:
1. Drop the most specific tag (usually mood or time_of_day).
2. Broaden the location type (`tavern` → `inn` → no location filter, just keywords).
3. Replace structured filters with keyword search.
4. Drop biome last — biome is usually the most load-bearing tag.

## Presenting results to a DM

When you return results, the most useful shape is:

1. A one-sentence summary of which query interpretation you used.
2. For each of the top 3–5 matches: the title, a sentence or two from the `description` field, and the `_library_path` so the DM can open it locally. If you have `get_map_thumbnail` available, inline the thumbnails.
3. If there were strong non-matches that might still be interesting, list them briefly at the end as "also consider".

Don't overwhelm the DM with more than ~5 results at a time unless they ask. Mid-session, speed and signal matter more than completeness.

## A note on schema version

The sidecar JSON records include a `schema_version` field. This guide describes schema version 1. If you encounter sidecars with a higher version, assume new fields may be present but the ones documented here are still supported.
