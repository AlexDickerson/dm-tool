import { ipcMain, shell, dialog } from 'electron';
import { join, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { DmToolConfig } from '../config.js';
import { listGlobePins, upsertGlobePin, deleteGlobePin } from '../pf2e-db.js';
import type { GlobePin, MissionData } from '../../shared/types.js';
import { missionNoteTemplate, parseMissionNote, splitFrontmatter } from '../mission-parser.js';

/** Sanitise a string for use as a filename — strip characters illegal on
 *  Windows/macOS and collapse whitespace. */
function safeFileName(raw: string): string {
  // Strip characters illegal in Windows/macOS filenames and control chars
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
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

export function registerGlobeHandlers(cfg: DmToolConfig): void {
  const hasPf2eDb = (): boolean => !!cfg.pf2eDbPath;

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
}
