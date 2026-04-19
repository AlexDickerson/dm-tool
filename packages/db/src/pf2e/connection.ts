// Connection lifecycle for pf2e.db — the app-owned SQLite file that stores
// dm-tool's mutable state (settings, globe pins, inventory, encounters, etc.)
// alongside the pre-built PF2e compendium tables (monsters, items) that
// chat tools and the Items/Monsters browsers read.
//
// Single module-level handle: callers open once at startup, then every
// domain module imports getPf2eDb() from here.

import Database from 'better-sqlite3';
import { migratePf2eDb } from './migrations.js';

let db: Database.Database | null = null;

export function openPf2eDb(path: string): void {
  if (db) return;
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  migratePf2eDb(db);
}

/** Check whether the DB has been opened. Lets callers skip features
 *  that depend on pf2e.db without having to try/catch getPf2eDb(). */
export function isPf2eDbOpen(): boolean {
  return db !== null;
}

export function closePf2eDb(): void {
  db?.close();
  db = null;
}

/** Returns the open handle; throws if openPf2eDb() hasn't been called yet.
 *  Exposed so callers (BookDb, loot gen) can query directly without going
 *  through a wrapper. */
export function getPf2eDb(): Database.Database {
  if (!db) throw new Error('PF2e database not initialized');
  return db;
}
