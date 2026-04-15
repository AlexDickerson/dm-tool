"""Claude vision integration: send a map image, get back VisionTaggingResult.

The prompt is the product here. It's carefully constrained to emit strict
JSON matching the VisionTaggingResult schema so we don't have to parse
free-form model output.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from pathlib import Path

from PIL import Image
from pydantic import ValidationError

log = logging.getLogger("dnd_map_tagger")

from .schema import (
    Biome,
    GridVisible,
    InteriorExterior,
    LocationType,
    TimeOfDay,
    VisionTaggingResult,
)


SYSTEM_PROMPT = """You are a TTRPG battlemap cataloguer. Your job is to look at a \
single battlemap image and produce a compact, structured JSON record of \
what it depicts, so a Dungeon Master can search their map library by \
biome, location, mood, and mechanics.

Rules:
1. Respond with a single JSON object and nothing else. No prose, no markdown \
   fences, no commentary. Just the object.
2. Only use values from the controlled vocabularies listed below when a field \
   is enum-typed. If nothing fits, use "other" (or "unknown" for questions of \
   fact like time_of_day).
3. Be generous with `biomes` and `location_types` when a map legitimately \
   covers multiple (e.g. a riverside tavern at the edge of a forest is \
   biomes=["forest","river_lake"], location_types=["tavern"]).
4. `mood` is short tags, 1-3 words each, max 5 items. Prefer concrete \
   evocative words (cozy, sinister, ruined, festive, sacred, haunted, \
   opulent, squalid, serene, chaotic).
5. `features` is free-form, short phrases describing notable map elements \
   a DM would care about: "river bisects map", "hidden passage", \
   "central altar", "collapsed roof", "dock with moored ship". Max 8 items.
6. `encounter_hooks` is optional but encouraged: 2-3 one-sentence adventure \
   seeds the map could support.
7. Don't invent grid dimensions. Only fill `grid_cells` (e.g. "28x20") if the \
   grid is visibly countable. Otherwise omit it.
8. `approx_party_scale` refers to how many combatants the space fits \
   comfortably: solo / small (1-4) / medium (5-10) / large (10-20) / massive \
   (20+). Omit if unclear."""


def _controlled_vocab_block() -> str:
    return (
        "Allowed biomes:\n  "
        + ", ".join(b.value for b in Biome)
        + "\n\nAllowed location_types:\n  "
        + ", ".join(lt.value for lt in LocationType)
        + "\n\nAllowed interior_exterior: "
        + ", ".join(ie.value for ie in InteriorExterior)
        + "\nAllowed time_of_day: "
        + ", ".join(t.value for t in TimeOfDay)
        + "\nAllowed grid_visible: "
        + ", ".join(g.value for g in GridVisible)
    )


USER_PROMPT_TEMPLATE = """Catalogue this battlemap. Return a JSON object with \
exactly these fields:

{{
  "title": "<short descriptive title you invent>",
  "description": "<1-2 sentence description>",
  "biomes": [...],
  "location_types": [...],
  "interior_exterior": "<one of: interior, exterior, mixed, unknown>",
  "time_of_day": "<one of: day, dusk, night, dawn, unknown>",
  "mood": [...],
  "features": [...],
  "grid_visible": "<one of: gridded, gridless, unknown>",
  "grid_cells": "<e.g. 28x20, or omit>",
  "approx_party_scale": "<solo|small|medium|large|massive, or omit>",
  "encounter_hooks": [...]
}}

{vocab}

Respond with the JSON object only."""


def build_prompt() -> tuple[str, str]:
    return SYSTEM_PROMPT, USER_PROMPT_TEMPLATE.format(vocab=_controlled_vocab_block())


# ---- Actual API call --------------------------------------------------------


class VisionError(RuntimeError):
    pass


# Map Pillow's format string to the Anthropic-accepted media type. We sniff
# the format from the actual file bytes (via Pillow) instead of trusting the
# filename extension — people rename files, web downloads lie, and the API
# rejects requests whose declared media type doesn't match the bytes.
_PIL_FORMAT_TO_MEDIA = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
    "GIF": "image/gif",
}


def _sniff_media_type(image_path: Path) -> str:
    """Return the Anthropic media type for an image file by reading its
    actual format, not its extension. Raises VisionError if the format is
    something Anthropic vision can't consume."""
    try:
        with Image.open(image_path) as im:
            fmt = (im.format or "").upper()
    except Exception as e:  # Pillow raises a range of exceptions
        raise VisionError(f"Could not read image format for {image_path.name}: {e}")
    media = _PIL_FORMAT_TO_MEDIA.get(fmt)
    if media is None:
        raise VisionError(
            f"Unsupported image format for {image_path.name}: {fmt!r}. "
            "Anthropic vision accepts PNG, JPEG, WEBP, and GIF only. "
            "Convert the file or remove it from the inbox."
        )
    return media


