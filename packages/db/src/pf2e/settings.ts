// Key/value settings table. Current API is string-only — set/get/replace all
// take and return strings. Values are JSON-encoded on write (so a string `foo`
// is stored as `"foo"`) and decoded on read; if the stored payload isn't a
// JSON string (legacy rows from earlier experiments, or any future row with
// a richer shape), the raw column value is passed through unchanged.

import { getPf2eDb } from './connection.js';
import { tryParseJson } from './internal.js';

export function getSetting(key: string): string | null {
  const row = getPf2eDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  const parsed = tryParseJson<unknown>(row.value, null);
  return typeof parsed === 'string' ? parsed : row.value;
}

export function setSetting(key: string, value: string): void {
  getPf2eDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function deleteSetting(key: string): void {
  getPf2eDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function getAllSettings(): Record<string, string> {
  const rows = getPf2eDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) {
    const parsed = tryParseJson<unknown>(r.value, null);
    out[r.key] = typeof parsed === 'string' ? parsed : r.value;
  }
  return out;
}

export function replaceSettings(settings: Record<string, string>): void {
  const db = getPf2eDb();
  const deleteAll = db.prepare('DELETE FROM settings');
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    deleteAll.run();
    for (const [key, value] of Object.entries(settings)) {
      insert.run(key, JSON.stringify(value));
    }
  });
  tx();
}
