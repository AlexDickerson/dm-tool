"""Intake pipeline: drop a file into inbox/, produce a fully tagged + indexed map."""

from __future__ import annotations

import hashlib
import logging
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import imagehash
from PIL import Image

from . import index as index_mod
from .eagle import EagleClient
from .schema import MapMetadata, VisionTaggingResult
from .vision import VisionError, mock_tag_image, tag_image_with_claude

log = logging.getLogger("dnd_map_tagger")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# Midpoint of the README's per-map cost band ($0.003–$0.01). Used only for
# the --preview cost estimate. Kept as a module constant so it's easy to
# tweak in one place if the actual spend diverges over time.
COST_PER_MAP_USD_LOW = 0.003
COST_PER_MAP_USD_HIGH = 0.010

# Thread-safety for the library placement phase of process_file. Under
# parallel ingest, two workers with same-named source files (e.g. two
# subfolders both containing "map.png") could race on safe_library_path
# and silently overwrite each other. We solve this by holding a lock
# while picking a collision-free destination and *reserving* it — a
# concurrent caller will see the reserved path as taken and pick the next
# suffix. We can't just `touch` the destination as a sentinel because
# shutil.move / os.rename raises FileExistsError on Windows. Reservations
# are released after the physical move finishes.
_library_placement_lock = threading.Lock()
_reserved_library_paths: set[Path] = set()
# Protects mutable fields on SourceIngestReport when multiple workers append
# results concurrently. CPython's GIL makes list.append individually safe,
# but the lock keeps the invariant explicit and covers non-atomic updates
# to counters and dependent fields.
_report_lock = threading.Lock()


def _pick_and_reserve_library_dest(library: Path, original_name: str) -> Path:
    """Thread-safe: pick a collision-free destination in `library` and
    reserve it until the caller has physically moved the file there.

    The caller MUST call `_release_library_dest(dest)` once the move
    completes (or fails), otherwise the reservation leaks and subsequent
    workers will skip that slot forever.
    """
    with _library_placement_lock:
        base = library / original_name
        if not base.exists() and base not in _reserved_library_paths:
            _reserved_library_paths.add(base)
            return base
        stem = base.stem
        suffix = base.suffix
        i = 2
        while True:
            candidate = library / f"{stem} ({i}){suffix}"
            if not candidate.exists() and candidate not in _reserved_library_paths:
                _reserved_library_paths.add(candidate)
                return candidate
            i += 1


def _release_library_dest(dest: Path) -> None:
    with _library_placement_lock:
        _reserved_library_paths.discard(dest)


@dataclass
class PipelineConfig:
    inbox: Path
    library: Path
    quarantine: Path
    index_db: Path
    anthropic_api_key: Optional[str]
    model: str
    max_output_tokens: int
    eagle_enabled: bool
    eagle_base_url: str
    eagle_folder_id: Optional[str]
    max_tags: int
    dedup: bool
    dry_run: bool
    thumbnails_enabled: bool = True
    thumbnail_max_edge: int = 512


# ---- Helpers ----------------------------------------------------------------


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def phash_file(path: Path) -> str:
    with Image.open(path) as im:
        return str(imagehash.phash(im))


def image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size  # (width, height)


def safe_library_path(library: Path, original_name: str) -> Path:
    """Prevent accidental overwrites by appending a counter on collision."""
    candidate = library / original_name
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    i = 2
    while True:
        c = library / f"{stem} ({i}){suffix}"
        if not c.exists():
            return c
        i += 1


def sidecar_path_for(map_path: Path) -> Path:
    return map_path.with_suffix(map_path.suffix + ".json")


def thumbnail_path_for(map_path: Path) -> Path:
    return map_path.with_suffix(map_path.suffix + ".thumb.jpg")


def write_thumbnail(src: Path, dest: Path, max_edge: int = 512) -> None:
    """Write a jpeg thumbnail at most `max_edge` pixels on its longest side."""
    with Image.open(src) as im:
        im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
        im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        im.save(dest, "JPEG", quality=82, optimize=True)


# ---- Single-file processing -------------------------------------------------


