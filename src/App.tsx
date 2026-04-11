import { MapBrowser } from "./features/map-browser/MapBrowser";

// For now the entire app is just the map browser. As more features come
// online (combat tracker, NPC browser, etc.) this will grow into a real
// shell with sidebar navigation. Keeping the shell trivial until then.
export default function App() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">DM Tool</h1>
        <span className="text-xs text-muted-foreground">Map Browser</span>
      </header>
      <main className="flex-1 overflow-hidden">
        <MapBrowser />
      </main>
    </div>
  );
}
