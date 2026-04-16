import { ipcMain, shell, dialog, app } from 'electron';
import { join, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { DmToolConfig } from '../config.js';
import { listGlobePins, upsertGlobePin, deleteGlobePin } from '../pf2e-db.js';
import type { GlobePin, GlobeDeployProgress, GlobeDeployResult, MissionData } from '../../shared/types.js';
import { missionNoteTemplate, parseMissionNote, splitFrontmatter } from '../mission-parser.js';

/** Defaults for config fields the user rarely overrides. */
const DEFAULT_DEPLOY_HOST = 'alex@server.ad';
const DEFAULT_DEPLOY_PATH = '~/player-map';
const DEFAULT_PUBLIC_URL = 'http://server.ad:30002';

/** Sanitise a string for use as a filename — strip characters illegal on
 *  Windows/macOS and collapse whitespace. */
function safeFileName(raw: string): string {
  // Strip characters illegal in Windows/macOS filenames and control chars
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled'
  );
}

/** Recursively scan .md files under a directory for one whose YAML
 *  frontmatter contains `pin-id: <id>`. Skips hidden directories (.obsidian,
 *  .git, etc). Returns the absolute path if found, or null. */
function findNoteByPinId(root: string, pinId: string): string | null {
  if (!existsSync(root)) return null;
  const needle = `pin-id: ${pinId}`;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue; // skip .obsidian, .git, etc
      const fp = join(dir, entry);
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(fp);
      } else if (entry.endsWith('.md')) {
        try {
          const head = readFileSync(fp, { encoding: 'utf-8', flag: 'r' }).slice(0, 512);
          if (head.includes(needle)) return fp;
        } catch {
          /* unreadable — skip */
        }
      }
    }
  }
  return null;
}

/** Ensure a note's YAML frontmatter contains `pin-id: <id>`. If the file
 *  has no frontmatter, prepend one. If it already has frontmatter, add or
 *  replace the `pin-id` line. Returns the updated content. */
