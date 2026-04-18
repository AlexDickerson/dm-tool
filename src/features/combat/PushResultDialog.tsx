// Modal shown after a "Push to Foundry" completes. Lists each created
// actor (including the pack it was sourced from — the DM can spot when
// a monster got matched to a variant they didn't intend, e.g. "Goblin
// Commando (BB)" when they wanted the standard Monster Core entry)
// and each skipped combatant with a reason.

import { CheckCircle2, FolderOpen, X, XCircle } from 'lucide-react';
import type { PushEncounterResult } from '@shared/types';
import { Button } from '@/components/ui/button';

interface Props {
  result: PushEncounterResult;
  onClose: () => void;
}

export function PushResultDialog({ result, onClose }: Props) {
  const createdCount = result.created.length;
  const skippedCount = result.skipped.length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '80vh',
          backgroundColor: 'hsl(var(--background))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid hsl(var(--border))',
          }}
        >
          <h3 className="flex-1 text-sm font-semibold">Push to Foundry — results</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderBottom: '1px solid hsl(var(--border))',
            background: 'hsl(var(--muted) / 0.3)',
            fontSize: 12,
          }}
        >
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="tabular-nums">{createdCount}</span>
            <span className="text-muted-foreground">created</span>
          </span>
          {skippedCount > 0 && (
            <span className="flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-amber-500" />
              <span className="tabular-nums">{skippedCount}</span>
              <span className="text-muted-foreground">skipped</span>
            </span>
          )}
          {result.folderName && (
            <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{result.folderName}</span>
              <span className="text-[10px]">({result.folderCreated ? 'new' : 'existing'})</span>
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {createdCount > 0 && (
            <section>
              <SectionLabel>Created</SectionLabel>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.created.map((c) => (
                  <li
                    key={c.actorId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 8px',
                      border: '1px solid hsl(var(--border) / 0.5)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                    <span className="font-medium">{c.actorName}</span>
                    {c.actorName !== c.monsterName && (
                      <span className="text-[10px] text-muted-foreground">← {c.monsterName}</span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">{c.sourcePackLabel}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {skippedCount > 0 && (
            <section>
              <SectionLabel>Skipped</SectionLabel>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.skipped.map((s, i) => (
                  <li
                    key={`${s.displayName}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 8px',
                      border: '1px solid hsl(var(--border) / 0.5)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <XCircle className="h-3 w-3 shrink-0 text-amber-500" />
                    <span className="font-medium">{s.displayName}</span>
                    {s.monsterName && s.monsterName !== s.displayName && (
                      <span className="text-[10px] text-muted-foreground">({s.monsterName})</span>
                    )}
                    <span className="ml-auto text-[10px] italic text-muted-foreground">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {createdCount === 0 && skippedCount === 0 && (
            <p className="text-center text-xs text-muted-foreground">No monster combatants in this encounter.</p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 16px',
            borderTop: '1px solid hsl(var(--border))',
          }}
        >
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>
  );
}
