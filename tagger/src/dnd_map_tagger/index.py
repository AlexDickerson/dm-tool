"""SQLite index for fast search across tagged maps.

The index is *disposable*: it's always rebuildable from the JSON sidecars
in the library folder via `map-tagger reindex`. Never store anything in
here that isn't also in a sidecar.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from .schema import MapMetadata


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS maps (
    file_name         TEXT PRIMARY KEY,
    file_hash_sha256  TEXT NOT NULL UNIQUE,
    phash             TEXT NOT NULL,
    width_px          INTEGER NOT NULL,
    height_px         INTEGER NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL,
    interior_exterior TEXT,
    time_of_day       TEXT,
    grid_visible      TEXT,
    grid_cells        TEXT,
    approx_party_scale TEXT,
    tagged_at         TEXT NOT NULL,
    model             TEXT NOT NULL,
    sidecar_json      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS map_tags (
    file_name TEXT NOT NULL,
    tag_kind  TEXT NOT NULL,  -- 'biome' | 'location' | 'mood' | 'feature'
    tag_value TEXT NOT NULL,
    PRIMARY KEY (file_name, tag_kind, tag_value),
    FOREIGN KEY (file_name) REFERENCES maps(file_name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_map_tags_value ON map_tags(tag_value);
CREATE INDEX IF NOT EXISTS idx_map_tags_kind_value ON map_tags(tag_kind, tag_value);

CREATE VIRTUAL TABLE IF NOT EXISTS maps_fts USING fts5(
    file_name UNINDEXED,
    title,
    description,
    features,
    tokenize = 'porter unicode61'
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_SQL)
    return conn


def upsert(conn: sqlite3.Connection, meta: MapMetadata) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO maps(file_name, file_hash_sha256, phash, width_px, height_px,
                         title, description, interior_exterior, time_of_day,
                         grid_visible, grid_cells, approx_party_scale,
                         tagged_at, model, sidecar_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_name) DO UPDATE SET
            file_hash_sha256=excluded.file_hash_sha256,
            phash=excluded.phash,
            width_px=excluded.width_px,
            height_px=excluded.height_px,
            title=excluded.title,
            description=excluded.description,
            interior_exterior=excluded.interior_exterior,
            time_of_day=excluded.time_of_day,
            grid_visible=excluded.grid_visible,
            grid_cells=excluded.grid_cells,
            approx_party_scale=excluded.approx_party_scale,
            tagged_at=excluded.tagged_at,
            model=excluded.model,
            sidecar_json=excluded.sidecar_json
        """,
        (
            meta.file_name,
            meta.file_hash_sha256,
            meta.phash,
            meta.width_px,
            meta.height_px,
            meta.title,
            meta.description,
            meta.interior_exterior.value,
            meta.time_of_day.value,
            meta.grid_visible.value,
            meta.grid_cells,
            meta.approx_party_scale,
            meta.tagged_at.isoformat(),
            meta.model,
            meta.model_dump_json(),
        ),
    )
    cur.execute("DELETE FROM map_tags WHERE file_name = ?", (meta.file_name,))
    tag_rows: list[tuple[str, str, str]] = []
    for b in meta.biomes:
        tag_rows.append((meta.file_name, "biome", b.value))
    for lt in meta.location_types:
        tag_rows.append((meta.file_name, "location", lt.value))
    for m in meta.mood:
        tag_rows.append((meta.file_name, "mood", m))
    for f in meta.features:
        tag_rows.append((meta.file_name, "feature", f))
    if tag_rows:
        cur.executemany(
            "INSERT OR IGNORE INTO map_tags(file_name, tag_kind, tag_value) VALUES (?, ?, ?)",
            tag_rows,
        )

    cur.execute("DELETE FROM maps_fts WHERE file_name = ?", (meta.file_name,))
    cur.execute(
        "INSERT INTO maps_fts(file_name, title, description, features) VALUES (?, ?, ?, ?)",
        (meta.file_name, meta.title, meta.description, " ".join(meta.features)),
    )
    conn.commit()


def hash_exists(conn: sqlite3.Connection, sha256: str) -> bool:
    cur = conn.execute("SELECT 1 FROM maps WHERE file_hash_sha256 = ?", (sha256,))
    return cur.fetchone() is not None


def search(
    conn: sqlite3.Connection,
    *,
    keywords: str | None = None,
    biomes: Iterable[str] = (),
    location_types: Iterable[str] = (),
    mood: Iterable[str] = (),
    features: Iterable[str] = (),
    interior_exterior: str | None = None,
    time_of_day: str | None = None,
    grid_visible: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Flexible AND search across tag axes and free-text keywords.

    Every tag argument is AND-joined (a map must have *all* of the requested
    biomes, locations, etc.). `keywords` is an FTS5 match expression and
    supports phrase quoting, OR, NOT, and prefix matching — consult
    https://www.sqlite.org/fts5.html#full_text_query_syntax for the full grammar.
    """
    clauses: list[str] = []
    params: list[object] = []

    def require_tag(kind: str, values: Iterable[str]) -> None:
        for v in values:
            clauses.append(
                "file_name IN (SELECT file_name FROM map_tags WHERE tag_kind = ? AND tag_value = ?)"
            )
            params.extend([kind, v])

    require_tag("biome", biomes)
    require_tag("location", location_types)
    require_tag("mood", mood)
    require_tag("feature", features)

    if interior_exterior:
        clauses.append("interior_exterior = ?")
        params.append(interior_exterior)
    if time_of_day:
        clauses.append("time_of_day = ?")
        params.append(time_of_day)
    if grid_visible:
        clauses.append("grid_visible = ?")
        params.append(grid_visible)

    if keywords:
        clauses.append("file_name IN (SELECT file_name FROM maps_fts WHERE maps_fts MATCH ?)")
        params.append(keywords)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        "SELECT file_name, title, description, interior_exterior, time_of_day, "
        "grid_visible, grid_cells, approx_party_scale, sidecar_json "
        f"FROM maps{where} ORDER BY tagged_at DESC LIMIT ?"
    )
    params.append(limit)
    return [
        {
            "file_name": r[0],
            "title": r[1],
            "description": r[2],
            "interior_exterior": r[3],
            "time_of_day": r[4],
            "grid_visible": r[5],
            "grid_cells": r[6],
            "approx_party_scale": r[7],
            "sidecar_json": r[8],
        }
        for r in conn.execute(sql, params).fetchall()
    ]


def all_sidecar_paths(library_dir: Path) -> list[Path]:
    return sorted(library_dir.glob("*.json"))


def rebuild_from_sidecars(conn: sqlite3.Connection, library_dir: Path) -> int:
    conn.executescript(
        "DELETE FROM map_tags; DELETE FROM maps_fts; DELETE FROM maps;"
    )
    count = 0
    for sc in all_sidecar_paths(library_dir):
        try:
            data = json.loads(sc.read_text(encoding="utf-8"))
            meta = MapMetadata.model_validate(data)
        except Exception:
            continue
        upsert(conn, meta)
        count += 1
    return count
