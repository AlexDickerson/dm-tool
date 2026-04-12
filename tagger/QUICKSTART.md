# Quickstart — first run on Windows

This is the minimum path from cloned repo to "I can see it working," without spending any money on Claude tokens. Once this succeeds end-to-end, graduate to real vision calls.

## 0. Prerequisites

- Python 3.11 or newer on PATH (`python --version`)
- (Optional) Eagle installed and running if you want the Eagle push to succeed. If Eagle isn't running, ingest still works — it just logs a warning.

## 1. Install into a local venv

From PowerShell, in this folder (the one containing `pyproject.toml`):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

If PowerShell refuses to run the activation script, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and try again.

## 2. Verify the config

`config.toml` in this folder is already wired up. It uses relative paths that resolve next to the config file, so data lives under `data/` inside this directory. You do not need to edit it for the dry run.

Run the doctor to sanity-check everything:

```powershell
map-tagger doctor
```

Expected output: inbox / library / index_db paths printed, Anthropic key shown as "NOT SET" (fine for now), Eagle shown as "not running" unless you launched Eagle. No exceptions.

## 3. Dry run with the sample maps

Copy the bundled sample maps into the inbox and ingest them with the mock tagger (no API spend):

```powershell
Copy-Item sample\*.png data\inbox\
map-tagger ingest --dry-run
```

You should see five maps processed, each with a title and a handful of mock tags derived from its filename. After this:

- `data\library\` contains the five `.png` files, their `.png.json` sidecars, and `.png.thumb.jpg` thumbnails
- `data\index.sqlite` exists
- `data\inbox\` is empty again

If any file ended up in `data\quarantine\`, open the matching `.error.txt` to see why.

## 4. Search it

```powershell
map-tagger search --biome forest
map-tagger search --location tavern --mood cozy
map-tagger search --keywords "ruined temple"
map-tagger search --biome desert --location market --json
```

The mock tagger's output is crude on purpose — it only cares about keywords in the filename — but it's enough to prove the index, FTS, and filtering are wired up correctly.

## 5. Reset and re-run (optional)

Want to start over? Delete everything under `data\` except the folders themselves:

```powershell
Remove-Item data\library\* -Recurse -Force
Remove-Item data\index.sqlite -Force -ErrorAction SilentlyContinue
Copy-Item sample\*.png data\inbox\
map-tagger ingest --dry-run
```

## 6. Graduate to real tagging

When the dry run is clean:

1. Set your key in PowerShell: `setx ANTHROPIC_API_KEY "sk-ant-..."` — then **close and reopen PowerShell** (setx only affects new shells).
2. Drop a handful of *real* battlemaps (3–5 to start) into `data\inbox\`.
3. Run `map-tagger ingest` (no `--dry-run`). Expected cost: roughly a penny or two total for 3–5 maps.
4. Spot-check the sidecars in `data\library\` — open one in a text editor, confirm the biomes, location types, and description match the image.
5. Search and make sure the tags you'd actually query for are present.

If anything looks off on the real tagger, the place to tune is `src\dnd_map_tagger\vision.py` (the `SYSTEM_PROMPT` and the user prompt template). The controlled vocabulary lives in `src\dnd_map_tagger\schema.py` — add new biomes or location types there and the prompt auto-regenerates its allowed-values block.

## 7. Point it at your real library in stages

Once you trust the tagging quality on a small handful, you're ready to chew through the full collection at `E:\TTRPG\Assets\Maps`. Doing this all at once is a bad idea — it's expensive, slow, and hard to abort. The tool has a staged-source mode that handles this cleanly.

The core idea: `--source` tells the tool where your real library lives, `--limit` caps how many new files it processes per run, and SHA-256 dedup against the library index makes re-running safely resume from wherever you stopped.

### 7a. Preview before spending a cent

```powershell
map-tagger ingest --source E:\TTRPG\Assets\Maps --limit 100 --preview
```

This walks the source folder recursively, hashes every image file, compares against your library, and prints:

```
Preview results
  Image files scanned   : 1847
  Already in library    : 0
  New (would process)   : 100
  Estimated cost        : $0.30 – $1.00  (at $0.003–$0.01/map, informational only)
```

The cost range is the README's published per-map band. Actual spend depends on image size and how chatty Claude is on each map. If you want a full-library estimate rather than a single-batch estimate, bump `--limit` temporarily to something huge like `--limit 99999` — preview stops scanning once it hits the limit.

### 7b. Process the first stage

```powershell
map-tagger ingest --source E:\TTRPG\Assets\Maps --limit 100
```

The tool prints per-file progress as it goes, something like:

```
  [1/100] The Otter's Rest  ←  riverside_tavern_dusk.png
      forest, river_lake, tavern, exterior, dusk, cozy
  [2/100] Mourning Hall     ←  temples\grieving_hall.jpg
      urban, temple, interior, sacred, haunted
  ...
```

When it hits the limit, it stops and prints a summary:

```
Ingest summary
  Scanned in source     : 1847 image file(s)
  Skipped (already done): 0
  Successes             : 98
  Quarantined           : 2
    - E:\TTRPG\Assets\Maps\weird\something.psd
    - E:\TTRPG\Assets\Maps\broken.png
