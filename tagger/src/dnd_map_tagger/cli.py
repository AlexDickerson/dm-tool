"""Command-line interface: `map-tagger ingest | search | reindex | doctor | serve-mcp`."""

from __future__ import annotations

import json as _json
import logging
import sys as _sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from . import index as index_mod
from .config import load as load_config
from .eagle import EagleClient
from .pipeline import (
    COST_PER_MAP_USD_HIGH,
    COST_PER_MAP_USD_LOW,
    ingest_from_source,
    process_inbox,
)

app = typer.Typer(add_completion=False, help="Auto-tag D&D battlemaps with Claude and index them.")
console = Console()

DEFAULT_CONFIG = Path("config.toml")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


@app.command()
def ingest(
    config: Path = typer.Option(DEFAULT_CONFIG, "--config", "-c"),
    source: Optional[Path] = typer.Option(
        None,
        "--source",
        "-s",
        help="Optional source folder to stage from (e.g. E:\\TTRPG\\Assets\\Maps). "
             "When set, the tool walks the source, skips anything already in the "
             "library (by SHA-256), copies the next --limit new files into the "
             "inbox, and processes them. Source folder is never mutated.",
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit",
        "-n",
        help="Max new files to process this run. Required when --source is set. "
             "Without --source, caps how many inbox files are processed.",
    ),
    recursive: bool = typer.Option(
        True,
        "--recursive/--flat",
        help="When --source is set, walk subfolders (default) or only top level.",
    ),
    preview: bool = typer.Option(
        False,
        "--preview",
        help="With --source: walk the source, count new vs already-tagged, print "
             "a cost estimate, exit without calling the API. No files are copied.",
    ),
    concurrency: int = typer.Option(
        4,
        "--concurrency",
        "-j",
        min=1,
        max=1000,
        help="Number of parallel vision-call workers. Default 4 is safe on the "
             "Anthropic entry-level tier (~50 RPM). Bump higher if your account "
             "has headroom. Use -j 1 for fully serial processing. The true "
             "ceiling is your Anthropic TPM budget, not this cap.",
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="Use mock tagger, skip API spend"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Process files from the inbox, or stage from an external source folder.

    Two modes:

    \b
    1. Inbox mode (default): `map-tagger ingest`
       Process everything in the inbox. Add `--limit N` to cap the run.

    \b
    2. Staged source mode: `map-tagger ingest --source <dir> --limit 50`
       Walk <dir>, skip files already in the library (SHA-256 match), copy
       up to 50 new files into the inbox, process them, stop. Re-run to
       pick up where you left off — dedup makes resume automatic.

    \b
       Add --preview to estimate cost without spending tokens:
         map-tagger ingest --source E:\\TTRPG\\Assets\\Maps --limit 50 --preview
    """
    _setup_logging(verbose)

    if preview and source is None:
        console.print("[red]--preview requires --source. It's a source-only mode.[/red]")
        raise typer.Exit(code=2)
    if source is not None and limit is None:
        console.print(
            "[red]--source requires --limit. "
            "Staged ingest needs a batch size so you don't accidentally process the whole folder.[/red]"
        )
        raise typer.Exit(code=2)

    cfg = load_config(config, dry_run=dry_run)
    if not cfg.dry_run and not cfg.anthropic_api_key and not preview:
        console.print(
            "[red]No ANTHROPIC_API_KEY set and no api_key in config. "
            "Use --dry-run to test without spending, or --preview to estimate "
            "cost without calling the API.[/red]"
        )
        raise typer.Exit(code=2)

    if source is not None:
        _ingest_from_source_cmd(
            cfg=cfg,
            source=source,
            limit=limit or 0,
            recursive=recursive,
            preview=preview,
            concurrency=concurrency,
        )
        return

    results = process_inbox(cfg, limit=limit)
    console.print(f"[green]Processed {len(results)} map(s).[/green]")
    for path, meta in results:
        console.print(f"  [bold]{meta.title}[/bold]  →  {path.name}")
        tags = meta.flat_tags(cfg.max_tags)
        if tags:
            console.print(f"    tags: {', '.join(tags)}")


def _ingest_from_source_cmd(
    *,
    cfg,
    source: Path,
    limit: int,
    recursive: bool,
    preview: bool,
    concurrency: int = 1,
) -> None:
    """Helper for the `--source` branch of `ingest`. Prints per-file progress
    and a final summary."""
    def on_progress(done: int, total: int, src_path: Path, meta) -> None:
        # Machine-readable progress marker for UI consumers (dm-tool parses
        # this to drive its progress bar). Format is deliberately terse and
        # stable:
        #   ##PROGRESS {done}/{total} {OK|FAIL} {filename}
        # Filename is the last whitespace-delimited token and may contain
        # spaces if a source file has them — consumers should parse from the
        # right. Emit before the pretty line and flush so the UI ticks even
        # if rich buffers its own output.
        status = "FAIL" if meta is None else "OK"
        _sys.stdout.write(f"##PROGRESS {done}/{total} {status} {src_path.name}\n")
        _sys.stdout.flush()

        if meta is None:
            console.print(f"  [{done}/{total}] [red]quarantined[/red] {src_path.name}")
        else:
            tag_preview = ", ".join(meta.flat_tags(6)) or "(no tags)"
            console.print(
                f"  [{done}/{total}] [bold]{meta.title}[/bold]  ←  {src_path.name}\n"
                f"      [dim]{tag_preview}[/dim]"
            )

    if preview:
        console.print(
            f"[cyan]Previewing source:[/cyan] {source}"
            f"  [dim](recursive={recursive}, limit={limit})[/dim]"
        )
    else:
        console.print(
            f"[cyan]Staged ingest from:[/cyan] {source}"
            f"  [dim](recursive={recursive}, limit={limit}, concurrency={concurrency})[/dim]"
        )

    try:
        report = ingest_from_source(
            cfg,
            source,
            limit=limit,
            recursive=recursive,
            preview=preview,
            concurrency=concurrency,
            on_progress=None if preview else on_progress,
        )
    except (FileNotFoundError, NotADirectoryError) as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2)

    n_new = len(report.new_identified)
    low, high = report.estimated_cost_range()

    if preview:
        console.print()
        console.print(f"[bold]Preview results[/bold]")
        console.print(f"  Image files scanned   : {report.total_scanned}")
        console.print(f"  Already in library    : {report.already_in_library}")
        console.print(f"  New (would process)   : {n_new}")
        if report.hash_errors:
            console.print(f"  Unreadable files      : {len(report.hash_errors)}")
        console.print(
            f"  Estimated cost        : [bold]${low:.2f} – ${high:.2f}[/bold]  "
            f"[dim](at $0.003–$0.01/map, informational only)[/dim]"
        )
        if n_new >= limit:
            console.print(
                f"[yellow]Note:[/yellow] hit --limit {limit}. Source may contain more "
                f"untagged files beyond this batch."
            )
        console.print()
        console.print("Run without --preview to process this batch.")
        return

    # Real-run summary
    console.print()
    console.print("[bold]Ingest summary[/bold]")
    console.print(f"  Scanned in source     : {report.total_scanned} image file(s)")
    console.print(f"  Skipped (already done): {report.already_in_library}")
    console.print(f"  Successes             : [green]{len(report.successes)}[/green]")
    if report.quarantined:
        console.print(f"  Quarantined           : [red]{len(report.quarantined)}[/red]")
        for p in report.quarantined:
            console.print(f"    - {p}")
    if report.hash_errors:
        console.print(f"  Unreadable (hash fail): {len(report.hash_errors)}")
    if n_new >= limit:
        console.print(
            f"[yellow]Hit --limit {limit}. Re-run to process the next batch.[/yellow]"
        )
    elif n_new == 0:
        console.print("[green]Nothing new to do — source is fully tagged.[/green]")
    else:
        console.print(
            f"[green]Source exhausted for this run "
            f"({n_new} new files processed, below --limit {limit}).[/green]"
        )


@app.command()
def reindex(
    config: Path = typer.Option(DEFAULT_CONFIG, "--config", "-c"),
) -> None:
    """Rebuild the SQLite index from the JSON sidecars in library/."""
    cfg = load_config(config)
    with index_mod.connect(cfg.index_db) as conn:
        n = index_mod.rebuild_from_sidecars(conn, cfg.library)
    console.print(f"[green]Reindexed {n} map(s) from sidecars in {cfg.library}[/green]")


@app.command()
def search(
    config: Path = typer.Option(DEFAULT_CONFIG, "--config", "-c"),
    keywords: str = typer.Option("", "--keywords", "-k", help="Full-text search over title/description/features"),
    biome: list[str] = typer.Option([], "--biome", "-b"),
    location: list[str] = typer.Option([], "--location", "-l"),
    mood: list[str] = typer.Option([], "--mood", "-m"),
    feature: list[str] = typer.Option([], "--feature", "-f"),
    interior: str = typer.Option("", "--interior", help="interior | exterior | mixed"),
    time_of_day: str = typer.Option("", "--time", help="day | dusk | night | dawn"),
    grid: str = typer.Option("", "--grid", help="gridded | gridless"),
    limit: int = typer.Option(25, "--limit"),
    as_json: bool = typer.Option(False, "--json", help="Emit results as a JSON array on stdout (machine-readable)"),
) -> None:
    """Search the index. All filters AND together."""
    cfg = load_config(config)
    with index_mod.connect(cfg.index_db) as conn:
        rows = index_mod.search(
            conn,
            keywords=keywords or None,
            biomes=biome,
            location_types=location,
            mood=mood,
            features=feature,
            interior_exterior=interior or None,
            time_of_day=time_of_day or None,
            grid_visible=grid or None,
            limit=limit,
        )

    if as_json:
        # Machine-readable path for Claude / MCP / scripts. We hydrate the
        # sidecar JSON so callers get the full tag set per result, not just
        # the denormalised columns stored on `maps`.
        import json as _jsn
        out = []
        for r in rows:
            sidecar = _jsn.loads(r.pop("sidecar_json"))
            sidecar["_library_path"] = str(cfg.library / r["file_name"])
            out.append(sidecar)
        typer.echo(_jsn.dumps(out, indent=2))
        return

    if not rows:
        console.print("[yellow]No matches.[/yellow]")
        return

    table = Table(show_lines=False)
    table.add_column("File", style="cyan", overflow="fold")
    table.add_column("Title", style="bold")
    table.add_column("Description", overflow="fold")
    for r in rows:
        table.add_row(r["file_name"], r["title"], r["description"])
    console.print(table)
    console.print(f"[dim]{len(rows)} result(s)[/dim]")


@app.command("serve-mcp")
def serve_mcp(
    config: Path = typer.Option(DEFAULT_CONFIG, "--config", "-c"),
) -> None:
    """Start the MCP server so Claude Desktop / Cowork can query the library."""
    from .mcp_server import build_server

    cfg = load_config(config)
    server = build_server(cfg)
    server.run()


@app.command()
def doctor(
    config: Path = typer.Option(DEFAULT_CONFIG, "--config", "-c"),
) -> None:
    """Check that config paths exist, Anthropic key is set, and Eagle is reachable."""
    cfg = load_config(config)
    console.print(f"Config file     : [cyan]{config}[/cyan]")
    console.print(f"Inbox           : {cfg.inbox} {'✓' if cfg.inbox.exists() else '✗ (will be created on ingest)'}")
    console.print(f"Library         : {cfg.library} {'✓' if cfg.library.exists() else '✗ (will be created on ingest)'}")
    console.print(f"Index DB        : {cfg.index_db}")
    console.print(f"Anthropic key   : {'set' if cfg.anthropic_api_key else '[red]NOT SET[/red]'}")
    console.print(f"Model           : {cfg.model}")
    if cfg.eagle_enabled:
        eagle = EagleClient(cfg.eagle_base_url)
        running = eagle.is_running()
        status = "[green]running[/green]" if running else "[red]not running[/red]"
        console.print(f"Eagle @ {cfg.eagle_base_url} : {status}")
        if cfg.eagle_folder_id:
            console.print(f"Eagle folder ID : [cyan]{cfg.eagle_folder_id}[/cyan]")
            console.print(
                "[dim]  (items will be added to this folder. Verify by doing a test "
                "ingest and checking that folder in Eagle.)[/dim]"
            )
        else:
            console.print(
                "Eagle folder ID : [yellow]not set[/yellow]  "
                "[dim](items will land at the Eagle library root)[/dim]"
            )
    else:
        console.print("Eagle           : disabled in config")


if __name__ == "__main__":
    app()
