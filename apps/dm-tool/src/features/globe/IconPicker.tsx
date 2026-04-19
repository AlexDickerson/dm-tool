import { useMemo, useState } from 'react';
import { ALL_ICON_NAMES, SUGGESTED_ICONS, getIconBody } from './globe-icons';

interface IconPickerProps {
  selected: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}

function IconButton({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  const body = getIconBody(name);
  if (!body) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
      style={{ width: 36, height: 36 }}
      dangerouslySetInnerHTML={{
        __html: `<svg viewBox="0 0 512 512" fill="currentColor" width="20" height="20">${body}</svg>`,
      }}
    />
  );
}

export function IconPicker({ selected, onSelect, onClose }: IconPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return SUGGESTED_ICONS;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return SUGGESTED_ICONS;

    // Score each icon: every query term must match at least one word in the
    // icon name (prefix match). Better matches (shorter word = tighter fit)
    // score higher and sort first.
    const scored: { name: string; score: number }[] = [];
    for (const name of ALL_ICON_NAMES) {
      const words = name.split('-');
      let totalScore = 0;
      let allMatch = true;
      for (const term of terms) {
        let best = 0;
        for (const w of words) {
          if (w === term) {
            best = Math.max(best, 3);
          } else if (w.startsWith(term)) {
            best = Math.max(best, 2);
          } else if (w.includes(term)) {
            best = Math.max(best, 1);
          }
        }
        if (best === 0) {
          allMatch = false;
          break;
        }
        totalScore += best;
      }
      if (allMatch) scored.push({ name, score: totalScore });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 120).map((s) => s.name);
  }, [query]);

  return (
    <div
      className="absolute left-3 top-14 z-10 flex flex-col rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur-sm"
      style={{ width: 340, maxHeight: 400 }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons..."
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => {
            onSelect('');
            onClose();
          }}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Default
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex flex-wrap gap-1">
          {filtered.map((name) => (
            <IconButton
              key={name}
              name={name}
              active={name === selected}
              onClick={() => {
                onSelect(name);
                onClose();
              }}
            />
          ))}
          {filtered.length === 0 && <p className="p-3 text-xs text-muted-foreground">No icons match "{query}"</p>}
        </div>
      </div>
    </div>
  );
}
