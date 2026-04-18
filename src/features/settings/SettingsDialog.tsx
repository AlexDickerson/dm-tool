import { useCallback, useEffect, useState } from 'react';
import { ClipboardCopy, FolderOpen, Plus, RotateCcw, Settings, X } from 'lucide-react';
import { PathField } from '../../components/PathField';
import { cn } from '../../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Slider } from '../../components/ui/slider';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import type { ConfigPaths } from '../../../shared/types';
import {
  UI_SCALE,
  THUMB_SCALE,
  FONT_STACKS,
  THEMES,
  CHAT_MODELS,
  PARTY_LEVEL,
  type FontFamily,
  type ThemeId,
  type ToolEntry,
} from '../../lib/constants';

type SettingsTab = 'paths' | 'maps' | 'books' | 'combat' | 'monsters' | 'items' | 'tools';

export interface SettingsDialogProps {
  uiScale: number;
  onUiScaleChange: (n: number) => void;
  fontFamily: FontFamily;
  onFontFamilyChange: (f: FontFamily) => void;
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
  thumbScale: number;
  onThumbScaleChange: (n: number) => void;
  anthropicApiKey: string;
  onAnthropicApiKeyChange: (s: string) => void;
  onPackMappingImported: () => void;
  chatModel: string;
  onChatModelChange: (s: string) => void;
  toolUrls: ToolEntry[];
  onToolUrlsChange: (tools: ToolEntry[]) => void;
  toolFavicons: boolean;
  onToolFaviconsChange: (v: boolean) => void;
  partyLevel: number;
  onPartyLevelChange: (n: number) => void;
}

