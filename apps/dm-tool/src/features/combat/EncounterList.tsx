import { Plus, Trash2 } from 'lucide-react';
import type { Encounter } from '@dm-tool/shared/types';
import { cn } from '@/lib/utils';

interface Props {
  encounters: Encounter[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

export function EncounterList({ encounters, activeId, loading, onSelect, onCreate, onDelete }: Props) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid hsl(var(--border))',
        }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Encounters</span>
        <button
          type="button"
          onClick={onCreate}
          aria-label="New encounter"
          title="New encounter"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading ? (
          <div style={{ padding: 12, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Loading…</div>
        ) : encounters.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
            No encounters yet. Click + to create one.
          </div>
        ) : (
          encounters.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(e.id)}
              className={cn(
                'group flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/40',
                e.id === activeId && 'bg-accent/60',
              )}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="truncate font-medium"
                  style={{ color: e.id === activeId ? 'hsl(var(--foreground))' : 'hsl(var(--foreground) / 0.85)' }}
                >
                  {e.name || '(unnamed)'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {e.combatants.length} {e.combatants.length === 1 ? 'combatant' : 'combatants'} · round {e.round}
                </div>
              </div>
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (window.confirm(`Delete encounter "${e.name}"?`)) onDelete(e.id);
                }}
                aria-label={`Delete ${e.name}`}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </button>
          ))
        )}
      </div>
    </>
  );
}
