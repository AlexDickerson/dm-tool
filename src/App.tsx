import { useCallback, useEffect, useState } from "react";
import { ClipboardCopy, FolderOpen, MessageSquare, Settings } from "lucide-react";
import { MapBrowser } from "./features/map-browser/MapBrowser";
import { BookBrowser } from "./features/book-browser/BookBrowser";
import { ChatDrawer } from "./features/chat/ChatDrawer";
import { cn } from "./lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { Slider } from "./components/ui/slider";
import { Label } from "./components/ui/label";
import { Input } from "./components/ui/input";

// UI scale knob — wired through to the root font-size in CSS so every
// rem-based Tailwind utility responds. Stored in localStorage so the
// preference survives restarts. The native window-control overlay strip
// (managed by Electron, not CSS) is also resized via IPC so the OS
// min/max/close buttons stay flush with the React header.
const UI_SCALE_KEY = "dmtool.uiScale";
const UI_DEFAULT = 18;
const UI_MIN = 14;
const UI_MAX = 24;
// Header is `h-12` = 3rem; the native overlay must match that in pixels.
const HEADER_REMS = 3;

// Thumbnail size knob — multiplier applied to ThumbnailGrid's base
// THUMB_WIDTH/HEIGHT constants. Independent of UI_SCALE because the user
// often wants chrome small and thumbs big (or vice versa).
const THUMB_SCALE_KEY = "dmtool.thumbScale";
const THUMB_DEFAULT = 1;
const THUMB_MIN = 0.7;
const THUMB_MAX = 2;

// Anthropic API key — used by the encounter-hook regenerator in the
// detail pane. Stored in localStorage rather than the OS keychain because
// this is a single-user personal tool; if/when this app grows to multi-
// user we should move it to safeStorage.
const API_KEY_KEY = "dmtool.anthropicApiKey";
const MODEL_KEY = "dmtool.chatModel";
const MODEL_DEFAULT = "claude-sonnet-4-6";

function loadString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
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

