// DM-side view for the Aurus leaderboard. Manage teams, combat power, and
// value reclaimed. Writes push live to the sidecar so the player portal's
// /leaderboard route updates immediately.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AurusTeam } from '@dm-tool/shared/types';

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
    const list = await api.aurusList();
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
            await api.aurusUpsert({ ...t, isPlayerParty: false, updatedAt: new Date().toISOString() });
          }
        }
      }
      await api.aurusUpsert(next);
      await refresh();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh, teams]);

  const handleDelete = useCallback(
    async (id: string) => {
      await api.aurusDelete(id);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
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

      <div className="flex-1 overflow-y-auto rounded-md border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-[1] bg-background">
            <tr className="border-b border-border text-left">
              <th className="w-[40px] px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="w-[110px] px-3 py-2 font-medium">Combat</th>
              <th className="w-[140px] px-3 py-2 font-medium">Value (gp)</th>
              <th className="w-[60px] px-3 py-2" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No teams yet. Click &ldquo;Add team&rdquo; to get started.
                </td>
              </tr>
            ) : (
              ranked.map((t, idx) => (
                <tr
                  key={t.id}
                  onClick={() => setEditing(t)}
                  className={cn('cursor-pointer border-b border-border', t.isPlayerParty && 'bg-accent')}
                >
                  <td className="px-3 py-2 font-semibold">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: t.color }} />
                      <span>{t.name || <span className="text-muted-foreground">(unnamed)</span>}</span>
                      {t.isPlayerParty && (
                        <span className="rounded-sm bg-primary/15 px-1.5 text-[10px] uppercase tracking-wide text-primary">
                          Party
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">{t.combatPower.toLocaleString()}</td>
                  <td className="px-3 py-2">{cpToGp(t.valueReclaimedCp)}</td>
                  <td className="px-3 py-2">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[480px] max-w-[90vw] flex-col gap-3 rounded-lg border border-border bg-background p-6"
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
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div>
            <Label htmlFor="team-color">Color</Label>
            <Input
              id="team-color"
              type="color"
              value={team.color}
              onChange={(e) => onChange({ ...team, color: e.target.value })}
              className="h-9 p-0.5"
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="team-combat">Combat power</Label>
            <div className="flex gap-1">
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
        <div className="flex items-center gap-2">
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
        <div className="mt-2 flex justify-end gap-2">
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