function stampPinId(raw: string, pinId: string, kind: 'note' | 'mission'): string {
  const [fm, body] = splitFrontmatter(raw);
  if (fm === null) {
    // No frontmatter — prepend one
    return `---\npin-id: ${pinId}\nkind: ${kind}\n---\n\n${raw}`;
  }

  const lines = fm.split(/\r?\n/);
  let hasPinId = false;
  const updated = lines.map((line) => {
    if (/^pin-id\s*:/.test(line)) {
      hasPinId = true;
      return `pin-id: ${pinId}`;
    }
    return line;
  });
  if (!hasPinId) updated.unshift(`pin-id: ${pinId}`);

  return `---\n${updated.join('\n')}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

export function registerGlobeHandlers(cfg: DmToolConfig, getMainWindow: () => Electron.BrowserWindow | null): void {
  const hasPf2eDb = (): boolean => !!cfg.pf2eDbPath;

  /** Collect every pin and, for mission pins with an Obsidian vault
   *  configured, inline the parsed MissionData (minus dmNotes — players
   *  don't get to see those). Shared by the Export and Deploy flows. */
  async function buildExportPayload(): Promise<{ exportedAt: string; pins: GlobePin[] }> {
    const pins = listGlobePins();
    const exportPins = await Promise.all(
      pins.map(async (pin): Promise<GlobePin> => {
        // Strip `note` — the player-map never opens Obsidian files, and the
        // vault-relative path leaks DM filesystem structure. Replaced with
        // an empty string to satisfy the shared type.
        const out: GlobePin = {
          id: pin.id,
          lng: pin.lng,
          lat: pin.lat,
          label: pin.label,
          icon: pin.icon,
          zoom: pin.zoom,
          note: '',
          kind: pin.kind,
        };

        if (pin.kind === 'mission' && cfg.obsidianVaultPath) {
          let filePath: string | null = null;
          if (pin.note) {
            const cached = join(cfg.obsidianVaultPath, pin.note);
            if (existsSync(cached)) filePath = cached;
          }
          if (!filePath) {
            const notesDir = join(cfg.obsidianVaultPath, 'Golarion');
            filePath = findNoteByPinId(notesDir, pin.id);
          }
          if (filePath) {
            try {
              const raw = await readFile(filePath, 'utf-8');
              const mission = parseMissionNote(raw, pin.label || 'Mission');
              const { dmNotes: _dmNotes, ...playerSafe } = mission;
              out.mission = playerSafe as MissionData;
            } catch {
              /* note unreadable — skip mission data */
            }
          }
        }

        return out;
      }),
    );
    return { exportedAt: new Date().toISOString(), pins: exportPins };
  }

  ipcMain.handle('globePinsList', () => {
    if (!hasPf2eDb()) return [];
    return listGlobePins();
  });

  ipcMain.handle('globePinsUpsert', (_e, pin: GlobePin) => {
    if (!hasPf2eDb()) return;
    upsertGlobePin(pin);
  });

  ipcMain.handle('globePinsDelete', (_e, id: string) => {
    if (!hasPf2eDb()) return;
    deleteGlobePin(id);
  });

  ipcMain.handle('globePinOpenNote', async (_e, pin: GlobePin): Promise<boolean> => {
    if (!cfg.obsidianVaultPath) return false;

    const notesDir = join(cfg.obsidianVaultPath, 'Golarion');
    if (!existsSync(notesDir)) await mkdir(notesDir, { recursive: true });

    let filePath: string | null = null;

    // 1. Check cached path
    if (pin.note) {
      const cached = join(cfg.obsidianVaultPath, pin.note);
      if (existsSync(cached)) filePath = cached;
    }

    // 2. Cache miss (file renamed/moved) — scan by frontmatter pin-id
    if (!filePath) {
      filePath = findNoteByPinId(notesDir, pin.id);
      if (filePath) {
        // Update the cache
        pin.note = relative(cfg.obsidianVaultPath, filePath).replace(/\\/g, '/');
        upsertGlobePin(pin);
      }
    }

    // 3. No note exists yet — create one
    if (!filePath) {
      const label = pin.label || (pin.kind === 'mission' ? 'New Mission' : 'Untitled Pin');
      const fileName = `${safeFileName(label)} ${pin.id.slice(0, 8)}.md`;
      filePath = join(notesDir, fileName);

      const content =
        pin.kind === 'mission'
          ? missionNoteTemplate(pin.id, label, pin.lat, pin.lng)
          : [
              '---',
              `pin-id: ${pin.id}`,
              'kind: note',
              '---',
              '',
              `# ${label}`,
              '',
              `Coordinates: ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`,
              '',
            ].join('\n');
      await writeFile(filePath, content, 'utf-8');

      pin.note = `Golarion/${fileName}`;
      upsertGlobePin(pin);
    }

    const uri = `obsidian://open?path=${encodeURIComponent(filePath)}`;
    await shell.openExternal(uri);
    return true;
  });

  /** Load and parse a mission pin's Obsidian note into structured MissionData.
   *  Creates the note from a template if it doesn't exist yet. */
  ipcMain.handle('globePinGetMission', async (_e, pin: GlobePin): Promise<MissionData | null> => {
    if (!cfg.obsidianVaultPath) return null;

    const notesDir = join(cfg.obsidianVaultPath, 'Golarion');
    if (!existsSync(notesDir)) await mkdir(notesDir, { recursive: true });

    // Resolve the note path using the same cache → scan → create fallback chain
    let filePath: string | null = null;

    if (pin.note) {
      const cached = join(cfg.obsidianVaultPath, pin.note);
      if (existsSync(cached)) filePath = cached;
    }

    if (!filePath) {
      filePath = findNoteByPinId(notesDir, pin.id);
      if (filePath) {
        pin.note = relative(cfg.obsidianVaultPath, filePath).replace(/\\/g, '/');
        upsertGlobePin(pin);
      }
    }

    if (!filePath) {
      const label = pin.label || 'New Mission';
      const fileName = `${safeFileName(label)} ${pin.id.slice(0, 8)}.md`;
      filePath = join(notesDir, fileName);
      await writeFile(filePath, missionNoteTemplate(pin.id, label, pin.lat, pin.lng), 'utf-8');
      pin.note = `Golarion/${fileName}`;
      upsertGlobePin(pin);
    }

    const raw = await readFile(filePath, 'utf-8');
    return parseMissionNote(raw, pin.label || 'Mission');
  });

  /** Associate a pin with an existing Obsidian note chosen via file picker.
   *  Stamps the pin's id into the selected note's frontmatter so rename-
   *  resilient lookup still works, then updates the pin's cached note path.
   *  Returns the updated pin, or null if the user cancelled. */
  ipcMain.handle('globePinLinkNote', async (_e, pin: GlobePin): Promise<GlobePin | null> => {
    if (!cfg.obsidianVaultPath) return null;

    const result = await dialog.showOpenDialog({
      title: `Link note to "${pin.label || 'pin'}"`,
      defaultPath: cfg.obsidianVaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];

    // Safety: must be inside the vault so Obsidian can open it and the
    // relative path we store is meaningful.
    const rel = relative(cfg.obsidianVaultPath, filePath);
    if (!rel || rel.startsWith('..')) {
      // Not under the vault root — reject.
      return null;
    }

    // Stamp the pin id into the file's frontmatter so the scan-by-pin-id
    // fallback continues to find it after future renames.
    const raw = await readFile(filePath, 'utf-8');
    const stamped = stampPinId(raw, pin.id, pin.kind);
    if (stamped !== raw) {
      await writeFile(filePath, stamped, 'utf-8');
    }

    pin.note = rel.replace(/\\/g, '/');
    upsertGlobePin(pin);
    return pin;
  });

  /** Export all pins (with parsed mission data) to a JSON file chosen by
   *  the user. The exported file is designed to be dropped into the
   *  player-map static site as data.json. */
  ipcMain.handle('globeExportPlayerData', async (): Promise<boolean> => {
    const payload = await buildExportPayload();

    const result = await dialog.showSaveDialog({
      title: 'Export Player Map Data',
      defaultPath: 'data.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;

    await writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  });

  /** Full end-to-end deploy of the player-facing globe:
   *    1. Export pin + mission data
   *    2. Write data.json into player-map/
   *    3. Build the player-map SPA if dist/ is missing or stale
   *    4. SCP artifacts to the configured host (mkdir -p first)
   *    5. Run `docker compose up -d` on the host
   *  Progress streams to the renderer via the 'globe-deploy-progress' event.
   */
  ipcMain.handle('globeDeployPlayer', async (): Promise<GlobeDeployResult> => {
    const host = cfg.playerMapDeployHost ?? DEFAULT_DEPLOY_HOST;
    const remotePath = cfg.playerMapDeployPath ?? DEFAULT_DEPLOY_PATH;
    const publicUrl = cfg.playerMapPublicUrl ?? DEFAULT_PUBLIC_URL;

    const sendProgress = (p: GlobeDeployProgress): void => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('globe-deploy-progress', p);
    };

    try {
      // 1. Locate player-map source dir. In dev: <cwd>/player-map. In a
      //    packaged app the dir isn't bundled — fail with a clear message.
      const projectRoot = app.isPackaged ? app.getAppPath() : process.cwd();
      const playerMapDir = join(projectRoot, 'player-map');
      if (!existsSync(playerMapDir)) {
        return {
          ok: false,
          error: `player-map directory not found at ${playerMapDir}. Deploy is only supported when running from source.`,
        };
      }

      // 2. Build the payload and write data.json into player-map/.
      sendProgress({ stage: 'export', message: 'Collecting pins and mission notes...' });
      const payload = await buildExportPayload();

      sendProgress({ stage: 'write', message: 'Writing data.json...' });
      const dataJsonPath = join(playerMapDir, 'data.json');
      await writeFile(dataJsonPath, JSON.stringify(payload, null, 2), 'utf-8');

      // 3. Ensure deps + a fresh build. Skip the build if dist/ is newer
      //    than every source file — Vite is fast but even fast is slower
      //    than not running it at all, and most deploys are data-only.
      const nodeModulesDir = join(playerMapDir, 'node_modules');
      if (!existsSync(nodeModulesDir)) {
        sendProgress({ stage: 'install', message: 'Installing player-map dependencies (first run only)...' });
        await runCmd('npm', ['install'], playerMapDir);
      }

      if (needsRebuild(playerMapDir)) {
        sendProgress({ stage: 'build', message: 'Building player-map...' });
        await runCmd('npm', ['run', 'build'], playerMapDir);
      }

      // 4. Ensure remote dir exists, then SCP the artifacts the container
      //    bind-mounts (dist, nginx.conf, deploy-compose.yml, data.json).
      sendProgress({ stage: 'mkdir', message: `Preparing ${host}:${remotePath}...` });
      await runCmd('ssh', [host, `mkdir -p ${remotePath}`]);

      sendProgress({ stage: 'scp', message: `Uploading to ${host}...` });
      const artifacts = [
        join(playerMapDir, 'dist'),
        join(playerMapDir, 'nginx.conf'),
        join(playerMapDir, 'deploy-compose.yml'),
        dataJsonPath,
      ];
      await runCmd('scp', ['-r', ...artifacts, `${host}:${remotePath}/`]);

      // 5. docker compose up -d is idempotent — no-op if already running,
      //    picks up config changes otherwise. The bind-mounted data.json
      //    is live immediately regardless.
      sendProgress({ stage: 'docker', message: 'Starting/updating container...' });
      await runCmd('ssh', [host, `cd ${remotePath} && docker compose -f deploy-compose.yml up -d`]);

      sendProgress({ stage: 'done', message: `Live at ${publicUrl}` });
      return { ok: true, url: publicUrl };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: message };
    }
  });
}

