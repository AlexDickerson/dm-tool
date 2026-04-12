"""Config loading: merges a TOML file with environment variable overrides."""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

from .pipeline import PipelineConfig


def _resolve(raw: str, anchor: Path) -> Path:
    """Resolve a path string from config. Absolute paths are used as-is;
    relative paths are anchored to `anchor` (the config file's parent dir)
    so configs are portable regardless of where `map-tagger` is invoked from."""
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = (anchor / p).resolve()
    return p


def load(config_path: Path, *, dry_run: bool = False) -> PipelineConfig:
    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found: {config_path}\n"
            "Copy config.example.toml to config.toml and edit the paths."
        )
    data = tomllib.loads(config_path.read_text(encoding="utf-8"))

    paths = data.get("paths", {})
    anth = data.get("anthropic", {})
    eagle = data.get("eagle", {})
    tagging = data.get("tagging", {})
    thumbs = data.get("thumbnails", {})

    api_key = os.environ.get("ANTHROPIC_API_KEY") or anth.get("api_key")
    anchor = config_path.resolve().parent

    return PipelineConfig(
        inbox=_resolve(paths["inbox"], anchor),
        library=_resolve(paths["library"], anchor),
        quarantine=_resolve(paths["quarantine"], anchor),
        index_db=_resolve(paths["index_db"], anchor),
        anthropic_api_key=api_key,
        model=anth.get("model", "claude-sonnet-4-6"),
        max_output_tokens=int(anth.get("max_output_tokens", 1500)),
        eagle_enabled=bool(eagle.get("enabled", True)),
        eagle_base_url=eagle.get("base_url", "http://localhost:41595"),
        eagle_folder_id=eagle.get("folder_id") or None,
        max_tags=int(tagging.get("max_tags", 20)),
        dedup=bool(tagging.get("dedup", True)),
        dry_run=dry_run,
        thumbnails_enabled=bool(thumbs.get("enabled", True)),
        thumbnail_max_edge=int(thumbs.get("max_edge", 512)),
    )
