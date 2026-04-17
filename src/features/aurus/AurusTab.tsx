// DM-side view for the Aurus leaderboard. Manage teams, combat power, and
// value reclaimed. Writes push live to the sidecar so the player portal's
// /leaderboard route updates immediately.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { AurusTeam } from '../../../shared/types';

function blankTeam(): AurusTeam {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: '',
    emblem: undefined,
    color: '#e4a547',
    combatPower: 0,
    valueReclaimedCp: 0,
    isPlayerParty: false,
    note: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function cpToGp(cp: number): string {
  return (cp / 100).toFixed(2);
}

export function AurusTab() {
  const [teams, setTeams] = useState<AurusTeam[]>([]);
  const [editing, setEditing] = useState<AurusTeam | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const list = await window.electronAPI.aurusList();
    setTeams(list);
  }, []);

  useEffect(() => {
    refresh().catch((e) => console.error('aurusList failed:', e));
  }, [refresh]);

  const ranked = useMemo(() => {
    // Combined ordering: combatPower + valueReclaimed weighted equally by
    // gp-scale. Raw fields are stored separately so this formula can evolve
    // without data migration.
    return [...teams].sort((a, b) => {
      const aScore = a.combatPower + a.valueReclaimedCp / 100;
      const bScore = b.combatPower + b.valueReclaimedCp / 100;
      return bScore - aScore;
    });
  }, [teams]);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const next: AurusTeam = { ...editing, updatedAt: new Date().toISOString() };
      // Enforce exactly-one player party: if this one is flagged, unset others.
      if (next.isPlayerParty) {
        for (const t of teams) {
          if (t.id !== next.id && t.isPlayerParty) {
            await window.electronAPI.aurusUpsert({ ...t, isPlayerParty: false, updatedAt: new Date().toISOString() });
          }
        }
      }
      await window.electronAPI.aurusUpsert(next);
      await refresh();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh, teams]);

  const handleDelete = useCallback(
    async (id: string) => {
      await window.electronAPI.aurusDelete(id);
      await refresh();
    },
    [refresh],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 className="text-lg font-semibold">Aurus Leaderboard</h2>
          <p className="text-xs text-muted-foreground">
            {teams.length} teams · ranked by combat power + value reclaimed
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing(blankTeam())}>
          <Plus className="mr-1 h-4 w-4" /> Add team
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'hsl(var(--background))', zIndex: 1 }}>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid hsl(var(--border))' }}>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 40 }}>#</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Name</th>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 110 }}>Combat</th>
              <th style={{ padding: '8px 12px', fontWeight: 500, width: 140 }}>Value (gp)</th>
              <th style={{ padding: '8px 12px', width: 60 }} aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>
                  No teams yet. Click &ldquo;Add team&rdquo; to get started.
                </td>
              </tr>
            ) : (
              ranked.map((t, idx) => (
                <tr
                  key={t.id}
                  onClick={() => setEditing(t)}
                  style={{
                    borderBottom: '1px solid hsl(var(--border))',
                    cursor: 'pointer',
                    backgroundColor: t.isPlayerParty ? 'hsl(var(--accent))' : undefined,
                  }}
                >
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{idx + 1}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          backgroundColor: t.color,
                          display: 'inline-block',
                        }}
                      />
                      <span>{t.name || <span style={{ color: 'hsl(var(--muted-foreground))' }}>(unnamed)</span>}</span>
                      {t.isPlayerParty && (
                        <span className="rounded-sm bg-primary/15 px-1.5 text-[10px] uppercase tracking-wide text-primary">
                          Party
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{t.combatPower.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px' }}>{cpToGp(t.valueReclaimedCp)}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(t.id);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Delete team"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <TeamEditor
          team={editing}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}
    </div>
  );
}

function TeamEditor({
  team,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  team: AurusTeam;
  onChange: (next: AurusTeam) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
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
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '90vw',
          backgroundColor: 'hsl(var(--background))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 8,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 className="text-base font-semibold">Team details</h3>
        <div>
          <Label htmlFor="team-name">Name</Label>
          <Input
            id="team-name"
            value={team.name}
            onChange={(e) => onChange({ ...team, name: e.target.value })}
            autoFocus
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
          <div>
            <Label htmlFor="team-color">Color</Label>
            <Input
              id="team-color"
              type="color"
              value={team.color}
              onChange={(e) => onChange({ ...team, color: e.target.value })}
              style={{ padding: 2, height: 36 }}
            />
          </div>
          <div>
            <Label htmlFor="team-emblem">Emblem (free text)</Label>
            <Input
              id="team-emblem"
              placeholder="e.g. crossed-swords"
              value={team.emblem ?? ''}
              onChange={(e) => onChange({ ...team, emblem: e.target.value || undefined })}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <Label htmlFor="team-combat">Combat power</Label>
            <div style={{ display: 'flex', gap: 4 }}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange({ ...team, combatPower: team.combatPower - 50 })}
              >
                −50
              </Button>
              <Input
                id="team-combat"
                type="number"
                value={team.combatPower}
                onChange={(e) => onChange({ ...team, combatPower: parseInt(e.target.value, 10) || 0 })}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange({ ...team, combatPower: team.combatPower + 50 })}
              >
                +50
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="team-value">Value reclaimed (copper)</Label>
            <Input
              id="team-value"
              type="number"
              min={0}
              value={team.valueReclaimedCp}
              onChange={(e) => onChange({ ...team, valueReclaimedCp: parseInt(e.target.value, 10) || 0 })}
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id="team-party"
            type="checkbox"
            checked={team.isPlayerParty}
            onChange={(e) => onChange({ ...team, isPlayerParty: e.target.checked })}
          />
          <Label htmlFor="team-party" className="cursor-pointer">
            This is the player party (highlighted on the leaderboard)
          </Label>
        </div>
        <div>
          <Label htmlFor="team-note">Note</Label>
          <Input
            id="team-note"
            value={team.note ?? ''}
            onChange={(e) => onChange({ ...team, note: e.target.value || undefined })}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || !team.name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