// ---------------------------------------------------------------------------
// Deploy helpers
// ---------------------------------------------------------------------------

/** Spawn a child process and resolve when it exits 0, reject otherwise.
 *  stdout/stderr are captured and attached to the error on failure so the
 *  caller can surface them to the user.
 *
 *  On Windows `shell: true` is required for .cmd shims like npm.cmd (PATHEXT
 *  resolution happens in cmd.exe, not in Node's spawn). But it MUST be off
 *  for real .exe calls like ssh/scp — otherwise cmd.exe parses shell
 *  operators like `&&` that appear inside a remote-command arg, causing the
 *  remote command to split and the tail half to run locally. We gate
 *  `shell` on the command name. */
function runCmd(cmd: string, args: string[], cwd?: string): Promise<void> {
  const isWin = process.platform === 'win32';
  const isCmdShim = /^(npm|npx|yarn|pnpm)$/i.test(cmd);
  const shell = isWin && isCmdShim;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell });
    let stderr = '';
    child.stdout.on('data', () => {
      /* consume; progress is reported at the handler level, not per-line */
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`));
    });
  });
}

/** Returns true if player-map/dist/ is missing or any file under src/,
 *  public/, package.json, index.html, vite.config.ts, or tsconfig*.json
 *  is newer than the newest file under dist/. Cheap heuristic — Vite
 *  would skip work internally anyway, but avoiding the npm boot entirely
 *  shaves ~1-2s off the common "data-only" deploy. */
function needsRebuild(playerMapDir: string): boolean {
  const distDir = join(playerMapDir, 'dist');
  if (!existsSync(distDir)) return true;
  const distMtime = latestMtime(distDir);
  if (distMtime === 0) return true;

  const watchTargets = [
    join(playerMapDir, 'src'),
    join(playerMapDir, 'public'),
    join(playerMapDir, 'package.json'),
    join(playerMapDir, 'index.html'),
    join(playerMapDir, 'vite.config.ts'),
    join(playerMapDir, 'tsconfig.json'),
  ];
  for (const p of watchTargets) {
    if (!existsSync(p)) continue;
    const mt = statSync(p).isDirectory() ? latestMtime(p) : statSync(p).mtimeMs;
    if (mt > distMtime) return true;
  }
  return false;
}

/** Walk a dir and return the newest mtime (ms) of any file within.
 *  Skips node_modules and dotfiles to keep the walk bounded. */
function latestMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let latest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const fp = join(d, entry);
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(fp);
      else if (st.mtimeMs > latest) latest = st.mtimeMs;
    }
  }
  return latest;
}
