// Read-only wrapper around the map-tagger's SQLite index.
//
// We intentionally re-implement the search semantics from
// `dnd_map_tagger/index.py::search` rather than shelling out to Python, so
// the dm-tool has no runtime dependency on the Python project. The schema
// is the contract between the two.
//
// Keep this file free of Electron imports — it should be testable in a
// plain Node process if we ever want to write unit tests against a fixture
// DB.

import Database, { type Database as BetterSqliteDB } from "better-sqlite3";
import type {
  Facets,
  MapDetail,
  MapSummary,
  SearchParams,
} from "../shared/types.js";

/** The raw columns we select from the `maps` table for list rows. */
interface MapListRow {
  file_name: string;
  title: string;
  description: string;
  interior_exterior: string | null;
  time_of_day: string | null;
  grid_visible: string | null;
  grid_cells: string | null;
  approx_party_scale: string | null;
}

interface MapDetailRow extends MapListRow {
  file_hash_sha256: string;
  phash: string;
  width_px: number;
  height_px: number;
  sidecar_json: string;
}

/** Shape of the sidecar JSON blob — only the fields we actually read. */
interface SidecarJson {
  biomes?: string[];
  location_types?: string[];
  mood?: string[];
  features?: string[];
  encounter_hooks?: string[];
  tagged_at?: string;
  model?: string;
}

export class MapDb {
  private db: BetterSqliteDB;

  constructor(dbPath: string) {
    // readonly: true means better-sqlite3 opens with SQLITE_OPEN_READONLY and
    // won't even try to acquire a write lock, which plays nicely with the
    // map-tagger potentially being run concurrently.
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    // WAL is only relevant for writers, but setting busy timeout makes
    // us resilient to the Python side holding a transaction briefly.
    this.db.pragma("busy_timeout = 2000");
  }

  close(): void {
    this.db.close();
  }

  /** AND-joined search over tags, exact-match axes, and FTS5 keywords.
   *  Mirrors the behavior of `dnd_map_tagger.index.search`. */
  search(params: SearchParams): MapSummary[] {
    const clauses: string[] = [];
    const values: unknown[] = [];

    const requireTag = (kind: string, tagValues: string[] | undefined) => {
      if (!tagValues) return;
      for (const v of tagValues) {
        clauses.push(
          "file_name IN (SELECT file_name FROM map_tags WHERE tag_kind = ? AND tag_value = ?)",
        );
        values.push(kind, v);
      }
    };

    requireTag("biome", params.biomes);
    requireTag("location", params.locationTypes);
    requireTag("mood", params.mood);
    requireTag("feature", params.features);

    if (params.interiorExterior) {
      clauses.push("interior_exterior = ?");
      values.push(params.interiorExterior);
    }
    if (params.timeOfDay) {
      clauses.push("time_of_day = ?");
      values.push(params.timeOfDay);
    }
    if (params.gridVisible) {
      clauses.push("grid_visible = ?");
      values.push(params.gridVisible);
    }

    if (params.keywords && params.keywords.trim()) {
      clauses.push(
        "file_name IN (SELECT file_name FROM maps_fts WHERE maps_fts MATCH ?)",
      );
      values.push(escapeFtsQuery(params.keywords.trim()));
    }

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(params.limit ?? 200, 2000));

    const sql =
      "SELECT file_name, title, description, interior_exterior, time_of_day, " +
      "       grid_visible, grid_cells, approx_party_scale " +
      "FROM maps" +
      where +
      " ORDER BY tagged_at DESC LIMIT ?";

    values.push(limit);

    const rows = this.db.prepare(sql).all(...values) as MapListRow[];
    return rows.map(rowToSummary);
  }

  /** Fetches one map with full sidecar detail. */
  getDetail(fileName: string): MapDetail | null {
    const sql =
      "SELECT file_name, title, description, interior_exterior, time_of_day, " +
      "       grid_visible, grid_cells, approx_party_scale, " +
      "       file_hash_sha256, phash, width_px, height_px, sidecar_json " +
      "FROM maps WHERE file_name = ?";
    const row = this.db.prepare(sql).get(fileName) as MapDetailRow | undefined;
    if (!row) return null;

    let sidecar: SidecarJson = {};
    try {
      sidecar = JSON.parse(row.sidecar_json) as SidecarJson;
    } catch {
      // Corrupt sidecar JSON — fall back to the DB columns, which is all
      // the summary fields.
    }

    return {
      ...rowToSummary(row),
      fileHashSha256: row.file_hash_sha256,
      phash: row.phash,
      widthPx: row.width_px,
      heightPx: row.height_px,
      biomes: sidecar.biomes ?? [],
      locationTypes: sidecar.location_types ?? [],
      mood: sidecar.mood ?? [],
      features: sidecar.features ?? [],
      encounterHooks: sidecar.encounter_hooks ?? [],
      taggedAt: sidecar.tagged_at ?? "",
      model: sidecar.model ?? "",
    };
  }

  /** Returns distinct tag values across the library, grouped by kind.
   *  Used to populate the filter panel without hardcoding the enum lists. */
  getFacets(): Facets {
    const stmt = this.db.prepare(
      "SELECT tag_kind, tag_value FROM map_tags ORDER BY tag_kind, tag_value",
    );
    const biomes: string[] = [];
    const locationTypes: string[] = [];
    const moods: string[] = [];
    const features: string[] = [];
    for (const row of stmt.iterate() as Iterable<{
      tag_kind: string;
      tag_value: string;
    }>) {
      switch (row.tag_kind) {
        case "biome":
          biomes.push(row.tag_value);
          break;
        case "location":
          locationTypes.push(row.tag_value);
          break;
        case "mood":
          moods.push(row.tag_value);
          break;
        case "feature":
          features.push(row.tag_value);
          break;
      }
    }
    // Distinct + already sorted by the SQL query.
    return {
      biomes: dedup(biomes),
      locationTypes: dedup(locationTypes),
      moods: dedup(moods),
      features: dedup(features),
    };
  }
}

function rowToSummary(row: MapListRow): MapSummary {
  return {
    fileName: row.file_name,
    title: row.title,
    description: row.description,
    interiorExterior: row.interior_exterior as MapSummary["interiorExterior"],
    timeOfDay: row.time_of_day as MapSummary["timeOfDay"],
    gridVisible: row.grid_visible as MapSummary["gridVisible"],
    gridCells: row.grid_cells,
    approxPartyScale: row.approx_party_scale,
  };
}

function dedup(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** Sanitize a user-entered string for FTS5 MATCH.
 *
 * The raw user input like `a gloomy castle in a dark forest` is treated as
 * an implicit AND of the individual tokens. We escape double quotes and
 * wrap each word in quotes so FTS5 can't misinterpret punctuation as
 * operators. If the user wants to use real FTS5 syntax they can still do
 * so by prefixing with `raw:` — this is a cheap escape hatch for advanced
 * users without needing a full parser.
 */
function escapeFtsQuery(input: string): string {
  if (input.startsWith("raw:")) {
    return input.slice(4);
  }
  const tokens = input
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" AND ");
}
