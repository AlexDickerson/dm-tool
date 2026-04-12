"""FastMCP server exposing the map library to Claude as native tools.

Run directly: `python -m dnd_map_tagger.mcp_server --config config.toml`
Or via the CLI: `map-tagger serve-mcp --config config.toml`

Register it in your Claude Desktop / Cowork MCP config so Claude can call
search_maps, get_map_details, get_map_thumbnail, and so on during a chat.
Requires the `mcp` Python package (`pip install mcp`).
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

# The `mcp` package is an optional install at the library level — we import
# lazily so that `map-tagger ingest` still works for users who don't want
# the MCP server.
try:
    from mcp.server.fastmcp import FastMCP, Image  # type: ignore
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "The `mcp` package is required for the MCP server. Install with:\n"
        "  pip install mcp"
    ) from e

from . import index as index_mod
from .config import load as load_config
from .pipeline import PipelineConfig, sidecar_path_for, thumbnail_path_for
from .schema import (
    Biome,
    GridVisible,
    InteriorExterior,
    LocationType,
    MapMetadata,
    TimeOfDay,
)


# ---- Server construction ----------------------------------------------------


def build_server(cfg: PipelineConfig) -> FastMCP:
    mcp = FastMCP(
        "dnd-map-tagger",
        instructions=(
            "This server indexes a local library of tagged D&D battlemaps. "
            "Use `list_vocabulary` first to learn which biome and location "
            "values are valid, then call `search_maps` with AND-combined "
            "filters. Use `get_map_details` to read a specific map's full "
            "sidecar (description, hooks, features). Use `get_map_thumbnail` "
            "to actually view a map inline."
        ),
    )

    # ---- Tools --------------------------------------------------------------

    @mcp.tool()
    def search_maps(
        keywords: str | None = None,
        biomes: list[str] | None = None,
        location_types: list[str] | None = None,
        mood: list[str] | None = None,
        features: list[str] | None = None,
        interior_exterior: str | None = None,
        time_of_day: str | None = None,
        grid_visible: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Search the local map library.

        All tag filters are AND-joined — a map must carry *every* requested
        biome/location/mood/feature to match. `keywords` is a full-text
        search expression over each map's title, description, and features
        (SQLite FTS5 syntax, so phrase queries in "quotes", OR, NOT, and
        prefix* are all supported). Returns a list of matching maps with
        their full tag records plus the absolute file path on disk.

        Call `list_vocabulary()` first if you don't know what values are
        allowed for biomes, location_types, interior_exterior, time_of_day,
        or grid_visible.
        """
        with index_mod.connect(cfg.index_db) as conn:
            rows = index_mod.search(
                conn,
                keywords=keywords or None,
                biomes=biomes or (),
                location_types=location_types or (),
                mood=mood or (),
                features=features or (),
                interior_exterior=interior_exterior or None,
                time_of_day=time_of_day or None,
                grid_visible=grid_visible or None,
                limit=max(1, min(limit, 100)),
            )
        results: list[dict[str, Any]] = []
        for r in rows:
            sidecar = json.loads(r["sidecar_json"])
            sidecar["_library_path"] = str(cfg.library / r["file_name"])
            sidecar["_thumbnail_path"] = str(
                thumbnail_path_for(cfg.library / r["file_name"])
            )
            results.append(sidecar)
        return results

    @mcp.tool()
    def get_map_details(file_name: str) -> dict[str, Any]:
        """Return the full JSON sidecar for a single map, keyed by its
        filename (with extension) as it appears in the library folder."""
        sc = sidecar_path_for(cfg.library / file_name)
        if not sc.exists():
            raise ValueError(f"No sidecar found for {file_name}")
        data = json.loads(sc.read_text(encoding="utf-8"))
        data["_library_path"] = str(cfg.library / file_name)
        data["_thumbnail_path"] = str(thumbnail_path_for(cfg.library / file_name))
        return data

    @mcp.tool()
    def get_map_thumbnail(file_name: str) -> Image:
        """Return the compact thumbnail for a map so it can be viewed inline.

        Thumbnails are generated at intake time at ~512px on the longest
        edge. If no thumbnail exists for this file, returns the full image
        as a fallback (may be large)."""
        thumb = thumbnail_path_for(cfg.library / file_name)
        full = cfg.library / file_name
        if thumb.exists():
            return Image(path=str(thumb))
        if full.exists():
            return Image(path=str(full))
        raise ValueError(f"No image or thumbnail found for {file_name}")

    @mcp.tool()
    def list_vocabulary() -> dict[str, list[str]]:
        """Return the controlled vocabularies the library uses so you know
        which values are valid for structured filters in `search_maps`."""
        return {
            "biomes": [b.value for b in Biome],
            "location_types": [lt.value for lt in LocationType],
            "interior_exterior": [ie.value for ie in InteriorExterior],
            "time_of_day": [t.value for t in TimeOfDay],
            "grid_visible": [g.value for g in GridVisible],
            "party_scale": ["solo", "small", "medium", "large", "massive"],
        }

    @mcp.tool()
    def library_stats() -> dict[str, Any]:
        """Summary of what the library currently holds: total count plus
        tag frequency histograms for biomes, locations, and moods. Useful
        to orient yourself before crafting a query."""
        with index_mod.connect(cfg.index_db) as conn:
            total = conn.execute("SELECT COUNT(*) FROM maps").fetchone()[0]
            biome_counts = dict(
                conn.execute(
                    "SELECT tag_value, COUNT(*) FROM map_tags "
                    "WHERE tag_kind='biome' GROUP BY tag_value ORDER BY 2 DESC"
                ).fetchall()
            )
            location_counts = dict(
                conn.execute(
                    "SELECT tag_value, COUNT(*) FROM map_tags "
                    "WHERE tag_kind='location' GROUP BY tag_value ORDER BY 2 DESC"
                ).fetchall()
            )
            mood_counts = dict(
                conn.execute(
                    "SELECT tag_value, COUNT(*) FROM map_tags "
                    "WHERE tag_kind='mood' GROUP BY tag_value ORDER BY 2 DESC LIMIT 25"
                ).fetchall()
            )
        return {
            "total_maps": total,
            "biomes": biome_counts,
            "location_types": location_counts,
            "top_moods": mood_counts,
            "library_path": str(cfg.library),
        }

    # ---- Resources ----------------------------------------------------------

    @mcp.resource("maplib://guide")
    def search_guide() -> str:
        """A short guide explaining how to query this library effectively."""
        guide_path = Path(__file__).resolve().parent.parent.parent / "SEARCH_GUIDE.md"
        if guide_path.exists():
            return guide_path.read_text(encoding="utf-8")
        return "SEARCH_GUIDE.md not found. See the repo README for usage."

    return mcp


# ---- Entry point ------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="dnd-map-tagger MCP server")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("MAP_TAGGER_CONFIG", "config.toml")),
    )
    args = parser.parse_args()
    cfg = load_config(args.config)
    server = build_server(cfg)
    server.run()  # defaults to stdio transport, which is what Claude Desktop wants


if __name__ == "__main__":
    main()