Hit --limit 100. Re-run to process the next batch.
```

### 7c. Review, then keep going

Open a few sidecars in `data\library\`, spot-check that the biomes and descriptions make sense. Try a few searches:

```powershell
map-tagger search --biome forest --location tavern
map-tagger search --keywords "crypt haunted"
```

If the tagging looks good, rerun the exact same command to grab the next 100 files:

```powershell
map-tagger ingest --source E:\TTRPG\Assets\Maps --limit 100
```

Dedup is automatic and hash-based: the first 100 are already in the library, so this run will skip them and process files 101–200. Keep running it until the summary says `Nothing new to do — source is fully tagged.`

### 7d. Things that can go wrong and what to do

**Quarantined files pile up.** Check the `.error.txt` next to each quarantined file. Common causes:
- File extension lies (e.g. `.jpg` that's actually a PSD or TIFF — the tool now sniffs format from bytes, but Anthropic vision only accepts PNG / JPEG / WEBP / GIF, so anything else gets rejected). Fix: convert or delete those files in the source.
- Corrupted PNG headers: Pillow can't even open the file.
- Occasional Anthropic API errors (rate limits, transient 5xx). Fix: just re-run the same command. Quarantine is per-file, so the rest of your batch already succeeded, and the bad file will be retried on the next run because it's no longer in the inbox but also not in the library.

**Wait — will quarantine cause infinite retries?** No. Files in `data\quarantine\` are not re-picked-up by the source scanner (the scanner walks `E:\TTRPG\Assets\Maps`, not the quarantine folder). But because we dedup by hash, the source file stays flagged as "not in library" and will be attempted again on the next run. If a file is genuinely broken and keeps getting quarantined, delete it from the source or move it to a `skip/` subfolder. If you want to truly blacklist a file, manually add its SHA-256 to the maps table — or just delete it.

**You want to stop mid-batch.** Hit Ctrl+C. The current file might end up in an inconsistent state (copied into inbox, partially processed), but the next run will clean it up: inbox leftovers are processed first, and dedup prevents double-work.

**Different source paths over time.** You can run multiple sources — `map-tagger ingest --source E:\TTRPG\Assets\Maps --limit 100` then `map-tagger ingest --source D:\Downloads\NewMegapack --limit 50`. Everything ends up in the same library under `data\library\`, and dedup is library-wide.

### 7e. Switch to absolute data paths (optional)

Up to here your `data\library\` is inside the tool directory. That's fine, but for a big collection you probably want it on a drive with more headroom. Edit `config.toml`:

```toml
[paths]
inbox      = 'E:\TTRPG\Assets\Maps\_inbox'
library    = 'E:\TTRPG\Assets\Maps\_library'
quarantine = 'E:\TTRPG\Assets\Maps\_quarantine'
index_db   = 'E:\TTRPG\Assets\Maps\_index.sqlite'
```

Absolute paths override the "resolve relative to config" behavior. **Important:** if you do this, the source folder and the library folder can be the same parent directory — just use underscore-prefixed subfolders or any other naming convention that the source scanner won't re-walk. Because `--source E:\TTRPG\Assets\Maps` would recursively find the files inside `_library`, which is a problem: the scanner would try to re-process everything you just processed, and dedup would skip them but it'd still hash every file on every run, which is slow.

**Cleaner option:** put `_library` outside the source. For example, keep the source at `E:\TTRPG\Assets\Maps\` and put the library at `E:\TTRPG\MapLibrary\`:

```toml
[paths]
inbox      = 'E:\TTRPG\MapLibrary\inbox'
library    = 'E:\TTRPG\MapLibrary\library'
quarantine = 'E:\TTRPG\MapLibrary\quarantine'
index_db   = 'E:\TTRPG\MapLibrary\index.sqlite'
```

Then the source scan only sees your original map collection, not your tagged output.

### 7f. After the library is fully tagged

When `map-tagger ingest --source ... --limit 100` reports `Nothing new to do`, you're done with intake. Going forward:

- New maps: drop into `inbox\` or re-run the source command (the scanner will find only the new ones).
- Want to re-tag with a better prompt? Delete the sidecars and `index.sqlite`, then re-run — every file gets reprocessed fresh. Cost is the same as the initial run.
- Want to re-tag just one map? Delete its `.json` sidecar and its row in the index, then drop the image back into inbox.

## 8. Hook up Eagle and MCP (optional, do later)

Eagle integration is on by default but only fires if Eagle is actually running. If you want a specific Eagle folder for tagged maps, grab its folder ID (right-click → Copy Folder ID) and paste into `[eagle].folder_id` in `config.toml`.

The MCP server that lets Claude query the library is a separate install:

```powershell
pip install -e ".[mcp]"
map-tagger serve-mcp
```

See the main `README.md` for the Claude Desktop config snippet.

## Troubleshooting

**`ModuleNotFoundError: No module named 'dnd_map_tagger'`** — you skipped `pip install -e .`, or you're running outside the venv. `.\.venv\Scripts\Activate.ps1` again.

**`FileNotFoundError: Config file not found: config.toml`** — you're running `map-tagger` from a directory that isn't this one. Either `cd` here first, or pass `-c C:\full\path\to\config.toml`.

**Ingest says "duplicate, skipping" on every file** — you ran it twice and dedup is catching the second run. Delete `data\library\*` and `data\index.sqlite` and try again, or drop fresh files in.

**All five sample maps quarantined** — check the `.error.txt` files. Most likely a Pillow decode error, which would mean something went wrong with the sample images themselves (they're generated as plain PNGs, so this should not happen).
