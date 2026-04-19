import { app, dialog, ipcMain, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { MapDb } from '../db.js';
import { type DmToolConfig, resolveConfigPath } from '../config.js';
import type { ConfigPaths, MapDetail, PickPathArgs } from '@dm-tool/shared/types';
import { getMonsterPreview } from '../pf2e-db.js';
import { fetchAonPreview } from '../aon-preview.js';
import { generateEncounterHooks } from '../anthropic.js';
import { appendAdditionalHooks, getAdditionalHooks } from '../hooks-store.js';

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
      pf2eDbPath: cfg.pf2eDbPath ?? '',
      foundryMcpUrl: cfg.foundryMcpUrl ?? '',
      obsidianVaultPath: cfg.obsidianVaultPath ?? '',
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

    const config: Record<string, string> = {
      libraryPath: paths.libraryPath,
      indexDbPath: paths.indexDbPath,
      inboxPath: paths.inboxPath,
      quarantinePath: paths.quarantinePath,
    };
    if (paths.taggerBinPath?.trim()) config.taggerBinPath = paths.taggerBinPath;
    if (paths.booksPath?.trim()) config.booksPath = paths.booksPath;
    if (paths.autoWallBinPath?.trim()) config.autoWallBinPath = paths.autoWallBinPath;
    if (paths.pf2eDbPath?.trim()) config.pf2eDbPath = paths.pf2eDbPath;
    if (paths.foundryMcpUrl?.trim()) config.foundryMcpUrl = paths.foundryMcpUrl;
    if (paths.obsidianVaultPath?.trim()) config.obsidianVaultPath = paths.obsidianVaultPath;
    if (paths.sidecarUrl?.trim()) config.sidecarUrl = paths.sidecarUrl;
    if (paths.sidecarSecret?.trim()) config.sidecarSecret = paths.sidecarSecret;

    const outPath = resolveConfigPath();
    await writeFile(outPath, JSON.stringify(config, null, 2), 'utf-8');

    app.relaunch();
    app.exit(0);
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

      const newHooks = await generateEncounterHooks({
        apiKey: args.apiKey,
        libraryPath: cfg.libraryPath,
        detail,
      });
      return appendAdditionalHooks(args.fileName, newHooks);
    },
  );
}
