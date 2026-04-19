// Encounters — initiative, combatants, loot — persisted as JSON rows.
// Older rows may be missing fields added after they were written, so
// listEncounters() normalizes on read to keep the renderer defensive-free.

import type { Encounter } from '@dm-tool/shared/types';
import { getPf2eDb } from './connection.js';

/** Backfill fields that may be missing when an encounter was written by an
 *  older version of the schema (e.g. before loot was introduced). Keeps
 *  the renderer from having to guard every access. */
function normalizeEncounter(raw: Partial<Encounter>): Encounter {
  return {
    id: raw.id ?? '',
    name: raw.name ?? '',
    combatants: raw.combatants ?? [],
    turnIndex: raw.turnIndex ?? 0,
    round: raw.round ?? 1,
    loot: raw.loot ?? [],
    allowInventedItems: raw.allowInventedItems ?? false,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

export function listEncounters(): Encounter[] {
  const rows = getPf2eDb().prepare('SELECT data FROM encounters ORDER BY updated_at DESC').all() as {
    data: string;
  }[];
  return rows.map((r) => normalizeEncounter(JSON.parse(r.data) as Partial<Encounter>));
}

export function upsertEncounter(enc: Encounter): void {
  getPf2eDb()
    .prepare(
      'INSERT INTO encounters (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    )
    .run(enc.id, JSON.stringify(enc), enc.updatedAt);
}

export function deleteEncounter(id: string): void {
  getPf2eDb().prepare('DELETE FROM encounters WHERE id = ?').run(id);
}
