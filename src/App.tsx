import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { MapBrowser } from "./features/map-browser/MapBrowser";
import { BookBrowser } from "./features/book-browser/BookBrowser";
import { cn } from "./lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
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
  const [uiScale, setUiScale] = useState<number>(() =>
    loadNumber(UI_SCALE_KEY, UI_DEFAULT, UI_MIN, UI_MAX),
  );
  const [thumbScale, setThumbScale] = useState<number>(() =>
    loadNumber(THUMB_SCALE_KEY, THUMB_DEFAULT, THUMB_MIN, THUMB_MAX),
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState<string>(() =>
    loadString(API_KEY_KEY),
  );

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
          className="ml-auto"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <SettingsDialog
            uiScale={uiScale}
            onUiScaleChange={setUiScale}
            thumbScale={thumbScale}
            onThumbScaleChange={setThumbScale}
            anthropicApiKey={anthropicApiKey}
            onAnthropicApiKeyChange={setAnthropicApiKey}
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
      <main className="flex-1 overflow-hidden">
        {activeTab === "maps" && (
          <MapBrowser thumbScale={thumbScale} anthropicApiKey={anthropicApiKey} />
        )}
        {activeTab === "books" && <BookBrowser />}
      </main>
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

// Settings dialog. Wraps the shadcn Dialog primitive so we get focus
// trapping, scroll lock, ESC handling, and the standard close button
// for free. Both sliders update parent state live so the user sees the
// effect under the dialog as they drag.
function SettingsDialog({
  uiScale,
  onUiScaleChange,
  thumbScale,
  onThumbScaleChange,
  anthropicApiKey,
  onAnthropicApiKeyChange,
}: {
  uiScale: number;
  onUiScaleChange: (n: number) => void;
  thumbScale: number;
  onThumbScaleChange: (n: number) => void;
  anthropicApiKey: string;
  onAnthropicApiKeyChange: (s: string) => void;
}) {
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
            Tune the look and feel of the app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-2">
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
            <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Scales chrome (title bar, filters, detail pane).
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="thumb-scale" className="text-xs font-medium">
                Map Thumbnail Size
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
              Resizes each card in the map browser grid. Larger cards mean
              fewer columns.
            </p>
          </div>

          {/* Anthropic API key — used by the encounter-hook regenerate
              button in the detail pane. Stored in localStorage; the main
              process never persists it. type=password masks it visually
              but it's not actually encrypted at rest. */}
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
              Enables AI features like regenerating encounter hooks on a
              map. Stored locally on this machine.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

