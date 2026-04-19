// Aurus leaderboard — team scores persisted as JSON rows. Same pattern as
// inventory and encounters: JSON blob so schema additions only touch
// shared/types.ts. The sidecar is the live-sync authority.

import type { AurusTeam } from '@dm-tool/shared/types';
import { getPf2eDb } from './connection.js';

export function listAurusTeams(): AurusTeam[] {
  const rows = getPf2eDb().prepare('SELECT data FROM aurus_teams ORDER BY id').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as AurusTeam);
}

export function upsertAurusTeam(team: AurusTeam): void {
  getPf2eDb()
    .prepare(
      'INSERT INTO aurus_teams (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    )
    .run(team.id, JSON.stringify(team), team.updatedAt);
}

export function deleteAurusTeam(id: string): void {
  getPf2eDb().prepare('DELETE FROM aurus_teams WHERE id = ?').run(id);
}
