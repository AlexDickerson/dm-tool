// Combat tracker top-level. Three-column layout:
//   - Left: encounter list (create/delete/select)
//   - Middle: initiative tracker (add combatants, roll, advance turn)
//   - Right: always-visible stat block for the current actor
//
// Encounter state is persisted via the `encounters*` IPC surface. Every
// mutation runs through `saveEncounter()` which upserts to SQLite and
// refreshes the local list — keeps the DB as the single source of truth.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import type { Encounter } from '@dm-tool/shared/types';
import { EncounterList } from './EncounterList';
import { InitiativeTracker } from './InitiativeTracker';
import { CombatantStatBlock } from './CombatantStatBlock';
import { LootPanel } from './LootPanel';
import { sortedCombatants } from './util';

interface CombatTabProps {
  partyLevel: number;
  anthropicApiKey: string;
}

export function CombatTab({ partyLevel, anthropicApiKey }: CombatTabProps) {
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<Encounter[]> => {
    const list = await api.encountersList();
    setEncounters(list);
    return list;
  }, []);

  useEffect(() => {
    refresh()
      .then((list) => setActiveId((id) => id ?? list[0]?.id ?? null))
      .catch((e) => console.error('encountersList failed:', e))
      .finally(() => setLoading(false));
  }, [refresh]);

  const saveEncounter = useCallback(
    async (next: Encounter): Promise<void> => {
      const stamped: Encounter = { ...next, updatedAt: new Date().toISOString() };
      await api.encountersUpsert(stamped);
      await refresh();
    },
    [refresh],
  );

  const createEncounter = useCallback(async (): Promise<void> => {
    const now = new Date().toISOString();
    const enc: Encounter = {
      id: crypto.randomUUID(),
      name: 'New encounter',
      combatants: [],
      turnIndex: 0,
      round: 1,
      loot: [],
      allowInventedItems: false,
      createdAt: now,
      updatedAt: now,
    };
    await api.encountersUpsert(enc);
    const list = await refresh();
    // Select the one we just created rather than relying on ordering quirks.
    setActiveId(list.find((e) => e.id === enc.id)?.id ?? enc.id);
  }, [refresh]);

  const deleteEncounter = useCallback(
    async (id: string): Promise<void> => {
      await api.encountersDelete(id);
      const list = await refresh();
      setActiveId((curr) => (curr === id ? (list[0]?.id ?? null) : curr));
    },
    [refresh],
  );

  const active = useMemo(() => encounters.find((e) => e.id === activeId) ?? null, [encounters, activeId]);

  const currentActor = useMemo(() => {
    if (!active || active.combatants.length === 0) return null;
    const order = sortedCombatants(active.combatants);
    return order[active.turnIndex] ?? null;
  }, [active]);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: '1px solid hsl(var(--border))',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <EncounterList
          encounters={encounters}
          activeId={activeId}
          loading={loading}
          onSelect={setActiveId}
          onCreate={() => {
            void createEncounter();
          }}
          onDelete={(id) => {
            void deleteEncounter(id);
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0 }}>
        {active ? (
          <>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <InitiativeTracker encounter={active} onChange={saveEncounter} />
              </div>
              <LootPanel
                encounter={active}
                partyLevel={partyLevel}
                anthropicApiKey={anthropicApiKey}
                onChange={saveEncounter}
              />
            </div>
            <ResizableSidebar
              storageKey="dmtool.sidebar.combatStatBlock"
              side="right"
              defaultWidth={380}
              minWidth={260}
              maxWidth={1000}
            >
              <div
                style={{
                  height: '100%',
                  borderLeft: '1px solid hsl(var(--border))',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <CombatantStatBlock combatant={currentActor} round={active.round} />
              </div>
            </ResizableSidebar>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'hsl(var(--muted-foreground))',
              fontSize: 13,
            }}
          >
            {loading ? 'Loading…' : 'No encounter selected.'}
          </div>
        )}
      </div>
    </div>
  );
}