def process_file(
    src: Path,
    cfg: PipelineConfig,
    *,
    tagger: Optional[Callable[[Path], VisionTaggingResult]] = None,
) -> tuple[Path, MapMetadata] | None:
    """Process one file from the inbox. Returns (final_path, metadata) on
    success, None if skipped (duplicate or error)."""

    if src.suffix.lower() not in IMAGE_EXTS:
        log.info("skip non-image: %s", src.name)
        return None

    try:
        sha = sha256_file(src)
        ph = phash_file(src)
        w, h = image_dimensions(src)
    except Exception as e:
        log.exception("failed to inspect %s: %s", src.name, e)
        _quarantine(src, cfg, f"inspect_error: {e}")
        return None

    # Dedup check against existing library
    if cfg.dedup:
        with index_mod.connect(cfg.index_db) as conn:
            if index_mod.hash_exists(conn, sha):
                log.info("duplicate (sha256 match), skipping: %s", src.name)
                return None

    # Call the vision model
    try:
        if tagger is not None:
            result = tagger(src)
        elif cfg.dry_run or not cfg.anthropic_api_key:
            log.info("dry-run: using mock tagger for %s", src.name)
            result = mock_tag_image(src)
        else:
            result = tag_image_with_claude(
                src,
                api_key=cfg.anthropic_api_key,
                model=cfg.model,
                max_output_tokens=cfg.max_output_tokens,
            )
    except VisionError as e:
        log.error("vision failed on %s: %s", src.name, e)
        _quarantine(src, cfg, f"vision_error: {e}")
        return None

    # Decide final filename in library. Under parallel ingest, two workers
    # with same-named source files could race on safe_library_path, so we
    # atomically pick-and-reserve a slot, then release it after the move.
    cfg.library.mkdir(parents=True, exist_ok=True)
    dest = _pick_and_reserve_library_dest(cfg.library, src.name)

    meta = MapMetadata(
        file_name=dest.name,
        file_hash_sha256=sha,
        phash=ph,
        width_px=w,
        height_px=h,
        title=result.title,
        description=result.description,
        biomes=result.biomes,
        location_types=result.location_types,
        interior_exterior=result.interior_exterior,
        time_of_day=result.time_of_day,
        mood=result.mood,
        features=result.features,
        grid_visible=result.grid_visible,
        grid_cells=result.grid_cells,
        approx_party_scale=result.approx_party_scale,
        encounter_hooks=result.encounter_hooks,
        tagged_at=datetime.now(timezone.utc),
        model=cfg.model if not cfg.dry_run else f"mock:{cfg.model}",
    )

    # Move file into place, then write sidecar. Always release the
    # reservation — on success the physical file now exists at `dest`, so
    # a future safe_library_path will see it via the .exists() check; on
    # failure we must release so we don't permanently blacklist the slot.
    try:
        shutil.move(str(src), str(dest))
    except Exception:
        _release_library_dest(dest)
        raise
    _release_library_dest(dest)
    sidecar = sidecar_path_for(dest)
    sidecar.write_text(meta.model_dump_json(indent=2), encoding="utf-8")

    # Generate a compact thumbnail next to the image so downstream consumers
    # (Claude, web UIs) can render matches without loading the full file.
    if cfg.thumbnails_enabled:
        try:
            write_thumbnail(dest, thumbnail_path_for(dest), max_edge=cfg.thumbnail_max_edge)
        except Exception as e:
            log.warning("thumbnail generation failed for %s: %s", dest.name, e)

    # Update search index
    with index_mod.connect(cfg.index_db) as conn:
        index_mod.upsert(conn, meta)

    # Push to Eagle if configured
    if cfg.eagle_enabled:
        try:
            eagle = EagleClient(cfg.eagle_base_url)
            if eagle.is_running():
                eagle.add_from_path(
                    path=dest,
                    name=meta.title,
                    tags=meta.flat_tags(cfg.max_tags),
                    annotation=meta.description
                    + ("\n\nHooks:\n- " + "\n- ".join(meta.encounter_hooks) if meta.encounter_hooks else ""),
                    folder_id=cfg.eagle_folder_id or None,
                )
            else:
                log.warning("Eagle not running; skipping Eagle registration for %s", dest.name)
        except Exception as e:
            log.warning("Eagle registration failed for %s: %s", dest.name, e)

    return dest, meta


def process_inbox(
    cfg: PipelineConfig,
    *,
    limit: Optional[int] = None,
) -> list[tuple[Path, MapMetadata]]:
    """Process files currently in the inbox. If `limit` is set, process at
    most that many attempts (counting both successes and quarantines, so a
    bad file can't cause an infinite loop)."""
    cfg.inbox.mkdir(parents=True, exist_ok=True)
    cfg.library.mkdir(parents=True, exist_ok=True)
    cfg.quarantine.mkdir(parents=True, exist_ok=True)

    results: list[tuple[Path, MapMetadata]] = []
    attempts = 0
    for item in sorted(cfg.inbox.iterdir()):
        if not item.is_file():
            continue
        if limit is not None and attempts >= limit:
            break
        attempts += 1
        r = process_file(item, cfg)
        if r is not None:
            results.append(r)
    return results


