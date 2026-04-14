import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Backpack,
  BookOpen,
  ClipboardCopy,
  FolderOpen,
  Map,
  MessageSquare,
  RotateCcw,
  Search,
  Settings,
  Skull,
  Swords,
} from 'lucide-react';
import { MapBrowser } from './features/map-browser/MapBrowser';
import { BookBrowser } from './features/book-browser/BookBrowser';
import { ItemBrowser } from './features/item-browser/ItemBrowser';
import { MonsterBrowser } from './features/monsters/MonsterBrowser';
import { ChatDrawer } from './features/chat/ChatDrawer';
import { SetupScreen } from './features/setup/SetupScreen';
import { PathField } from './components/PathField';
import { cn } from './lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog';
import { Button } from './components/ui/button';
import { Slider } from './components/ui/slider';
import { Label } from './components/ui/label';
import { Input } from './components/ui/input';
import type { ConfigPaths } from '../shared/types';
import {
  STORAGE_KEYS,
  UI_SCALE,
  HEADER_REMS,
  THUMB_SCALE,
  FONT_STACKS,
  THEMES,
  THEME_DEFAULT,
  DEFAULT_CHAT_MODEL,
  CHAT_MODELS,
  type FontFamily,
  type ThemeId,
} from './lib/constants';

function loadString(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function loadNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  } catch {
    return fallback;
  }
}

type ActiveTab = 'maps' | 'books' | 'combat' | 'monsters' | 'items';

export default function App() {
  const [appMode, setAppMode] = useState<'loading' | 'normal' | 'setup'>('loading');

  useEffect(() => {
    window.electronAPI.getAppMode().then(setAppMode);
  }, []);

  if (appMode === 'loading') return null;
  if (appMode === 'setup') return <SetupScreen />;

  return <MainApp />;
}

function MainApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('maps');
  // Bumped when pack mapping is imported via Settings so MapBrowser
  // knows to re-fetch. Passed as a prop — MapBrowser watches it.
  const [packMappingVersion, setPackMappingVersion] = useState(0);
  const [uiScale, setUiScale] = useState<number>(() =>
    loadNumber(STORAGE_KEYS.uiScale, UI_SCALE.default, UI_SCALE.min, UI_SCALE.max),
  );
  const [thumbScale, setThumbScale] = useState<number>(() =>
    loadNumber(STORAGE_KEYS.thumbScale, THUMB_SCALE.default, THUMB_SCALE.min, THUMB_SCALE.max),
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState<string>('');
  const [chatModel, setChatModel] = useState<string>(() => loadString(STORAGE_KEYS.chatModel) || DEFAULT_CHAT_MODEL);
  const [fontFamily, setFontFamily] = useState<FontFamily>(
    () => (loadString(STORAGE_KEYS.fontFamily) as FontFamily) || 'sans-serif',
  );
  const [theme, setTheme] = useState<ThemeId>(
    () => (loadString(STORAGE_KEYS.theme) as ThemeId) || THEME_DEFAULT,
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [keywords, setKeywords] = useState('');

  // Load API key from secure storage on mount
  useEffect(() => {
    window.electronAPI?.secureLoad('anthropicApiKey').then((key) => {
      if (key) setAnthropicApiKey(key);
    });
  }, []);

  // Apply the UI scale to the root <html> element and tell the main
  // process to resize the native title-bar overlay to match. Runs on
  // mount (so a saved preference is restored) and on every scale change.
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}px`;
    try {
      localStorage.setItem(STORAGE_KEYS.uiScale, String(uiScale));
    } catch {
      // Storage may be unavailable in some embedded contexts; non-fatal.
    }
    // The native min/max/close buttons live outside the DOM, so we have
    // to push their height through IPC. Header is HEADER_REMS rem tall,
    // so the pixel height equals uiScale * HEADER_REMS.
    window.electronAPI?.setTitleBarOverlayHeight(uiScale * HEADER_REMS).catch(() => {
      // Ignore — older builds without this IPC handler shouldn't crash
      // the renderer; the overlay will just stay at its default height.
    });
  }, [uiScale]);

  // Persist thumb scale separately. ThumbnailGrid reads this via prop
  // and recomputes column count + virtualizer measurements when it
  // changes.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.thumbScale, String(thumbScale));
    } catch {
      // non-fatal
    }
  }, [thumbScale]);

  // Persist API key via secure storage (OS keychain-backed).
  // Skip the initial empty string — only persist user-initiated changes.
  const apiKeyInitialized = useRef(false);
  useEffect(() => {
    if (!apiKeyInitialized.current) {
      if (anthropicApiKey) apiKeyInitialized.current = true;
      else return;
    }
    if (anthropicApiKey) {
      window.electronAPI?.secureStore('anthropicApiKey', anthropicApiKey);
    } else {
      window.electronAPI?.secureDelete('anthropicApiKey');
    }
  }, [anthropicApiKey]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.chatModel, chatModel);
    } catch {
      // non-fatal
    }
  }, [chatModel]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-body', FONT_STACKS[fontFamily]);
    try {
      localStorage.setItem(STORAGE_KEYS.fontFamily, fontFamily);
    } catch {
      // non-fatal
    }
  }, [fontFamily]);

  useEffect(() => {
    if (theme === THEME_DEFAULT) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // non-fatal
    }
  }, [theme]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Custom title bar. The native OS chrome is hidden via
          `titleBarStyle: 'hidden'` in main.ts, and the native min/max/
          close buttons are drawn as an overlay on the right (see
          `titleBarOverlay` in main.ts). `WebkitAppRegion: drag` makes
          this header act as the window drag handle; any interactive
          children (like the nav tabs) must opt out with `no-drag` or
          they can't receive clicks. Reserved ~140px of right padding so
          our own content never slides under the native control buttons. */}
      <header
        className="flex h-12 shrink-0 items-center gap-4 pl-4 pr-[140px]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <h1 className="flex items-center" aria-label="DM Tool">
          <D20Icon className="h-8 w-8 text-primary" />
        </h1>
        <nav className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <NavTab active={activeTab === 'maps'} onClick={() => setActiveTab('maps')} icon={Map} label="Maps" />
          <NavTab active={activeTab === 'books'} onClick={() => setActiveTab('books')} icon={BookOpen} label="Books" />
          <NavTab active={activeTab === 'combat'} onClick={() => setActiveTab('combat')} icon={Swords} label="Combat" />
          <NavTab
            active={activeTab === 'monsters'}
            onClick={() => setActiveTab('monsters')}
            icon={Skull}
            label="Monsters"
          />
          <NavTab active={activeTab === 'items'} onClick={() => setActiveTab('items')} icon={Backpack} label="Items" />
        </nav>
        {/* Search bar — shared across all tabs */}
        <div
          className="relative mx-2 flex max-w-md flex-1 items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={
              activeTab === 'maps'
                ? 'Search maps…'
                : activeTab === 'books'
                  ? 'Filter books…'
                  : activeTab === 'monsters'
                    ? 'Search monsters…'
                    : activeTab === 'items'
                      ? 'Search items…'
                      : 'Search…'
            }
            className="h-8 bg-background/50 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            aria-label="Toggle chat"
            onClick={() => setChatOpen((o) => !o)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
              chatOpen ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <SettingsDialog
            uiScale={uiScale}
            onUiScaleChange={setUiScale}
            fontFamily={fontFamily}
            onFontFamilyChange={setFontFamily}
            theme={theme}
            onThemeChange={setTheme}
            thumbScale={thumbScale}
            onThumbScaleChange={setThumbScale}
            anthropicApiKey={anthropicApiKey}
            onAnthropicApiKeyChange={setAnthropicApiKey}
            onPackMappingImported={() => setPackMappingVersion((v) => v + 1)}
            chatModel={chatModel}
            onChatModelChange={setChatModel}
          />
        </div>
      </header>
      {/* Divider below header — the mt-1 gap clears the native overlay
          buttons which render slightly past their declared height. */}
      <div
        className="mt-1 shrink-0"
        style={{
          height: 1,
          background:
            'linear-gradient(90deg, hsl(var(--border)) 0%, hsl(var(--primary) / 0.3) 50%, hsl(var(--border)) 100%)',
        }}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main className="relative h-full overflow-hidden">
          {activeTab === 'maps' && (
            <MapBrowser
              thumbScale={thumbScale}
              anthropicApiKey={anthropicApiKey}
              packMappingVersion={packMappingVersion}
              keywords={keywords}
            />
          )}
          {activeTab === 'books' && <BookBrowser keywords={keywords} />}
          {activeTab === 'combat' && <CombatPlaceholder />}
          {activeTab === 'monsters' && <MonsterBrowser keywords={keywords} />}
          {activeTab === 'items' && <ItemBrowser keywords={keywords} />}
          {/* Vignette overlay — darkens edges for a "torchlight" feel */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at center, transparent 60%, hsl(var(--background) / 0.4) 100%)',
            }}
          />
        </main>
        <ChatDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          anthropicApiKey={anthropicApiKey}
          chatModel={chatModel}
        />
      </div>
    </div>
  );
}

// Line-art d20 logo used in the title bar. Viewed from an upper
// vertex so the top triangular face reads clearly: outer hexagonal
// silhouette with an upward-pointing inner triangle, connected to the
// six hex vertices to suggest the six visible facets. Uses
// `currentColor` so it inherits whatever text color the parent sets.
function D20Icon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* outer hexagon (point-up orientation) */}
      <path d="M12 2 L20.66 7 L20.66 17 L12 22 L3.34 17 L3.34 7 Z" />
      {/* inner triangle (top face of the die) */}
      <path d="M12 6 L17.5 15 L6.5 15 Z" />
      {/* connectors from inner triangle vertices to hex vertices,
          subdividing the silhouette into six facets */}
      <path d="M12 2 L12 6" />
      <path d="M20.66 7 L17.5 15" />
      <path d="M3.34 7 L6.5 15" />
      <path d="M20.66 17 L17.5 15" />
      <path d="M3.34 17 L6.5 15" />
      <path d="M12 22 L17.5 15" />
      <path d="M12 22 L6.5 15" />
    </svg>
  );
}

function NavTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active?: boolean;
  onClick?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'relative px-3 py-2 transition-colors',
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {active && (
        <span
          className="absolute bottom-0 left-1/2 h-[2px] rounded-full bg-primary"
          style={{
            width: '60%',
            animation: 'dmtool-tab-reveal 200ms ease-out forwards',
          }}
        />
      )}
    </button>
  );
}

function CombatPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Swords className="h-12 w-12 opacity-20" />
        <p className="text-sm">Combat tracker coming soon</p>
      </div>
    </div>
  );
}

type SettingsTab = 'paths' | 'maps' | 'books' | 'combat' | 'monsters' | 'items';

function SettingsDialog({
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
}: {
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
}) {
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
              {(['paths', 'maps', 'books', 'combat', 'monsters', 'items'] as const).map((t) => (
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

              {tab === 'combat' && <p className="text-xs text-muted-foreground">No combat settings yet.</p>}

              {tab === 'monsters' && <p className="text-xs text-muted-foreground">No monster settings yet.</p>}

              {tab === 'items' && <p className="text-xs text-muted-foreground">No item settings yet.</p>}
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
