import { ipcMain, shell, dialog } from 'electron';
import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { DmToolConfig } from '../config.js';
import { listGlobePins, upsertGlobePin, deleteGlobePin, setMissionMarkdown } from '@dm-tool/db/pf2e';
import type { GlobePin, GlobeDeployProgress, GlobeDeployResult, MissionData } from '@dm-tool/shared/types';
import { missionNoteTemplate, parseMissionNote } from '../mission-parser.js';
import { findNoteByPinId, safeFileName, stampPinId } from '../mission-notes.js';
import { pushToSidecar } from '../sidecar-client.js';

/** Default public URL shown in the "Pushed" toast if not configured. */
const DEFAULT_PUBLIC_URL = 'http://server.ad:30002';

export function registerGlobeHandlers(cfg: DmToolConfig, getMainWindow: () => Electron.BrowserWindow | null): void {
  /** Best-effort POST of the current pin snapshot to the player portal's
   *  /api/globe endpoint. Silent no-op if sidecarUrl/secret aren't
   *  configured. Network/5xx errors log and swallow — the SQLite write
   *  has already succeeded and the next successful push will reconcile. */
  async function pushSnapshot(): Promise<void> {
    const payload = await buildExportPayload();
    await pushToSidecar(cfg, '/api/globe', { pins: payload.pins, updatedAt: new Date().toISOString() }, 'globe');
  }

  /** Collect every pin and, for mission pins with an Obsidian vault
   *  configured, inline the parsed MissionData (minus dmNotes — players
   *  don't get to see those). Shared by the live-sync push, the manual
   *  file export, and the deploy "push now" flow. */
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
              // Mirror the markdown into the DB so the pin row is self-
              // contained — useful for backups and for any future portal
              // feature that wants the raw text without going through
              // the DM's Obsidian vault.
              setMissionMarkdown(pin.id, raw);
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

  ipcMain.handle('globePinsList', () => listGlobePins());

  ipcMain.handle('globePinsUpsert', async (_e, pin: GlobePin) => {
    upsertGlobePin(pin);
    await pushSnapshot();
  });

  ipcMain.handle('globePinsDelete', async (_e, id: string) => {
    deleteGlobePin(id);
    await pushSnapshot();
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
    await pushSnapshot();
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

  /** Push the current pin snapshot to the player portal's /api/globe.
   *  Replaces the old build-data.json + scp + docker-compose dance —
   *  since the portal now treats pins as a live-sync dataset (same as
   *  inventory + aurus), all a "deploy" needs to do is POST the latest
   *  snapshot. Container restarts / image rebuilds are handled out-of-
   *  band when portal server code itself changes. */
  ipcMain.handle('globeDeployPlayer', async (): Promise<GlobeDeployResult> => {
    const publicUrl = cfg.playerMapPublicUrl ?? DEFAULT_PUBLIC_URL;

    const sendProgress = (p: GlobeDeployProgress): void => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('globe-deploy-progress', p);
    };

    if (!cfg.sidecarUrl || !cfg.sidecarSecret) {
      return {
        ok: false,
        error: 'sidecarUrl and sidecarSecret must be set in config.json for live-sync push to the player portal.',
      };
    }

    try {
      sendProgress({ stage: 'export', message: 'Collecting pins and mission notes...' });
      const payload = await buildExportPayload();

      sendProgress({ stage: 'docker', message: 'Pushing to player portal...' });
      const res = await fetch(`${cfg.sidecarUrl.replace(/\/+$/, '')}/api/globe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.sidecarSecret}`,
        },
        body: JSON.stringify({ pins: payload.pins, updatedAt: new Date().toISOString() }),
      });
      if (!res.ok) {
        return { ok: false, error: `push failed: ${res.status} ${res.statusText}` };
      }

      sendProgress({ stage: 'done', message: `Live at ${publicUrl}` });
      return { ok: true, url: publicUrl };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: message };
    }
  });
}
