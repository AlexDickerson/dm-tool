# dnd-map-tagger

Drop a battlemap into an inbox folder. The tool sends it to Claude vision, gets back structured tags for biome, location type, mood, and mechanics, writes a portable JSON sidecar next to the image, indexes it in SQLite for fast search, and pushes the tags into Eagle so you can browse visually. Rebuilding your D&D map library from scratch with this as the intake step means every new map is searchable the moment you save it.

## Design in one paragraph

JSON sidecars are the canonical source of truth. Every map in `library/` has a `<filename>.json` next to it containing the full metadata record. A SQLite index (`index.sqlite`) is layered on top purely for fast search, and is fully rebuildable from the sidecars at any time via `map-tagger reindex`. Eagle is the browsing front-end; the intake script pushes each map into Eagle via its local HTTP API at `http://localhost:41595` with tags and a description annotation. Nothing is locked into Eagle — if you ever swap front-ends, the sidecars come with you.

## Install

Requires Python 3.11+.

```powershell
# from the folder containing pyproject.toml
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .

# Optional: MCP server extras (needed only if you want Claude Desktop /
# Cowork to query the library as a native tool)
pip install -e ".[mcp]"
```

You'll also want Eagle installed and running (https://eagle.cool). Eagle exposes an unauthenticated HTTP API on `localhost:41595` that this tool uses to push tagged items straight into your Eagle library.

## Configure

1. Copy `config.example.toml` to `config.toml`.
2. Edit the `[paths]` section so `inbox`, `library`, `quarantine`, and `index_db` live where you want on your machine. Defaults target `C:\RPG\Maps\*`.
3. Set your Anthropic API key, either as an environment variable:
   ```powershell
   setx ANTHROPIC_API_KEY "sk-ant-..."
   ```
   or by uncommenting `api_key = '...'` under `[anthropic]` in `config.toml`. The env var wins if both are set.
4. If you want Eagle to put items into a specific folder, right-click the folder in Eagle → Copy Folder ID, and paste it into `[eagle].folder_id`.

Run `map-tagger doctor` to verify the config, API key, and Eagle connection before spending any tokens.

## Daily use

**Add new maps:** drop any number of `.png / .jpg / .webp / .gif` files into the `inbox` folder, then run:

```powershell
map-tagger ingest
```

The tool processes everything in `inbox`, calls Claude on each file, writes the sidecar, moves the file into `library`, updates the index, and registers it with Eagle. Duplicates (same SHA-256) are skipped automatically. Files that fail vision or inspection land in `quarantine` with an `.error.txt` describing why.

**Dry run (no API spend):**

```powershell
map-tagger ingest --dry-run
```

Uses a deterministic mock tagger that guesses tags from filename keywords. Useful for testing that file movement, Eagle push, and the index work before you point real money at your whole library.

**Search from the terminal:**

```powershell
map-tagger search --biome forest --location tavern --mood cozy
map-tagger search --keywords "riverside night"
map-tagger search --biome underground --location cave --interior interior
map-tagger search --biome forest --mood cozy --json   # machine-readable
```

Filters AND together. `--keywords` runs against the FTS5 virtual table over title, description, and features. `--json` dumps the full sidecar records for each hit so other tools (or Claude) can parse them. Full vocabulary for biomes and location types lives in `src/dnd_map_tagger/schema.py`, and `SEARCH_GUIDE.md` has idiomatic query patterns.

**Rebuild the index** after, say, hand-editing some sidecars:

```powershell
map-tagger reindex
```

Wipes the SQLite index and re-reads every `*.json` in `library/`. Safe to run anytime — the sidecars are the source of truth.

## What the sidecars look like

