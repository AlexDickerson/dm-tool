import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Config loader calls app.isPackaged + app.getAppPath + app.getPath('userData').
// We stub electron to make all three point at per-test temp directories so
// the real file-search logic runs unchanged.
let projectRoot: string;
let userDataDir: string;
let resourcesPath: string;

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return false;
    },
    getAppPath: () => projectRoot,
    getPath: (key: string) => {
      if (key === 'userData') return userDataDir;
      throw new Error(`unexpected getPath(${key})`);
    },
  },
}));

// `process.resourcesPath` is only defined at runtime under a real Electron
// binary. resolveBundledAutoWall reads it unconditionally, so we stub it
// before importing the module.
beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'dmtool-cfgtest-root-'));
  userDataDir = mkdtempSync(join(tmpdir(), 'dmtool-cfgtest-ud-'));
  resourcesPath = mkdtempSync(join(tmpdir(), 'dmtool-cfgtest-res-'));
  (process as NodeJS.Process & { resourcesPath: string }).resourcesPath = resourcesPath;
  // cwd-based fallback resolution — point it at projectRoot so the "dev"
  // bundled-tagger search resolves predictably.
  vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(resourcesPath, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const { configExists, loadConfig, resolveConfigPath } = await import('./config');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeProjectConfig(config: Record<string, unknown>): string {
  const path = join(projectRoot, 'config.json');
  writeFileSync(path, JSON.stringify(config), 'utf-8');
  return path;
}

/** Create the directory paths a minimal loadConfig() call requires to exist
 *  (libraryPath + indexDbPath file) and return that base config. Tests can
 *  spread this and override any field. */
function minimalValidConfig(): Record<string, string> {
  const libraryPath = join(projectRoot, 'library');
  const indexDbPath = join(projectRoot, 'index.sqlite');
  const inboxPath = join(projectRoot, 'inbox');
  const quarantinePath = join(projectRoot, 'quarantine');
  mkdirSync(libraryPath, { recursive: true });
  writeFileSync(indexDbPath, '', 'utf-8');
  return { libraryPath, indexDbPath, inboxPath, quarantinePath };
}

// ---------------------------------------------------------------------------
// resolveConfigPath / configExists
// ---------------------------------------------------------------------------

describe('resolveConfigPath', () => {
  it('prefers $DM_TOOL_CONFIG when set and the file exists', () => {
    const overridePath = join(projectRoot, 'custom-config.json');
    writeFileSync(overridePath, '{}', 'utf-8');
    process.env.DM_TOOL_CONFIG = overridePath;
    try {
      expect(resolveConfigPath()).toBe(overridePath);
    } finally {
      delete process.env.DM_TOOL_CONFIG;
    }
  });

  it('ignores $DM_TOOL_CONFIG when the referenced file is missing', () => {
    process.env.DM_TOOL_CONFIG = join(projectRoot, 'does-not-exist.json');
    try {
      const projectConfig = writeProjectConfig({});
      expect(resolveConfigPath()).toBe(projectConfig);
    } finally {
      delete process.env.DM_TOOL_CONFIG;
    }
  });

  it('falls back to <projectRoot>/config.json', () => {
    const projectConfig = writeProjectConfig({});
    expect(resolveConfigPath()).toBe(projectConfig);
  });

  it('falls back to <userData>/config.json as a last resort', () => {
    const userConfig = join(userDataDir, 'config.json');
    writeFileSync(userConfig, '{}', 'utf-8');
    expect(resolveConfigPath()).toBe(userConfig);
  });

  it('returns the project-root path even when nothing exists (points the user at where to create it)', () => {
    expect(resolveConfigPath()).toBe(join(projectRoot, 'config.json'));
  });
});

describe('configExists', () => {
  it('returns false when no config file exists anywhere', () => {
    expect(configExists()).toBe(false);
  });

  it('returns true when the project-root config exists', () => {
    writeProjectConfig({});
    expect(configExists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — validation
// ---------------------------------------------------------------------------

describe('loadConfig — required field validation', () => {
  it('throws when the config file is missing entirely', () => {
    expect(() => loadConfig()).toThrow(/no config\.json found/);
  });

  it('throws when the file is not valid JSON', () => {
    writeFileSync(join(projectRoot, 'config.json'), '{not json', 'utf-8');
    expect(() => loadConfig()).toThrow(/not valid JSON/);
  });

  it.each(['libraryPath', 'indexDbPath', 'inboxPath', 'quarantinePath'] as const)(
    'throws when %s is missing',
    (field) => {
      const cfg = minimalValidConfig();
      delete (cfg as Record<string, string | undefined>)[field];
      writeProjectConfig(cfg);
      expect(() => loadConfig()).toThrow(new RegExp(`missing required string field "${field}"`));
    },
  );

  it('throws when libraryPath does not exist on disk', () => {
    const cfg = minimalValidConfig();
    cfg.libraryPath = join(projectRoot, 'nonexistent-library');
    writeProjectConfig(cfg);
    expect(() => loadConfig()).toThrow(/libraryPath does not exist/);
  });

  it('throws when indexDbPath does not exist on disk', () => {
    const cfg = minimalValidConfig();
    cfg.indexDbPath = join(projectRoot, 'nonexistent.sqlite');
    writeProjectConfig(cfg);
    expect(() => loadConfig()).toThrow(/indexDbPath does not exist/);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — taggerBinPath handling (post-refactor: optional, non-fatal)
// ---------------------------------------------------------------------------

describe('loadConfig — taggerBinPath is optional', () => {
  it('leaves taggerBinPath undefined when no config value and no bundled exe exists', () => {
    writeProjectConfig(minimalValidConfig());
    const cfg = loadConfig();
    expect(cfg.taggerBinPath).toBeUndefined();
  });

  it('uses the configured path when the file exists', () => {
    const base = minimalValidConfig();
    const taggerBin = join(projectRoot, 'my-tagger.exe');
    writeFileSync(taggerBin, '', 'utf-8');
    writeProjectConfig({ ...base, taggerBinPath: taggerBin });
    const cfg = loadConfig();
    expect(cfg.taggerBinPath).toBe(taggerBin);
  });

  it('falls back to undefined when the configured path does not exist (warns, does not throw)', () => {
    const base = minimalValidConfig();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeProjectConfig({ ...base, taggerBinPath: join(projectRoot, 'missing-tagger.exe') });
    const cfg = loadConfig();
    expect(cfg.taggerBinPath).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/taggerBinPath does not exist/));
  });

  it('falls back to a bundled dev shim at tagger/.venv/Scripts/map-tagger.exe', () => {
    const base = minimalValidConfig();
    const shimDir = join(projectRoot, 'tagger', '.venv', 'Scripts');
    mkdirSync(shimDir, { recursive: true });
    const shim = join(shimDir, 'map-tagger.exe');
    writeFileSync(shim, '', 'utf-8');
    writeProjectConfig(base);
    const cfg = loadConfig();
    expect(cfg.taggerBinPath).toBe(shim);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — optional paths
// ---------------------------------------------------------------------------

describe('loadConfig — optional paths', () => {
  it('leaves optional paths undefined when not configured', () => {
    writeProjectConfig(minimalValidConfig());
    const cfg = loadConfig();
    expect(cfg.booksPath).toBeUndefined();
    expect(cfg.autoWallBinPath).toBeUndefined();
    expect(cfg.pf2eDbPath).toBeUndefined();
    expect(cfg.foundryMcpUrl).toBeUndefined();
    expect(cfg.obsidianVaultPath).toBeUndefined();
    expect(cfg.playerMapDeployHost).toBeUndefined();
    expect(cfg.playerMapDeployPath).toBeUndefined();
    expect(cfg.playerMapPublicUrl).toBeUndefined();
  });

  it('strips trailing slashes from foundryMcpUrl', () => {
    const base = minimalValidConfig();
    writeProjectConfig({ ...base, foundryMcpUrl: 'http://localhost:8765///' });
    expect(loadConfig().foundryMcpUrl).toBe('http://localhost:8765');
  });

  it('trims whitespace from player-map deploy strings', () => {
    const base = minimalValidConfig();
    writeProjectConfig({
      ...base,
      playerMapDeployHost: '  user@host  ',
      playerMapDeployPath: '  ~/path  ',
      playerMapPublicUrl: '  http://example.com  ',
    });
    const cfg = loadConfig();
    expect(cfg.playerMapDeployHost).toBe('user@host');
    expect(cfg.playerMapDeployPath).toBe('~/path');
    expect(cfg.playerMapPublicUrl).toBe('http://example.com');
  });

  it('treats empty-string optional fields as absent', () => {
    const base = minimalValidConfig();
    writeProjectConfig({
      ...base,
      booksPath: '   ',
      foundryMcpUrl: '',
      playerMapDeployHost: '',
    });
    const cfg = loadConfig();
    expect(cfg.booksPath).toBeUndefined();
    expect(cfg.foundryMcpUrl).toBeUndefined();
    expect(cfg.playerMapDeployHost).toBeUndefined();
  });
});