# ---- Staged ingest from an external source folder --------------------------


@dataclass
class SourceIngestReport:
    """Summary of a staged ingest run against an external source folder."""
    source: Path
    limit: int
    preview: bool
    total_scanned: int = 0                  # image files seen in source
    already_in_library: int = 0             # hash match against index → skipped
    new_identified: list[Path] = field(default_factory=list)  # source paths that would be / were processed
    successes: list[tuple[Path, MapMetadata]] = field(default_factory=list)  # (library_path, meta)
    quarantined: list[Path] = field(default_factory=list)     # source paths that failed
    hash_errors: list[tuple[Path, str]] = field(default_factory=list)  # couldn't even hash

    @property
    def remaining_after_run(self) -> int:
        """Rough lower bound on how much is left in source after this run.
        Only accurate when the full source has been walked (preview mode).
        In real-run mode we stop scanning after hitting the limit so this
        undercounts — use it as a floor, not a true remaining count."""
        return max(0, self.total_scanned - self.already_in_library - len(self.new_identified))

    def estimated_cost_range(self) -> tuple[float, float]:
        n = len(self.new_identified)
        return (n * COST_PER_MAP_USD_LOW, n * COST_PER_MAP_USD_HIGH)


def _iter_source_images(source: Path, *, recursive: bool) -> list[Path]:
    """Return all image files under `source`, deterministically sorted."""
    if recursive:
        it = source.rglob("*")
    else:
        it = source.glob("*")
    return sorted(
        p for p in it
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


def _load_known_hashes(cfg: PipelineConfig) -> set[str]:
    """Snapshot every SHA-256 currently in the library index. Used to
    skip source files that have already been tagged in a prior run."""
    with index_mod.connect(cfg.index_db) as conn:
        return {row[0] for row in conn.execute("SELECT file_hash_sha256 FROM maps")}


def ingest_from_source(
    cfg: PipelineConfig,
    source: Path,
    *,
    limit: int,
    recursive: bool = True,
    preview: bool = False,
    concurrency: int = 1,
    on_progress: Optional[Callable[[int, int, Path, Optional[MapMetadata]], None]] = None,
) -> SourceIngestReport:
    """Walk `source`, skip files whose SHA-256 is already in the library,
    and process up to `limit` new files.

    In `preview` mode, nothing is copied or tagged — we walk the full source,
    compute hashes, count new vs already-tagged, and return a report so the
    caller can show a cost estimate.

    In normal mode, files are copied (not moved) from `source` into the
    inbox and processed. When `concurrency > 1`, vision calls (and the rest
    of process_file) run in a thread pool of that size — the dominant cost
    is network wait on the Anthropic API, so threading scales near-linearly
    until rate limits bite. The main thread still walks, hashes, dedups,
    and copies into the inbox serially; only process_file runs in workers.
    The source folder is never mutated.

    Progress is reported via `on_progress` as files finish. Under parallel
    mode the order of completion is non-deterministic, but the (done/total)
    counter is monotonic.
    """
    if not source.exists():
        raise FileNotFoundError(f"Source folder not found: {source}")
    if not source.is_dir():
        raise NotADirectoryError(f"Source is not a directory: {source}")
    if limit < 1:
        raise ValueError(f"limit must be >= 1 (got {limit})")
    if concurrency < 1:
        raise ValueError(f"concurrency must be >= 1 (got {concurrency})")

    cfg.inbox.mkdir(parents=True, exist_ok=True)
    cfg.library.mkdir(parents=True, exist_ok=True)
    cfg.quarantine.mkdir(parents=True, exist_ok=True)

    report = SourceIngestReport(source=source, limit=limit, preview=preview)
    known_hashes = _load_known_hashes(cfg) if cfg.dedup else set()

    candidates = _iter_source_images(source, recursive=recursive)
    report.total_scanned = len(candidates)
    log.info(
        "source scan: %d image file(s) under %s (concurrency=%d)",
        len(candidates),
        source,
        concurrency,
    )

    # ---- Preview branch: walk + hash only, no I/O into inbox -------------
    if preview:
        for src in candidates:
            try:
                sha = sha256_file(src)
            except Exception as e:
                log.warning("could not hash %s: %s", src, e)
                report.hash_errors.append((src, str(e)))
                continue
            if cfg.dedup and sha in known_hashes:
                report.already_in_library += 1
                continue
            report.new_identified.append(src)
            known_hashes.add(sha)
            if len(report.new_identified) >= limit:
                break
        return report

    # ---- Real run: stage files into inbox, process (serial or parallel) --
    # The main thread walks the source and stages files into the inbox up
    # to the limit. For concurrency==1, we also process inline as before
    # (keeps the serial path identical for regression safety). For >1 we
    # submit to a ThreadPoolExecutor and drain futures as they complete.

    def _handle_result(src_path: Path, result: Optional[tuple[Path, MapMetadata]]) -> None:
        """Record one finished work item and fire the progress callback.
        Called from the worker thread in parallel mode, from the main
        thread in serial mode."""
        with _report_lock:
            if result is None:
                report.quarantined.append(src_path)
                done = len(report.successes) + len(report.quarantined)
            else:
                report.successes.append(result)
                done = len(report.successes) + len(report.quarantined)
        if on_progress is not None:
            on_progress(done, limit, src_path, result[1] if result else None)

    def _stage_one(src: Path) -> Optional[Path]:
        """Copy one source file into the inbox. Returns the inbox path, or
        None if the copy failed (caller should skip this file)."""
        dest_in_inbox = safe_library_path(cfg.inbox, src.name)
        try:
            shutil.copy2(src, dest_in_inbox)
        except Exception as e:
            log.exception("failed to copy %s to inbox: %s", src, e)
            with _report_lock:
                report.hash_errors.append((src, f"copy_failed: {e}"))
                # we added src to new_identified just above — undo it
                try:
                    report.new_identified.remove(src)
                except ValueError:
                    pass
            return None
        return dest_in_inbox

    if concurrency == 1:
        # Serial path — behavior-identical to pre-parallel code.
        for src in candidates:
            if len(report.new_identified) >= limit:
                break
            try:
                sha = sha256_file(src)
            except Exception as e:
                log.warning("could not hash %s: %s", src, e)
                report.hash_errors.append((src, str(e)))
                continue
            if cfg.dedup and sha in known_hashes:
                report.already_in_library += 1
                continue
            report.new_identified.append(src)
            known_hashes.add(sha)

            dest_in_inbox = _stage_one(src)
            if dest_in_inbox is None:
                continue
            result = process_file(dest_in_inbox, cfg)
            _handle_result(src, result)
        return report

    # Parallel path. The main thread remains the sole walker/hasher/stager
    # and submits each staged file to the executor as soon as it's ready.
    # This interleaves I/O (copy to inbox) with vision calls already in
    # flight, which is exactly what we want on a large library.
    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="map-tagger") as ex:
        futures = {}  # future -> src_path (for logging on failure)
        for src in candidates:
            if len(report.new_identified) >= limit:
                break
            try:
                sha = sha256_file(src)
            except Exception as e:
                log.warning("could not hash %s: %s", src, e)
                report.hash_errors.append((src, str(e)))
                continue
            if cfg.dedup and sha in known_hashes:
                report.already_in_library += 1
                continue
            report.new_identified.append(src)
            known_hashes.add(sha)

            dest_in_inbox = _stage_one(src)
            if dest_in_inbox is None:
                continue

            fut = ex.submit(process_file, dest_in_inbox, cfg)
            futures[fut] = src

        # Drain all in-flight work. We block here because the caller
        # expects a complete report when ingest_from_source returns.
        for fut in as_completed(futures):
            src_path = futures[fut]
            try:
                result = fut.result()
            except Exception as e:
                # process_file caught VisionError internally, so an
                # exception here is a programming error or truly unhandled
                # case. Log and treat as quarantined so the batch doesn't
                # lose progress on other files.
                log.exception("unexpected worker error on %s: %s", src_path.name, e)
                result = None
            _handle_result(src_path, result)

    return report


def _quarantine(src: Path, cfg: PipelineConfig, reason: str) -> None:
    try:
        cfg.quarantine.mkdir(parents=True, exist_ok=True)
        dest = safe_library_path(cfg.quarantine, src.name)
        shutil.move(str(src), str(dest))
        dest.with_suffix(dest.suffix + ".error.txt").write_text(reason, encoding="utf-8")
    except Exception:
        log.exception("failed to quarantine %s", src.name)