# Anthropic's vision API caps the base64-encoded image payload at 5 MB.
# Base64 inflates raw bytes by ~4/3, so our raw-byte budget is ~3.75 MB.
# Stay well under that to leave headroom for the rest of the JSON body.
_MAX_RAW_BYTES = 3_500_000
# Anthropic recommends images within ~1.15 megapixels and ~1568px on the
# longest edge for best accuracy. The API also hard-rejects any image
# whose either dimension exceeds 8000 px with a 400 BadRequestError, so
# we must downscale client-side — a heavily compressed JPEG can be under
# the byte cap yet still blow past the pixel cap.
_MAX_EDGE_PX = 1568


def _prepare_image_payload(image_path: Path) -> tuple[str, str]:
    """Return (media_type, base64_data) for an image, downscaling and
    re-encoding in memory if the original would exceed Anthropic's payload
    cap. The file on disk is never modified.

    Small images (under both the byte cap *and* the pixel-edge cap) pass
    through untouched (no re-encoding, no quality loss). Oversized images
    — in bytes, pixels, or both — are opened with Pillow, downscaled so
    the longest edge is at most _MAX_EDGE_PX, and re-encoded as high-
    quality JPEG.
    """
    raw_bytes = image_path.read_bytes()
    media_type = _sniff_media_type(image_path)

    if len(raw_bytes) <= _MAX_RAW_BYTES:
        # Under the byte cap — still need to check pixel dimensions. The
        # API rejects images whose either side exceeds 8000 px outright,
        # so a small-bytes / large-pixels file would 400 without this check.
        try:
            with Image.open(image_path) as im:
                longest = max(im.size)
        except Exception as e:
            raise VisionError(f"Could not read image dimensions for {image_path.name}: {e}")
        if longest <= _MAX_EDGE_PX:
            # Under both caps — preserve the original bytes verbatim so
            # we don't lose any fidelity (especially for PNGs with alpha).
            return media_type, base64.standard_b64encode(raw_bytes).decode("ascii")
        # else: fall through to the downscale branch below

    # Oversized path: open, downscale, re-encode as JPEG.
    try:
        with Image.open(image_path) as im:
            im.load()
            original_size = im.size
            # JPEG doesn't support alpha; drop it. Most battlemaps won't
            # have transparency, and the tagger doesn't care about it.
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")

            longest = max(im.size)
            if longest > _MAX_EDGE_PX:
                scale = _MAX_EDGE_PX / longest
                new_size = (max(1, int(im.width * scale)), max(1, int(im.height * scale)))
                im = im.resize(new_size, Image.LANCZOS)

            # Encode at quality 85 first; if still too big, step down.
            for quality in (85, 75, 60):
                buf = io.BytesIO()
                im.save(buf, format="JPEG", quality=quality, optimize=True)
                encoded = buf.getvalue()
                if len(encoded) <= _MAX_RAW_BYTES:
                    break
            else:
                raise VisionError(
                    f"Could not shrink {image_path.name} under the 5 MB API cap "
                    f"even at JPEG quality 60. Original was "
                    f"{len(raw_bytes) / 1_000_000:.1f} MB at {original_size}."
                )
    except VisionError:
        raise
    except Exception as e:
        raise VisionError(f"Failed to downscale {image_path.name}: {e}")

    log.info(
        "vision: downscaled %s for API (%.1f MB %s \u2192 %.1f MB %s JPEG q%d)",
        image_path.name,
        len(raw_bytes) / 1_000_000,
        f"{original_size[0]}x{original_size[1]}",
        len(encoded) / 1_000_000,
        f"{im.width}x{im.height}",
        quality,
    )
    return "image/jpeg", base64.standard_b64encode(encoded).decode("ascii")