```json
{
  "file_name": "Riverside Tavern at Dusk.png",
  "file_hash_sha256": "b2c1...",
  "phash": "ffee...",
  "width_px": 2048,
  "height_px": 1536,
  "title": "The Otter's Rest",
  "description": "A cozy half-timbered tavern perched over a slow river, warm light spilling from its windows as dusk settles.",
  "biomes": ["river_lake", "rural"],
  "location_types": ["tavern"],
  "interior_exterior": "exterior",
  "time_of_day": "dusk",
  "mood": ["cozy", "serene"],
  "features": ["wooden dock", "small rowboat", "river bisects the map"],
  "grid_visible": "gridded",
  "grid_cells": "28x20",
  "approx_party_scale": "small",
  "encounter_hooks": [
    "The party arrives to find the tavern oddly silent, with a half-eaten meal on every table.",
    "A smuggler ties up at the dock and slips a package to the innkeeper."
  ],
  "tagged_at": "2026-04-10T18:32:11.000000",
  "model": "claude-sonnet-4-6",
  "schema_version": 1
}
```

## Searching from Claude (MCP server)

The package ships an optional MCP server that exposes the library to Claude Desktop and Cowork as a set of native tools: `search_maps`, `get_map_details`, `get_map_thumbnail`, `list_vocabulary`, and `library_stats`. Once it's registered, Claude can run structured searches over your library during a chat and even view the matched thumbnails inline.

**Install the extras and run the doctor once:**

```powershell
pip install -e ".[mcp]"
map-tagger doctor
```

**Register the server with Claude Desktop.** Add this to your `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "dnd-map-tagger": {
      "command": "C:\\path\\to\\dnd-map-tagger\\.venv\\Scripts\\python.exe",
      "args": ["-m", "dnd_map_tagger.mcp_server", "--config", "C:\\path\\to\\dnd-map-tagger\\config.toml"]
    }
  }
}
```

Adjust the paths to match your install location. Restart Claude Desktop and you should see `dnd-map-tagger` appear in the MCP tools list. Cowork's config lives under its own MCP settings but takes the same shape.

**Teach Claude how to query well.** The library ships with `SEARCH_GUIDE.md`, a short document that explains the controlled vocabulary and idiomatic query patterns. When the MCP server is running, Claude can fetch it as the `maplib://guide` resource. In practice, linking to this file in any chat where you're using the library is the single highest-leverage thing you can do to improve search quality — it stops Claude from inventing tag names that don't exist.

**Example chat:**

> *You:* "I need a cozy riverside tavern at dusk, on the edge of a forest. Show me thumbnails of the top 3."
>
> *Claude calls:* `search_maps(biomes=["forest", "river_lake"], location_types=["tavern"], mood=["cozy"], time_of_day="dusk", limit=5)`
> *then:* `get_map_thumbnail("The Otter's Rest.png")` × 3

## Cost notes

Claude vision calls for this use case typically come in at roughly $0.003–$0.01 per map depending on image size and output length. Tagging a freshly rebuilt 1,000-map library is a few dollars total; incremental tagging of new maps after that is effectively free. Use `--dry-run` liberally while you're tuning things.

## Extending

The controlled vocabularies for biomes and location types live in `schema.py`. Add or remove enum members there and the vision prompt auto-regenerates its allowed-value list. You can also change the prompt itself in `vision.py` if you want Claude to pay attention to something specific to your campaign (e.g., "flag any location that could pass for a Curse of Strahd set piece").

Foundry VTT integration is deliberately out of scope for v0.1. The sidecars are already in a format that a future Foundry module could read directly; that's a good v0.2 once the intake flow is proven.

## File layout

```
dnd-map-tagger/
├── pyproject.toml
├── config.example.toml          # copy to config.toml and edit
├── README.md
├── SEARCH_GUIDE.md              # vocabulary + query patterns, for Claude
└── src/dnd_map_tagger/
    ├── __init__.py
    ├── schema.py                # Pydantic models + controlled vocab
    ├── vision.py                # Claude API call + mock tagger
    ├── index.py                 # SQLite schema, upsert, search, reindex
    ├── eagle.py                 # Eagle HTTP API client
    ├── pipeline.py              # Intake: inbox -> library + sidecar + thumb + index + Eagle
    ├── config.py                # TOML config loader
    ├── cli.py                   # `map-tagger` commands
    └── mcp_server.py            # FastMCP server exposing search_maps etc.
```
