import { useEffect } from 'react';
import { Wrench } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ToolEntry } from '../../lib/constants';

export function ToolsBrowser({
  tools,
  useFavicons,
  activeId,
  onActiveIdChange,
}: {
  tools: ToolEntry[];
  useFavicons: boolean;
  activeId: string;
  onActiveIdChange: (id: string) => void;
}) {
  // If active tab was removed, fall back to first
  const resolved = tools.find((t) => t.id === activeId) ? activeId : (tools[0]?.id ?? '');
  useEffect(() => {
    if (resolved !== activeId) onActiveIdChange(resolved);
  }, [resolved, activeId, onActiveIdChange]);

  if (tools.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Wrench className="h-12 w-12 opacity-20" />
          <p className="text-sm">Add tool sites in Settings to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Vertical sidebar on the left */}
      <div className="flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/50 bg-background/60 p-1.5">
        {tools.map((t) => {
          const hostname = (() => {
            try {
              return new URL(t.url).hostname;
            } catch {
              return '';
            }
          })();

          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onActiveIdChange(t.id)}
              title={t.label}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                resolved === t.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=16`}
                alt=""
                className="h-4 w-4 shrink-0"
              />
              {!useFavicons && t.label}
            </button>
          );
        })}
      </div>

      {/* Iframe container */}
      <div className="relative min-h-0 min-w-0 flex-1">
        {tools.map((t) => (
          <iframe
            key={t.id}
            src={t.url}
            title={t.label}
            className="absolute inset-0 h-full w-full border-0"
            style={{ display: resolved === t.id ? 'block' : 'none' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ))}
      </div>
    </div>
  );
}