def tag_image_with_claude(
    image_path: Path,
    *,
    api_key: str,
    model: str = "claude-sonnet-4-6",
    max_output_tokens: int = 1500,
) -> VisionTaggingResult:
    """Send a single image to Claude and parse the JSON response.

    Any anthropic API error (bad request, auth failure, rate limit, connection
    error) is re-raised as a VisionError so the pipeline's per-file quarantine
    path handles it. Without this wrapping, one bad file would crash an entire
    batch ingest mid-run.
    """
    import anthropic
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    system, user = build_prompt()

    media_type, b64 = _prepare_image_payload(image_path)

    try:
        resp = client.messages.create(
            model=model,
            max_tokens=max_output_tokens,
            system=system,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": user},
                    ],
                }
            ],
        )
    except anthropic.APIError as e:
        # APIError is the base class for BadRequestError, AuthenticationError,
        # RateLimitError, APIConnectionError, etc. Re-raising as VisionError
        # lets the pipeline quarantine this file and continue with the batch.
        raise VisionError(
            f"Anthropic API error for {image_path.name}: {type(e).__name__}: {e}"
        )

    # Concatenate all text blocks
    raw = "".join(block.text for block in resp.content if getattr(block, "type", "") == "text").strip()
    if not raw:
        raise VisionError(f"Empty response for {image_path.name}")

    # Be lenient about accidental markdown fences
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].lstrip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise VisionError(f"Claude returned non-JSON for {image_path.name}: {e}\n---\n{raw[:400]}")

    try:
        return VisionTaggingResult.model_validate(data)
    except ValidationError as e:
        raise VisionError(f"Claude response failed schema validation for {image_path.name}: {e}")


# ---- Offline mock for tests and dry runs ------------------------------------


def mock_tag_image(image_path: Path) -> VisionTaggingResult:
    """Deterministic mock that lets the pipeline run without an API key.
    Produces a plausible-looking result based on the filename."""
    name_lower = image_path.stem.lower()

    def contains(*keys: str) -> bool:
        return any(k in name_lower for k in keys)

    biomes: list[Biome] = []
    if contains("forest", "wood", "grove"):
        biomes.append(Biome.forest)
    if contains("desert", "dune", "sand"):
        biomes.append(Biome.desert)
    if contains("swamp", "bog", "marsh"):
        biomes.append(Biome.swamp)
    if contains("cave", "cavern"):
        biomes.append(Biome.underground)
    if contains("city", "town", "street", "market"):
        biomes.append(Biome.urban)
    if contains("coast", "harbor", "dock", "ship"):
        biomes.append(Biome.coastal)
    if not biomes:
        biomes.append(Biome.other)

    location_types: list[LocationType] = []
    for keyword, lt in [
        ("tavern", LocationType.tavern),
        ("inn", LocationType.inn),
        ("temple", LocationType.temple),
        ("shrine", LocationType.shrine),
        ("castle", LocationType.castle),
        ("keep", LocationType.keep),
        ("tower", LocationType.tower),
        ("cave", LocationType.cave),
        ("dungeon", LocationType.dungeon),
        ("crypt", LocationType.crypt),
        ("tomb", LocationType.tomb),
        ("mine", LocationType.mine),
        ("library", LocationType.library),
        ("market", LocationType.market),
        ("bridge", LocationType.bridge),
        ("harbor", LocationType.harbor),
        ("ship", LocationType.ship),
        ("ruin", LocationType.ruins),
        ("camp", LocationType.camp),
        ("lair", LocationType.lair),
    ]:
        if keyword in name_lower:
            location_types.append(lt)
    if not location_types:
        location_types.append(LocationType.wilderness)

    interior = InteriorExterior.interior if contains("interior", "inside", "tavern", "temple", "library") else InteriorExterior.unknown
    if contains("exterior", "outside", "wilderness", "forest"):
        interior = InteriorExterior.exterior

    mood: list[str] = []
    if contains("cozy", "warm", "hearth"):
        mood.append("cozy")
    if contains("ruin", "abandon"):
        mood.append("ruined")
    if contains("haunt", "ghost", "undead"):
        mood.append("haunted")
    if contains("dark", "sinister", "evil"):
        mood.append("sinister")
    if not mood:
        mood.append("neutral")

    return VisionTaggingResult(
        title=image_path.stem.replace("_", " ").title()[:60] or "Untitled Map",
        description=f"Mock description for {image_path.name}. Replace with real vision call by running without --dry-run.",
        biomes=biomes,
        location_types=location_types,
        interior_exterior=interior,
        time_of_day=TimeOfDay.unknown,
        mood=mood,
        features=[],
        grid_visible=GridVisible.unknown,
        grid_cells=None,
        approx_party_scale=None,
        encounter_hooks=[],
    )
