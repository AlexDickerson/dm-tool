// AI-generated pack groupings for map files. Row-per-file; the cached
// mapping is whatever's in the table. Populated by parseAndCacheMapping
// (from the Claude paste flow) and touched up by mergePacks.

import { getPf2eDb } from './connection.js';

export function listPackMappings(): Record<string, string> {
  const rows = getPf2eDb().prepare('SELECT file_name, pack_name FROM pack_mappings').all() as Array<{
    file_name: string;
    pack_name: string;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.file_name] = r.pack_name;
  return out;
}

export function hasPackMappings(): boolean {
  const row = getPf2eDb().prepare('SELECT 1 FROM pack_mappings LIMIT 1').get();
  return row !== undefined;
}

export function replacePackMappings(mapping: Record<string, string>): void {
  const db = getPf2eDb();
  const deleteAll = db.prepare('DELETE FROM pack_mappings');
  const insert = db.prepare('INSERT INTO pack_mappings (file_name, pack_name) VALUES (?, ?)');
  const tx = db.transaction(() => {
    deleteAll.run();
    for (const [fileName, packName] of Object.entries(mapping)) {
      insert.run(fileName, packName);
    }
  });
  tx();
}

export function upsertPackMapping(fileName: string, packName: string): void {
  getPf2eDb()
    .prepare(
      'INSERT INTO pack_mappings (file_name, pack_name) VALUES (?, ?) ON CONFLICT(file_name) DO UPDATE SET pack_name = excluded.pack_name',
    )
    .run(fileName, packName);
}

export function renamePackMappings(sourcePacks: string[], targetName: string): void {
  if (sourcePacks.length === 0) return;
  const placeholders = sourcePacks.map(() => '?').join(', ');
  getPf2eDb()
    .prepare(`UPDATE pack_mappings SET pack_name = ? WHERE pack_name IN (${placeholders})`)
    .run(targetName, ...sourcePacks);
}
