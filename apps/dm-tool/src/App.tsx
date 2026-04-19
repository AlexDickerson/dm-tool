import { useEffect, useState } from 'react';
import {
  Backpack,
  BookOpen,
  Globe,
  Map,
  MessageSquare,
  Package,
  Search,
  Skull,
  Swords,
  Trophy,
  Wrench,
} from 'lucide-react';
import { MapBrowser } from './features/map-browser/MapBrowser';
import { BookBrowser } from './features/book-browser/BookBrowser';
import { ItemBrowser } from './features/item-browser/ItemBrowser';
import { MonsterBrowser } from './features/monsters/MonsterBrowser';
import { ToolsBrowser } from './features/tools/ToolsBrowser';
import { GlobeViewer } from './features/globe/GlobeViewer';
import { InventoryTab } from './features/inventory/InventoryTab';
import { AurusTab } from './features/aurus/AurusTab';
import { CombatTab } from './features/combat/CombatTab';
import { ChatDrawer } from './features/chat/ChatDrawer';
import { SetupScreen } from './features/setup/SetupScreen';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { cn } from './lib/utils';
import { Input } from './components/ui/input';
import { usePreferences } from './hooks/usePreferences';

type ActiveTab = 'maps' | 'books' | 'combat' | 'monsters' | 'items' | 'tools' | 'globe' | 'inventory' | 'aurus';

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
  const {
    uiScale,
    setUiScale,
    thumbScale,
    setThumbScale,
    anthropicApiKey,
    setAnthropicApiKey,
    chatModel,
    setChatModel,
    fontFamily,
    setFontFamily,
    theme,
    setTheme,
    toolUrls,
    setToolUrls,
    toolFavicons,
    setToolFavicons,
    partyLevel,
    setPartyLevel,
  } = usePreferences();

  const [activeTab, setActiveTab] = useState<ActiveTab>('maps');
  // Bumped when pack mapping is imported via Settings so MapBrowser
  // knows to re-fetch. Passed as a prop — MapBrowser watches it.
  const [packMappingVersion, setPackMappingVersion] = useState(0);
  const [activeToolId, setActiveToolId] = useState(toolUrls[0]?.id ?? '');
  const [chatOpen, setChatOpen] = useState(false);
  const [keywords, setKeywords] = useState('');

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
          <NavTab active={activeTab === 'globe'} onClick={() => setActiveTab('globe')} icon={Globe} label="Globe" />
          <NavTab
            active={activeTab === 'inventory'}
            onClick={() => setActiveTab('inventory')}
            icon={Package}
            label="Inventory"
          />
          <NavTab active={activeTab === 'aurus'} onClick={() => setActiveTab('aurus')} icon={Trophy} label="Aurus" />
          <NavTab active={activeTab === 'tools'} onClick={() => setActiveTab('tools')} icon={Wrench} label="Tools" />
        </nav>
        {/* Search bar — shared across all tabs */}
        {activeTab !== 'tools' &&
          activeTab !== 'globe' &&
          activeTab !== 'inventory' &&
          activeTab !== 'aurus' &&
          activeTab !== 'combat' && (
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
          )}
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
            toolUrls={toolUrls}
            onToolUrlsChange={setToolUrls}
            toolFavicons={toolFavicons}
            onToolFaviconsChange={setToolFavicons}
            partyLevel={partyLevel}
            onPartyLevelChange={setPartyLevel}
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
          {activeTab === 'combat' && <CombatTab partyLevel={partyLevel} anthropicApiKey={anthropicApiKey} />}
          {activeTab === 'monsters' && <MonsterBrowser keywords={keywords} />}
          {activeTab === 'items' && <ItemBrowser keywords={keywords} />}
          {activeTab === 'globe' && <GlobeViewer />}
          {activeTab === 'inventory' && <InventoryTab />}
          {activeTab === 'aurus' && <AurusTab />}
          {activeTab === 'tools' && (
            <ToolsBrowser
              tools={toolUrls}
              useFavicons={toolFavicons}
              activeId={activeToolId}
              onActiveIdChange={setActiveToolId}
            />
          )}
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
          activeToolUrl={activeTab === 'tools' ? toolUrls.find((t) => t.id === activeToolId)?.url : undefined}
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
