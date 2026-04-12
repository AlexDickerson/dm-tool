"""Structured schema for map metadata.

Everything the vision model returns, plus the local fields the intake
script attaches (file hash, grid detected from filename, timestamps).

The JSON sidecar written next to each map mirrors MapMetadata exactly,
so sidecars are the canonical source of truth and are trivially
re-ingestable if the SQLite index is ever lost.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional


def _now_utc() -> datetime:
    """UTC now, timezone-aware. Replaces deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc)

from pydantic import BaseModel, Field, field_validator


# ---- Controlled vocabularies ------------------------------------------------
# Tight enums for axes with a well-known answer space.  Claude is instructed
# to pick from these lists; free-form tags go in the `features` field.

class Biome(str, Enum):
    forest = "forest"
    jungle = "jungle"
    desert = "desert"
    tundra = "tundra"
    swamp = "swamp"
    mountain = "mountain"
    coastal = "coastal"
    ocean = "ocean"
    river_lake = "river_lake"
    plains = "plains"
    urban = "urban"
    rural = "rural"
    underdark = "underdark"
    underground = "underground"
    planar = "planar"
    celestial = "celestial"
    abyssal = "abyssal"
    feywild = "feywild"
    shadowfell = "shadowfell"
    other = "other"


class LocationType(str, Enum):
    tavern = "tavern"
    inn = "inn"
    shop = "shop"
    market = "market"
    temple = "temple"
    shrine = "shrine"
    castle = "castle"
    keep = "keep"
    fortress = "fortress"
    tower = "tower"
    mansion = "mansion"
    house = "house"
    village = "village"
    town = "town"
    city_street = "city_street"
    harbor = "harbor"
    ship = "ship"
    airship = "airship"
    bridge = "bridge"
    road = "road"
    crossroads = "crossroads"
    dungeon = "dungeon"
    crypt = "crypt"
    tomb = "tomb"
    cave = "cave"
    mine = "mine"
    sewer = "sewer"
    prison = "prison"
    library = "library"
    laboratory = "laboratory"
    arena = "arena"
    camp = "camp"
    ruins = "ruins"
    wilderness = "wilderness"
    battlefield = "battlefield"
    lair = "lair"
    portal = "portal"
    other = "other"


class InteriorExterior(str, Enum):
    interior = "interior"
    exterior = "exterior"
    mixed = "mixed"
    unknown = "unknown"


class TimeOfDay(str, Enum):
    day = "day"
    dusk = "dusk"
    night = "night"
    dawn = "dawn"
    unknown = "unknown"


class GridVisible(str, Enum):
    gridded = "gridded"
    gridless = "gridless"
    unknown = "unknown"


# ---- Main metadata record ---------------------------------------------------

class MapMetadata(BaseModel):
    """The full record written to the JSON sidecar and the SQLite index."""

    # --- Identity ------------------------------------------------------------
    file_name: str = Field(description="Original filename as it landed in library/")
    file_hash_sha256: str = Field(description="Content hash for dedup")
    phash: str = Field(description="Perceptual hash for near-duplicate detection")
    width_px: int
    height_px: int

    # --- Model-generated tags ------------------------------------------------
    title: str = Field(description="Short descriptive title the model invented")
    description: str = Field(description="One to two sentence description")

    biomes: list[Biome] = Field(default_factory=list)
    location_types: list[LocationType] = Field(default_factory=list)
    interior_exterior: InteriorExterior = InteriorExterior.unknown
    time_of_day: TimeOfDay = TimeOfDay.unknown

    mood: list[str] = Field(
        default_factory=list,
        description="Short mood descriptors, e.g. cozy, sinister, ruined, festive",
    )
    features: list[str] = Field(
        default_factory=list,
        description="Free-form notable features, e.g. 'river through center', 'secret passage'",
    )

    # --- Mechanics -----------------------------------------------------------
    grid_visible: GridVisible = GridVisible.unknown
    grid_cells: Optional[str] = Field(
        default=None,
        description="Grid dimensions if visibly countable, e.g. '28x20'",
    )
    approx_party_scale: Optional[Literal["solo", "small", "medium", "large", "massive"]] = Field(
        default=None,
        description="Rough feel for how many combatants the space fits comfortably",
    )

    # --- Encounter hooks (optional flavor) -----------------------------------
    encounter_hooks: list[str] = Field(
        default_factory=list,
        description="Two or three short adventure-hook sentences, optional",
    )

    # --- Provenance ----------------------------------------------------------
    tagged_at: datetime = Field(default_factory=_now_utc)
    model: str = Field(description="Which Claude model produced the tags")
    schema_version: int = 1

    @field_validator("mood", "features", "encounter_hooks", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return v

    def flat_tags(self, max_tags: int = 20) -> list[str]:
        """Union of all controlled + free-form tags, deduped, for Eagle."""
        tags: list[str] = []
        tags.extend(b.value for b in self.biomes)
        tags.extend(lt.value for lt in self.location_types)
        if self.interior_exterior != InteriorExterior.unknown:
            tags.append(self.interior_exterior.value)
        if self.time_of_day != TimeOfDay.unknown:
            tags.append(self.time_of_day.value)
        if self.grid_visible != GridVisible.unknown:
            tags.append(self.grid_visible.value)
        tags.extend(self.mood)
        tags.extend(self.features)
        # Dedup preserving order
        seen = set()
        out: list[str] = []
        for t in tags:
            key = t.lower().strip()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(t)
            if len(out) >= max_tags:
                break
        return out


class VisionTaggingResult(BaseModel):
    """Just the fields the vision model fills in. Intake layer merges this
    with file-level identity fields to produce a full MapMetadata."""

    title: str
    description: str
    biomes: list[Biome] = Field(default_factory=list)
    location_types: list[LocationType] = Field(default_factory=list)
    interior_exterior: InteriorExterior = InteriorExterior.unknown
    time_of_day: TimeOfDay = TimeOfDay.unknown
    mood: list[str] = Field(default_factory=list)
    features: list[str] = Field(default_factory=list)
    grid_visible: GridVisible = GridVisible.unknown
    grid_cells: Optional[str] = None
    approx_party_scale: Optional[Literal["solo", "small", "medium", "large", "massive"]] = None
    encounter_hooks: list[str] = Field(default_factory=list)