type ActiveTab = "maps" | "books" | "combat" | "monsters" | "items";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("maps");
  // Bumped when pack mapping is imported via Settings so MapBrowser
  // knows to re-fetch. Passed as a prop — MapBrowser watches it.
  const [packMappingVersion, setPackMappingVersion] = useState(0);
  const [uiScale, setUiScale] = useState<number>(() =>
    loadNumber(UI_SCALE_KEY, UI_DEFAULT, UI_MIN, UI_MAX),
  );
  const [thumbScale, setThumbScale] = useState<number>(() =>
    loadNumber(THUMB_SCALE_KEY, THUMB_DEFAULT, THUMB_MIN, THUMB_MAX),
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState<string>(() =>
    loadString(API_KEY_KEY),
  );
  const [chatModel, setChatModel] = useState<string>(() =>
    loadString(MODEL_KEY) || MODEL_DEFAULT,
  );
  const [chatOpen, setChatOpen] = useState(false);

  // Apply the UI scale to the root <html> element and tell the main
  // process to resize the native title-bar overlay to match. Runs on
  // mount (so a saved preference is restored) and on every scale change.
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}px`;
    try {
      localStorage.setItem(UI_SCALE_KEY, String(uiScale));
    } catch {
      // Storage may be unavailable in some embedded contexts; non-fatal.
    }
    // The native min/max/close buttons live outside the DOM, so we have
    // to push their height through IPC. Header is HEADER_REMS rem tall,
    // so the pixel height equals uiScale * HEADER_REMS.
    window.electronAPI
      ?.setTitleBarOverlayHeight(uiScale * HEADER_REMS)
      .catch(() => {
        // Ignore — older builds without this IPC handler shouldn't crash
        // the renderer; the overlay will just stay at its default height.
      });
  }, [uiScale]);

  // Persist thumb scale separately. ThumbnailGrid reads this via prop
  // and recomputes column count + virtualizer measurements when it
  // changes.
  useEffect(() => {
    try {
      localStorage.setItem(THUMB_SCALE_KEY, String(thumbScale));
    } catch {
      // non-fatal
    }
  }, [thumbScale]);

  // Persist API key. Empty string means "not set" — the regenerate
  // button in DetailPane checks for this and surfaces a friendly error
  // pointing the user back to the settings dialog.
  useEffect(() => {
    try {
      if (anthropicApiKey) {
        localStorage.setItem(API_KEY_KEY, anthropicApiKey);
      } else {
        localStorage.removeItem(API_KEY_KEY);
      }
    } catch {
      // non-fatal
    }
  }, [anthropicApiKey]);

  useEffect(() => {
    try {
      localStorage.setItem(MODEL_KEY, chatModel);
    } catch {
      // non-fatal
    }
  }, [chatModel]);

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
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <h1
          className="flex items-center text-foreground"
          aria-label="DM Tool"
        >
          <D20Icon className="h-7 w-7" />
        </h1>
        <nav
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <NavTab active={activeTab === "maps"} onClick={() => setActiveTab("maps")}>Maps</NavTab>
          <NavTab active={activeTab === "books"} onClick={() => setActiveTab("books")}>Books</NavTab>
          <NavTab active={activeTab === "combat"} onClick={() => setActiveTab("combat")}>Combat</NavTab>
          <NavTab active={activeTab === "monsters"} onClick={() => setActiveTab("monsters")}>Monsters</NavTab>
          <NavTab active={activeTab === "items"} onClick={() => setActiveTab("items")}>Items</NavTab>
        </nav>
        {/* Settings gear pushed to the right edge of the draggable
            region (just before the reserved native button strip). The
            Dialog trigger lives inside a `no-drag` wrapper so the click
            actually reaches the button instead of starting a window
            drag. */}
        <div
          className="ml-auto flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            aria-label="Toggle chat"
            onClick={() => setChatOpen((o) => !o)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              chatOpen
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <SettingsDialog
            uiScale={uiScale}
            onUiScaleChange={setUiScale}
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
      {/* The divider lives below the header rather than as a `border-b`
          on the header itself. The native min/max/close buttons are
          drawn as an opaque overlay on top of the header region, so a
          border on the header gets visually clipped where the buttons
          sit. Putting the divider in its own strip below the title bar
          lets it span the full window width uninterrupted.
          The `mt-1` (4px) gap pushes the divider clear of the overlay
          region — the native buttons render slightly past the declared
          40px overlay height (DPI rounding / hover padding), so a
          divider flush against the header still gets half-covered. The
          4px gap shows through to the body background (same color as
          header) so it reads as a single uninterrupted title strip. */}
      <div className="mt-1 h-px shrink-0 bg-border" />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main className="h-full overflow-hidden">
          {activeTab === "maps" && (
            <MapBrowser thumbScale={thumbScale} anthropicApiKey={anthropicApiKey} packMappingVersion={packMappingVersion} />
          )}
          {activeTab === "books" && <BookBrowser />}
        </main>
        <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} anthropicApiKey={anthropicApiKey} chatModel={chatModel} />
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
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

type SettingsTab = "maps" | "books" | "combat" | "monsters" | "items";

function SettingsDialog({
  uiScale,
  onUiScaleChange,
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
  thumbScale: number;
  onThumbScaleChange: (n: number) => void;
  anthropicApiKey: string;
  onAnthropicApiKeyChange: (s: string) => void;
  onPackMappingImported: () => void;
  chatModel: string;
  onChatModelChange: (s: string) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("maps");
  const [exportCopied, setExportCopied] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

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
        setImportStatus("Imported successfully");
        onPackMappingImported();
        setTimeout(() => setImportStatus(null), 3000);
      }
    } catch (e) {
      setImportStatus(`Error: ${(e as Error).message}`);
    }
  }, [onPackMappingImported]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure the app and its tools.
          </DialogDescription>
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
              Powers AI features (encounter hooks, map tagging). Stored
              locally on this machine.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ui-scale" className="text-xs font-medium">
                UI Size
              </Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {uiScale}px
              </span>
            </div>
            <Slider
              id="ui-scale"
              min={UI_MIN}
              max={UI_MAX}
              step={1}
              value={[uiScale]}
              onValueChange={(v) => onUiScaleChange(v[0] ?? uiScale)}
            />
          </div>

          {/* Per-page tabs */}
          <div className="border-t border-border pt-4">
            <nav className="flex gap-1">
              {(["maps", "books", "combat", "monsters", "items"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    tab === t
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </nav>

            <div className="mt-4 space-y-4">
              {tab === "maps" && (
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
                      min={THUMB_MIN}
                      max={THUMB_MAX}
                      step={0.05}
                      value={[thumbScale]}
                      onValueChange={(v) => onThumbScaleChange(v[0] ?? thumbScale)}
                    />
                    <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground">
                      Resizes each card in the map browser grid.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-medium">
                      Pack Grouping
                    </Label>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Export a prompt, send it to Claude, then import the
                      JSON to improve how map variants are grouped.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportPrompt}
                        className="gap-1.5"
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                        {exportCopied ? "Copied!" : "Export prompt"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleImportGrouping}
                        className="gap-1.5"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        Import grouping
                      </Button>
                    </div>
                    {importStatus && (
                      <p className={cn(
                        "text-[11px]",
                        importStatus.startsWith("Error") ? "text-destructive" : "text-green-400",
                      )}>
                        {importStatus}
                      </p>
                    )}
                  </div>
                </>
              )}

              {tab === "books" && (
                <p className="text-xs text-muted-foreground">
                  No book-specific settings yet.
                </p>
              )}

              {tab === "combat" && (
                <p className="text-xs text-muted-foreground">
                  No combat settings yet.
                </p>
              )}

              {tab === "monsters" && (
                <p className="text-xs text-muted-foreground">
                  No monster settings yet.
                </p>
              )}

              {tab === "items" && (
                <p className="text-xs text-muted-foreground">
                  No item settings yet.
                </p>
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
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="claude-haiku-4-5-20251001">Haiku 4.5 — fast, cheap</option>
              <option value="claude-sonnet-4-6">Sonnet 4.6 — balanced</option>
              <option value="claude-opus-4-6">Opus 4.6 — smartest, slowest</option>
            </select>
            <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Model used by the chat assistant. Higher tiers are smarter
              but cost more per message.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