export function SettingsDialog({
  uiScale,
  onUiScaleChange,
  fontFamily,
  onFontFamilyChange,
  theme,
  onThemeChange,
  thumbScale,
  onThumbScaleChange,
  anthropicApiKey,
  onAnthropicApiKeyChange,
  onPackMappingImported,
  chatModel,
  onChatModelChange,
  toolUrls,
  onToolUrlsChange,
  toolFavicons,
  onToolFaviconsChange,
  partyLevel,
  onPartyLevelChange,
}: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('maps');
  const [exportCopied, setExportCopied] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Config paths state — loaded on dialog open, written via Save & Restart.
  const [configPaths, setConfigPaths] = useState<ConfigPaths | null>(null);
  const [initialPaths, setInitialPaths] = useState<ConfigPaths | null>(null);
  const [pathsSaving, setPathsSaving] = useState(false);
  const [pathsError, setPathsError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      window.electronAPI.getConfig().then((c) => {
        setConfigPaths(c);
        setInitialPaths(c);
        setPathsError(null);
      });
    }
  }, [open]);

  const setPath = useCallback(
    <K extends keyof ConfigPaths>(field: K) =>
      (value: ConfigPaths[K]) =>
        setConfigPaths((p) => (p ? { ...p, [field]: value } : p)),
    [],
  );

  const pathsChanged =
    configPaths != null && initialPaths != null && JSON.stringify(configPaths) !== JSON.stringify(initialPaths);

  const handleSaveAndRestart = async () => {
    if (!configPaths) return;
    setPathsSaving(true);
    setPathsError(null);
    try {
      await window.electronAPI.saveConfigAndRestart(configPaths);
    } catch (e) {
      setPathsError((e as Error).message);
      setPathsSaving(false);
    }
  };

  const handleExportPrompt = useCallback(async () => {
    const prompt = await window.electronAPI.exportPackGroupingPrompt();
    await navigator.clipboard.writeText(prompt);
    setExportCopied(true);
    setTimeout(() => setExportCopied(false), 2000);
  }, []);

  const handleImportGrouping = useCallback(async () => {
    try {
      setImportStatus(null);
      const mapping = await window.electronAPI.importPackMappingFromFile();
      if (mapping) {
        setImportStatus('Imported successfully');
        onPackMappingImported();
        setTimeout(() => setImportStatus(null), 3000);
      }
    } catch (e) {
      setImportStatus(`Error: ${(e as Error).message}`);
    }
  }, [onPackMappingImported]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure the app and its tools.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Global: API key + UI scale */}
          <div className="space-y-2">
            <Label htmlFor="anthropic-key" className="text-xs font-medium">
              Anthropic API Key
            </Label>
            <Input
              id="anthropic-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={anthropicApiKey}
              onChange={(e) => onAnthropicApiKeyChange(e.target.value)}
            />
            <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Powers AI features (encounter hooks, map tagging). Stored locally on this machine.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ui-scale" className="text-xs font-medium">
                UI Size
              </Label>
              <span className="text-xs tabular-nums text-muted-foreground">{uiScale}px</span>
            </div>
            <Slider
              id="ui-scale"
              min={UI_SCALE.min}
              max={UI_SCALE.max}
              step={1}
              value={[uiScale]}
              onValueChange={(v) => onUiScaleChange(v[0] ?? uiScale)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Font</Label>
            <div className="flex gap-1">
              {(['sans-serif', 'serif'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onFontFamilyChange(f)}
                  className={cn(
                    'rounded-md border px-3 py-1 text-xs capitalize transition-colors',
                    fontFamily === f
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-accent',
                  )}
                  style={{ fontFamily: FONT_STACKS[f] }}
                >
                  {f === 'sans-serif' ? 'Sans-Serif' : 'Serif'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Theme</Label>
            <div className="flex gap-1">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onThemeChange(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                    theme === t.id
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border bg-background hover:bg-accent',
                  )}
                >
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: t.swatch }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Per-page tabs */}
          <div className="border-t border-border pt-4">
            <nav className="flex flex-wrap gap-1">
              {(['paths', 'maps', 'tools', 'books', 'combat', 'monsters', 'items'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    tab === t
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {t}
                </button>
              ))}
            </nav>

            <div className="mt-4 space-y-4">
              {tab === 'paths' && configPaths && (
                <>
                  <PathField
                    label="Map Library"
                    description="Folder containing tagged map images and thumbnails."
                    value={configPaths.libraryPath}
                    onChange={setPath('libraryPath')}
                    mode="directory"
                    required
                  />
                  <PathField
                    label="Map Index DB"
                    description="SQLite database maintained by the map tagger."
                    value={configPaths.indexDbPath}
                    onChange={setPath('indexDbPath')}
                    mode="file"
                    required
                    filters={[{ name: 'SQLite', extensions: ['sqlite', 'sqlite3', 'db'] }]}
                  />
                  <PathField
                    label="Tagger Inbox"
                    description="Staging folder for new maps before processing."
                    value={configPaths.inboxPath}
                    onChange={setPath('inboxPath')}
                    mode="directory"
                    required
                  />
                  <PathField
                    label="Quarantine"
                    description="Folder for maps that fail tagging."
                    value={configPaths.quarantinePath}
                    onChange={setPath('quarantinePath')}
                    mode="directory"
                    required
                  />
                  <div className="border-t border-border pt-3">
                    <p className="mb-3 text-[11px] font-medium text-muted-foreground">Optional integrations</p>
                    <div className="space-y-4">
                      <PathField
                        label="Tagger Binary"
                        description="Override path to map-tagger.exe. Leave blank to use the bundled binary."
                        value={configPaths.taggerBinPath}
                        onChange={setPath('taggerBinPath')}
                        mode="file"
                        filters={[{ name: 'Executable', extensions: ['exe'] }]}
                      />
                      <PathField
                        label="Books Root"
                        description="Root folder of TTRPG PDFs (enables the Books tab)."
                        value={configPaths.booksPath}
                        onChange={setPath('booksPath')}
                        mode="directory"
                      />
                      <PathField
                        label="Auto-Wall Binary"
                        description="Path to Auto-Wall.exe for wall detection."
                        value={configPaths.autoWallBinPath}
                        onChange={setPath('autoWallBinPath')}
                        mode="file"
                        filters={[{ name: 'Executable', extensions: ['exe'] }]}
                      />
                      <PathField
                        label="PF2e Database"
                        description="PF2e rules/monsters SQLite database for offline lookups."
                        value={configPaths.pf2eDbPath}
                        onChange={setPath('pf2eDbPath')}
                        mode="file"
                        filters={[{ name: 'SQLite', extensions: ['sqlite', 'sqlite3', 'db'] }]}
                      />
                      <PathField
                        label="Obsidian Vault"
                        description="Obsidian vault folder. Globe pins will create notes in a Golarion/ subfolder."
                        value={configPaths.obsidianVaultPath}
                        onChange={setPath('obsidianVaultPath')}
                        mode="directory"
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
                          value={configPaths.foundryMcpUrl}
                          onChange={(e) => setPath('foundryMcpUrl')(e.target.value)}
                          className="text-xs"
                        />
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          URL of your foundry-mcp server. Enables &quot;Push to Foundry&quot; on maps with walls.
                        </p>
                      </div>
                    </div>
                  </div>

                  {pathsError && <p className="text-xs text-destructive">{pathsError}</p>}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveAndRestart}
                    disabled={!pathsChanged || pathsSaving}
                    className="w-full gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {pathsSaving ? 'Saving...' : 'Save & Restart'}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Changing paths requires an app restart to take effect.
                  </p>
                </>
              )}

              {tab === 'maps' && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="thumb-scale" className="text-xs font-medium">
                        Thumbnail Size
                      </Label>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {Math.round(thumbScale * 100)}%
                      </span>
                    </div>
                    <Slider
                      id="thumb-scale"
                      min={THUMB_SCALE.min}
                      max={THUMB_SCALE.max}
                      step={0.05}
                      value={[thumbScale]}
                      onValueChange={(v) => onThumbScaleChange(v[0] ?? thumbScale)}
                    />
                    <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground">
                      Resizes each card in the map browser grid.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Pack Grouping</Label>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Export a prompt, send it to Claude, then import the JSON to improve how map variants are grouped.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleExportPrompt} className="gap-1.5">
                        <ClipboardCopy className="h-3.5 w-3.5" />
                        {exportCopied ? 'Copied!' : 'Export prompt'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleImportGrouping} className="gap-1.5">
                        <FolderOpen className="h-3.5 w-3.5" />
                        Import grouping
                      </Button>
                    </div>
                    {importStatus && (
                      <p
                        className={cn(
                          'text-[11px]',
                          importStatus.startsWith('Error') ? 'text-destructive' : 'text-green-400',
                        )}
                      >
                        {importStatus}
                      </p>
                    )}
                  </div>
                </>
              )}

              {tab === 'books' && <p className="text-xs text-muted-foreground">No book-specific settings yet.</p>}

              {tab === 'combat' && (
                <div className="flex flex-col gap-3">
                  <div>
                    <Label htmlFor="party-level">Party level</Label>
                    <Input
                      id="party-level"
                      type="number"
                      min={PARTY_LEVEL.min}
                      max={PARTY_LEVEL.max}
                      value={partyLevel}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) {
                          onPartyLevelChange(Math.max(PARTY_LEVEL.min, Math.min(PARTY_LEVEL.max, n)));
                        }
                      }}
                      className="mt-1 w-24"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Used by the encounter loot generator to scale treasure to the party. Update between sessions as
                      characters level up.
                    </p>
                  </div>
                </div>
              )}

              {tab === 'monsters' && <p className="text-xs text-muted-foreground">No monster settings yet.</p>}

              {tab === 'items' && <p className="text-xs text-muted-foreground">No item settings yet.</p>}

              {tab === 'tools' && (
                <ToolsSettings
                  tools={toolUrls}
                  onChange={onToolUrlsChange}
                  useFavicons={toolFavicons}
                  onUseFaviconsChange={onToolFaviconsChange}
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chat-model" className="text-xs font-medium">
              Chat Model
            </Label>
            <select
              id="chat-model"
              value={chatModel}
              onChange={(e) => onChatModelChange(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {CHAT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Model used by the chat assistant. Higher tiers are smarter but cost more per message.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tools sub-settings: URL list + favicon toggle
// ---------------------------------------------------------------------------

function ToolsSettings({
  tools,
  onChange,
  useFavicons,
  onUseFaviconsChange,
}: {
  tools: ToolEntry[];
  onChange: (tools: ToolEntry[]) => void;
  useFavicons: boolean;
  onUseFaviconsChange: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState('');

  const addTool = () => {
    let url = draft.trim();
    if (!url) return;
    // Auto-prepend https:// if missing
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const parsed = new URL(url);
      const label = parsed.hostname.replace(/^www\./, '');
      const id = `custom-${Date.now()}`;
      onChange([...tools, { id, label, url: parsed.href }]);
      setDraft('');
    } catch {
      // invalid URL — ignore
    }
  };

  const removeTool = (id: string) => {
    onChange(tools.filter((t) => t.id !== id));
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs font-medium">Tool Sites</Label>
        <div className="space-y-1.5">
          {tools.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1.5"
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${new URL(t.url).hostname}&sz=16`}
                alt=""
                className="h-4 w-4 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-xs">{t.label}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{t.url}</span>
              <button
                type="button"
                onClick={() => removeTool(t.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                aria-label={`Remove ${t.label}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addTool();
          }}
          className="flex gap-1.5"
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://example.com"
            className="h-8 flex-1 text-xs"
          />
          <Button type="submit" variant="outline" size="sm" className="h-8 gap-1 px-2.5">
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </form>
        <p className="text-[11px] text-muted-foreground">Each URL opens in its own iframe tab under the Tools page.</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="tool-favicons" className="text-xs font-medium">
            Use Favicons as Tab Labels
          </Label>
          <button
            id="tool-favicons"
            type="button"
            role="switch"
            aria-checked={useFavicons}
            onClick={() => onUseFaviconsChange(!useFavicons)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              useFavicons ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
                useFavicons ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Show site favicons instead of text labels in the tool tab bar.
        </p>
      </div>
    </>
  );
}
