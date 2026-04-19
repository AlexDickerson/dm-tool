// Globe pins (world map annotations) + their optional mirrored mission
// markdown. Mission markdown is refreshed from the linked Obsidian note
// every time we build a push payload, so the DB row mirrors the last-read
// file content for the player-portal to display without Obsidian access.

import type { GlobePin } from '@dm-tool/shared/types';
import { getPf2eDb } from './connection.js';

export function listGlobePins(): GlobePin[] {
  return getPf2eDb().prepare('SELECT id, lng, lat, label, icon, zoom, note, kind FROM globe_pins').all() as GlobePin[];
}

export function upsertGlobePin(pin: GlobePin): void {
  getPf2eDb()
    .prepare(
      'INSERT INTO globe_pins (id, lng, lat, label, icon, zoom, note, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET lng=excluded.lng, lat=excluded.lat, label=excluded.label, icon=excluded.icon, zoom=excluded.zoom, note=excluded.note, kind=excluded.kind',
    )
    .run(pin.id, pin.lng, pin.lat, pin.label, pin.icon, pin.zoom, pin.note, pin.kind);
}

/** Cache the Obsidian mission note's markdown onto its pin row. Called
 *  every time we build the push payload so the DB mirrors whatever
 *  content the last-read-file had. Pass `null` to clear. */
export function setMissionMarkdown(pinId: string, markdown: string | null): void {
  getPf2eDb().prepare('UPDATE globe_pins SET mission_markdown = ? WHERE id = ?').run(markdown, pinId);
}

export function getMissionMarkdown(pinId: string): string | null {
  const row = getPf2eDb().prepare('SELECT mission_markdown FROM globe_pins WHERE id = ?').get(pinId) as
    | { mission_markdown: string | null }
    | undefined;
  return row?.mission_markdown ?? null;
}

export function deleteGlobePin(id: string): void {
  getPf2eDb().prepare('DELETE FROM globe_pins WHERE id = ?').run(id);
}
