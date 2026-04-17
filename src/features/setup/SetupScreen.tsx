// First-run setup screen shown when no config.json exists. The user
// picks filesystem paths via native dialogs, then clicks "Get Started"
// to write config.json and restart into the full app.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PathField } from '../../components/PathField';
import type { ConfigPaths } from '../../../shared/types';

const HEADER_REMS = 3;

const EMPTY_PATHS: ConfigPaths = {
  libraryPath: '',
  indexDbPath: '',
  inboxPath: '',
  quarantinePath: '',
  taggerBinPath: '',
  booksPath: '',
  autoWallBinPath: '',
  pf2eDbPath: '',
  foundryMcpUrl: '',
  obsidianVaultPath: '',
  sidecarUrl: '',
  sidecarSecret: '',
};

export function SetupScreen() {
  const [paths, setPaths] = useState<ConfigPaths>(EMPTY_PATHS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync title bar overlay height on mount (same logic as App.tsx).
  useEffect(() => {
    const uiScale = 18; // default
    document.documentElement.style.fontSize = `${uiScale}px`;
    window.electronAPI?.setTitleBarOverlayHeight(uiScale * HEADER_REMS).catch(() => {});
  }, []);

  const set = useCallback(
    <K extends keyof ConfigPaths>(field: K) =>
      (value: ConfigPaths[K]) =>
        setPaths((p) => ({ ...p, [field]: value })),
    [],
  );

  const requiredFilled = !!paths.libraryPath && !!paths.indexDbPath && !!paths.inboxPath && !!paths.quarantinePath;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.electronAPI.saveConfigAndRestart(paths);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Title bar drag region */}
      <header
        className="flex h-12 shrink-0 items-center pl-4 pr-[140px]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="mt-1 h-px shrink-0 bg-border" />

      <main className="flex flex-1 items-start justify-center overflow-y-auto p-8">
        <div className="w-full max-w-lg space-y-6">
          {/* Header */}
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Welcome to DM Tool</h1>
            <p className="text-sm text-muted-foreground">
              Point the app at your map-tagger library to get started. All paths can be changed later in Settings.
            </p>
          </div>

          {/* Required paths */}
          <div className="space-y-4">
            <PathField
              label="Map Library"
              description="Folder containing tagged map images and thumbnails."
              value={paths.libraryPath}
              onChange={set('libraryPath')}
              mode="directory"
              required
            />
            <PathField
              label="Map Index DB"
              description="SQLite database maintained by the map tagger."
              value={paths.indexDbPath}
              onChange={set('indexDbPath')}
              mode="file"
              required
              filters={[{ name: 'SQLite', extensions: ['sqlite', 'sqlite3', 'db'] }]}
            />
            <PathField
              label="Tagger Inbox"
              description="Staging folder for new maps before processing."
              value={paths.inboxPath}
              onChange={set('inboxPath')}
              mode="directory"
              required
            />
            <PathField
              label="Quarantine"
              description="Folder for maps that fail tagging."
              value={paths.quarantinePath}
              onChange={set('quarantinePath')}
              mode="directory"
              required
            />
          </div>

          {/* Optional paths */}
          <div className="border-t border-border pt-4">
            <p className="mb-4 text-xs font-medium text-muted-foreground">Optional integrations</p>
            <div className="space-y-4">
              <PathField
                label="Tagger Binary"
                description="Override path to map-tagger.exe. Leave blank to use the bundled binary."
                value={paths.taggerBinPath}
                onChange={set('taggerBinPath')}
                mode="file"
                filters={[{ name: 'Executable', extensions: ['exe'] }]}
              />
              <PathField
                label="Books Root"
                description="Root folder of TTRPG PDFs (enables the Books tab)."
                value={paths.booksPath}
                onChange={set('booksPath')}
                mode="directory"
              />
              <PathField
                label="Auto-Wall Binary"
                description="Path to Auto-Wall.exe for wall detection."
                value={paths.autoWallBinPath}
                onChange={set('autoWallBinPath')}
                mode="file"
                filters={[{ name: 'Executable', extensions: ['exe'] }]}
              />
              <PathField
                label="PF2e Database"
                description="PF2e rules/monsters SQLite database for offline lookups."
                value={paths.pf2eDbPath}
                onChange={set('pf2eDbPath')}
                mode="file"
                filters={[{ name: 'SQLite', extensions: ['sqlite', 'sqlite3', 'db'] }]}
              />
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Foundry MCP URL<span className="text-muted-foreground"> (optional)</span>
                </Label>
                <Input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="http://localhost:8765"
                  value={paths.foundryMcpUrl}
                  onChange={(e) => set('foundryMcpUrl')(e.target.value)}
                  className="text-xs"
                />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  URL of your foundry-mcp server. Enables &quot;Push to Foundry&quot; on maps with walls.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button onClick={handleSave} disabled={!requiredFilled || saving} className="w-full">
            {saving ? 'Saving...' : 'Get Started'}
          </Button>
        </div>
      </main>
    </div>
  );
}
