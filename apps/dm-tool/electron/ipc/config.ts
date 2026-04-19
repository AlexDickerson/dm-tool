import { app, dialog, ipcMain, safeStorage, shell } from 'electron';
import { extname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { generateEncounterHooks } from '@dm-tool/ai/hooks';
import type { VisionMediaType } from '@dm-tool/ai/hooks';
import type { MapDb } from '../db.js';
import type { DmToolConfig } from '../config.js';
import type { ConfigPaths, MapDetail, PickPathArgs } from '@dm-tool/shared/types';
import { getMonsterPreview } from '../pf2e-db.js';
import { fetchAonPreview } from '../aon-preview.js';
import { appendAdditionalHooks, getAdditionalHooks } from '../hooks-store.js';
import { writeSettings } from '../setup-ipc.js';
import { THUMBNAIL_SUFFIX } from '../constants.js';

function resolveMapImagePath(libraryPath: string, fileName: string): string {
  const thumb = join(libraryPath, `${fileName}${THUMBNAIL_SUFFIX}`);
  return existsSync(thumb) ? thumb : join(libraryPath, fileName);
}

function mediaTypeFor(filePath: string): VisionMediaType {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

export function registerConfigHandlers(db: MapDb, cfg: DmToolConfig): void {
  // --- Secure storage (API keys) -------------------------------------------

  const secureStorePath = join(app.getPath('userData'), 'secure-store');

  ipcMain.handle('secureStore', async (_e, key: string, value: string): Promise<void> => {
    await mkdir(secureStorePath, { recursive: true });
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      await writeFile(join(secureStorePath, key), encrypted);
    } else {
      await writeFile(join(secureStorePath, key), value, 'utf-8');
    }
  });

  ipcMain.handle('secureLoad', async (_e, key: string): Promise<string> => {
    const filePath = join(secureStorePath, key);
    if (!existsSync(filePath)) return '';
    const raw = await readFile(filePath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(raw);
      } catch {
        return raw.toString('utf-8');
      }
    }
    return raw.toString('utf-8');
  });

  ipcMain.handle('secureDelete', async (_e, key: string): Promise<void> => {
    const filePath = join(secureStorePath, key);
    if (existsSync(filePath)) {
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath);
    }
  });

  // --- App mode + config ---------------------------------------------------

  ipcMain.handle('getAppMode', (): 'normal' | 'setup' => 'normal');

  ipcMain.handle(
    'getConfig',
    (): ConfigPaths => ({
      libraryPath: cfg.libraryPath,
      indexDbPath: cfg.indexDbPath,
      inboxPath: cfg.inboxPath,
      quarantinePath: cfg.quarantinePath,
      taggerBinPath: cfg.taggerBinPath ?? '',
      booksPath: cfg.booksPath ?? '',
      autoWallBinPath: cfg.autoWallBinPath ?? '',
      foundryMcpUrl: cfg.foundryMcpUrl ?? '',
      obsidianVaultPath: cfg.obsidianVaultPath ?? '',
      playerMapPublicUrl: cfg.playerMapPublicUrl ?? '',
      sidecarUrl: cfg.sidecarUrl ?? '',
      sidecarSecret: cfg.sidecarSecret ?? '',
    }),
  );

  ipcMain.handle('pickPath', async (_e, args: PickPathArgs): Promise<string | null> => {
    const properties: ('openDirectory' | 'openFile')[] = [args.mode === 'directory' ? 'openDirectory' : 'openFile'];
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: args.title ?? (args.mode === 'directory' ? 'Select folder' : 'Select file'),
      properties,
      filters: args.filters,
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  ipcMain.handle('saveConfigAndRestart', async (_e, paths: ConfigPaths): Promise<void> => {
    const required = ['libraryPath', 'indexDbPath', 'inboxPath', 'quarantinePath'] as const;
    for (const field of required) {
      if (!paths[field] || typeof paths[field] !== 'string' || !paths[field].trim()) {
        throw new Error(`${field} is required`);
      }
    }

    writeSettings(paths);

    // app.relaunch() respawns Electron directly, which works in a
    // packaged build but drops the electron-vite dev-server context in
    // dev mode (renderer comes back blank). Only auto-relaunch in prod;
    // in dev just exit and let the user re-run `npm run dev`.
    if (app.isPackaged) {
      app.relaunch();
      app.exit(0);
    } else {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Settings saved',
        message: 'Dm-tool will now close.',
        detail: 'Run `npm run dev` again to relaunch with the new settings.',
      });
      app.exit(0);
    }
  });

  // --- Misc handlers -------------------------------------------------------

  ipcMain.handle('aonPreview', async (_e, urlPath: string) => {
    if (typeof urlPath !== 'string') return null;

    // Try local DB first for creature URLs.
    if (urlPath.includes('Monsters.aspx')) {
      try {
        const fullUrl = `https://2e.aonprd.com${urlPath}`;
        const local = getMonsterPreview(fullUrl);
        if (local) {
          return {
            type: 'creature' as const,
            name: local.name,
            level: local.level,
            hp: local.hp,
            ac: local.ac,
            fortitude: local.fort,
            reflex: local.ref,
            will: local.will,
            perception: local.perception,
            speed: local.speed,
            size: local.size,
            traits: local.traits,
            abilities: [],
            immunities: local.immunities ? local.immunities.split(', ') : [],
            weaknesses: local.weaknesses,
            rarity: local.rarity.toLowerCase(),
            summary: local.description.slice(0, 200),
            strength: local.str,
            dexterity: local.dex,
            constitution: local.con,
            intelligence: local.int,
            wisdom: local.wis,
            charisma: local.cha,
            statBlock:
              local.abilities +
              '\n---\n' +
              (local.melee ? `Melee ${local.melee}` : '') +
              (local.ranged ? `\nRanged ${local.ranged}` : ''),
          };
        }
      } catch {
        /* fall through to AoN */
      }
    }

    return fetchAonPreview(urlPath);
  });

  ipcMain.handle('openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
  });

  // Regenerate encounter hooks via the Anthropic API and persist them to
  // the override store. Returns the FULL list of additional hooks (newest
  // first) so the renderer can swap its local state in one assignment.
  ipcMain.handle(
    'regenerateEncounterHooks',
    async (_e, args: { fileName: string; apiKey: string }): Promise<string[]> => {
      if (!args || typeof args.fileName !== 'string') {
        throw new Error('regenerateEncounterHooks: fileName is required');
      }
      // Reject anything but a plain filename — same defense as
      // openInExplorer. The fileName flows into a disk path inside
      // anthropic.ts and we don't want a renderer bug to walk the FS.
      if (args.fileName.includes('/') || args.fileName.includes('\\')) {
        throw new Error('regenerateEncounterHooks: fileName must not contain path separators');
      }

      const baseDetail = db.getDetail(args.fileName);
      if (!baseDetail) {
        throw new Error(`Unknown map: ${args.fileName}`);
      }
      // Build a MapDetail with the current additional hooks merged in so
      // the prompt can ask the model not to repeat them.
      const detail: MapDetail = {
        ...baseDetail,
        additionalEncounterHooks: getAdditionalHooks(args.fileName),
      };

      const imagePath = resolveMapImagePath(cfg.libraryPath, args.fileName);
      if (!existsSync(imagePath)) {
        throw new Error(`Map image not found at ${imagePath}`);
      }
      const mapImage = readFileSync(imagePath);

      const newHooks = await generateEncounterHooks({
        apiKey: args.apiKey,
        mapImage,
        mediaType: mediaTypeFor(imagePath),
        detail,
      });
      return appendAdditionalHooks(args.fileName, newHooks);
    },
  );
}
