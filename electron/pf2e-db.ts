// Wrapper around the PF2e SQLite database.
// Used by chat tools for monster, item, and NPC lookups, and as the
// persistent store for dm-tool-owned data like globe pins.

import Database from 'better-sqlite3';
import type { AurusTeam, GlobePin, PartyInventoryItem } from '../shared/types.js';
import { tryParseJson } from './util.js';
import { cleanFoundryMarkup } from '../shared/foundry-markup.js';

let db: Database.Database | null = null;

export function openPf2eDb(path: string): void {
  if (db) return;
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  migratePf2eDb();
}

function migratePf2eDb(): void {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS globe_pins (
      id    TEXT PRIMARY KEY,
      lng   REAL NOT NULL,
      lat   REAL NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      icon  TEXT NOT NULL DEFAULT '',
      zoom  REAL NOT NULL DEFAULT 2
    )
  `);
  // Add columns if migrating from earlier schema.
  const cols = db.prepare("SELECT name FROM pragma_table_info('globe_pins')").all() as { name: string }[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('icon')) db.exec("ALTER TABLE globe_pins ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  if (!has('zoom')) db.exec('ALTER TABLE globe_pins ADD COLUMN zoom REAL NOT NULL DEFAULT 2');
  if (!has('note')) db.exec("ALTER TABLE globe_pins ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  if (!has('kind')) db.exec("ALTER TABLE globe_pins ADD COLUMN kind TEXT NOT NULL DEFAULT 'note'");

  // Party inventory + Aurus leaderboard — persisted as JSON rows so schema
  // changes stay localized to shared/types.ts. The sidecar is the live-sync
  // authority; SQLite here is the DM's source of truth.
  db.exec(`
    CREATE TABLE IF NOT EXISTS party_inventory (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS aurus_teams (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

// --- Globe pins CRUD --------------------------------------------------------

export function listGlobePins(): GlobePin[] {
  return requireDb().prepare('SELECT id, lng, lat, label, icon, zoom, note, kind FROM globe_pins').all() as GlobePin[];
}

export function upsertGlobePin(pin: GlobePin): void {
  requireDb()
    .prepare(
      'INSERT INTO globe_pins (id, lng, lat, label, icon, zoom, note, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET lng=excluded.lng, lat=excluded.lat, label=excluded.label, icon=excluded.icon, zoom=excluded.zoom, note=excluded.note, kind=excluded.kind',
    )
    .run(pin.id, pin.lng, pin.lat, pin.label, pin.icon, pin.zoom, pin.note, pin.kind);
}

export function deleteGlobePin(id: string): void {
  requireDb().prepare('DELETE FROM globe_pins WHERE id = ?').run(id);
}

// --- Party inventory CRUD ---------------------------------------------------

export function listInventory(): PartyInventoryItem[] {
  const rows = requireDb().prepare('SELECT data FROM party_inventory ORDER BY updated_at DESC').all() as {
    data: string;
  }[];
  return rows.map((r) => JSON.parse(r.data) as PartyInventoryItem);
}

export function upsertInventory(item: PartyInventoryItem): void {
  requireDb()
    .prepare(
      'INSERT INTO party_inventory (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    )
    .run(item.id, JSON.stringify(item), item.updatedAt);
}

export function deleteInventory(id: string): void {
  requireDb().prepare('DELETE FROM party_inventory WHERE id = ?').run(id);
}

// --- Aurus teams CRUD -------------------------------------------------------

export function listAurusTeams(): AurusTeam[] {
  const rows = requireDb().prepare('SELECT data FROM aurus_teams ORDER BY id').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as AurusTeam);
}

export function upsertAurusTeam(team: AurusTeam): void {
  requireDb()
    .prepare(
      'INSERT INTO aurus_teams (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    )
    .run(team.id, JSON.stringify(team), team.updatedAt);
}

export function deleteAurusTeam(id: string): void {
  requireDb().prepare('DELETE FROM aurus_teams WHERE id = ?').run(id);
}

export function closePf2eDb(): void {
  db?.close();
  db = null;
}

function requireDb(): Database.Database {
  if (!db) throw new Error('PF2e database not initialized');
  return db;
}

// --- Helpers for cleaning Foundry-style markup ---

/** Map PF2e action-glyph font characters to Unicode symbols. */
const ACTION_GLYPH: Record<string, string> = {
  '1': '◆',
  A: '◆',
  '2': '◆◆',
  D: '◆◆',
  '3': '◆◆◆',
  T: '◆◆◆',
  r: '↺',
  R: '↺',
  f: '◇',
  F: '◇',
};

/** Strip Foundry @-tags and HTML from descriptions.
 *  Uses cleanFoundryMarkup (shared) for @-tag handling, then does the
 *  HTML stripping and action-glyph conversion specific to DB output. */
function cleanDescription(html: string | null): string {
  if (!html) return '';
  // First pass: strip all @Damage, @Check, @Template, @UUID, etc.
  let text = cleanFoundryMarkup(html)
    // Convert action-glyph spans to Unicode before stripping HTML
    .replace(
      /<span[^>]*class="[^"]*action-glyph[^"]*"[^>]*>([^<]*)<\/span>/gi,
      (_, ch: string) => ACTION_GLYPH[ch.trim()] ?? ch,
    )
    .replace(
      /<span[^>]*class="[^"]*pf2-icon[^"]*"[^>]*>([^<]*)<\/span>/gi,
      (_, ch: string) => ACTION_GLYPH[ch.trim()] ?? ch,
    )
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[\s>]/gi, '\n');
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]+>/g, '');
  } while (text !== prev);
  const entities: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
  return text
    .replace(/&(?:nbsp|amp|lt|gt);/g, (m) => entities[m])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Monster queries --------------------------------------------------------

export interface MonsterRow {
  name: string;
  level: number;
  source: string;
  rarity: string;
  size: string;
  creature_type: string;
  traits: string;
  perception: number;
  skills: string;
  str_mod: number;
  dex_mod: number;
  con_mod: number;
  int_mod: number;
  wis_mod: number;
  cha_mod: number;
  ac: number;
  hp: number;
  fort: number;
  ref: number;
  will: number;
  immunities: string;
  weaknesses: string;
  resistances: string;
  speed_land: number;
  speeds_other: string;
  melee: string;
  ranged: string;
  actions: string;
  description: string;
  aon_url: string;
  image_file: string | null;
  token_file: string | null;
}

export interface MonsterResult {
  name: string;
  level: number;
  source: string;
  rarity: string;
  size: string;
  traits: string[];
  hp: number;
  ac: number;
  fort: number;
  ref: number;
  will: number;
  perception: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  speed: string;
  immunities: string;
  weaknesses: string;
  resistances: string;
  melee: string;
  ranged: string;
  abilities: string;
  description: string;
  aon_url: string;
}

function formatMelee(raw: string): string {
  const attacks = tryParseJson<
    Array<{
      name: string;
      bonus: number;
      damage: Array<{ formula: string; type: string; category: string | null }>;
      traits: string[];
    }>
  >(raw, []);
  return attacks
    .map((a) => {
      const traits = a.traits.length ? ` (${a.traits.join(', ')})` : '';
      const dmg = a.damage
        .map((d) => `${d.formula} ${d.type}${d.category === 'persistent' ? ' persistent' : ''}`)
        .join(' plus ');
      return `◆ ${a.name} +${a.bonus}${traits}, Damage ${dmg}`;
    })
    .join('; ');
}

function formatActions(raw: string): string {
  const actions = tryParseJson<
    Array<{
      name: string;
      action_type: string;
      actions: number | null;
      traits: string[];
      description: string;
    }>
  >(raw, []);
  return actions
    .map((a) => {
      const actionCost =
        a.action_type === 'passive'
          ? ''
          : a.actions === 1
            ? '◆ '
            : a.actions === 2
              ? '◆◆ '
              : a.actions === 3
                ? '◆◆◆ '
                : a.action_type === 'reaction'
                  ? '⟳ '
                  : a.action_type === 'free'
                    ? '◇ '
                    : '';
      const traits = a.traits.length ? ` (${a.traits.join(', ')})` : '';
      const desc = cleanDescription(a.description);
      return `${actionCost}${a.name}${traits} ${desc}`;
    })
    .join('\n');
}

function formatImmunities(raw: string): string {
  const items = tryParseJson<Array<{ type: string }>>(raw, []);
  return items.map((i) => i.type).join(', ');
}

function formatWeaknesses(raw: string): string {
  const items = tryParseJson<Array<{ type: string; value: number }>>(raw, []);
  return items.map((w) => `${w.type} ${w.value}`).join(', ');
}

function formatSpeed(land: number, other: string): string {
  const parts = [`${land} feet`];
  const extras = tryParseJson<Array<{ type: string; value: number }>>(other, []);
  for (const s of extras) parts.push(`${s.type} ${s.value} feet`);
  return parts.join(', ');
}

function rowToResult(row: MonsterRow): MonsterResult {
  return {
    name: row.name,
    level: row.level,
    source: row.source,
    rarity: row.rarity,
    size: row.size,
    traits: tryParseJson<string[]>(row.traits, []),
    hp: row.hp,
    ac: row.ac,
    fort: row.fort,
    ref: row.ref,
    will: row.will,
    perception: row.perception,
    str: row.str_mod,
    dex: row.dex_mod,
    con: row.con_mod,
    int: row.int_mod,
    wis: row.wis_mod,
    cha: row.cha_mod,
    speed: formatSpeed(row.speed_land, row.speeds_other),
    immunities: formatImmunities(row.immunities),
    weaknesses: formatWeaknesses(row.weaknesses),
    resistances: formatWeaknesses(row.resistances),
    melee: formatMelee(row.melee),
    ranged: formatMelee(row.ranged),
    abilities: formatActions(row.actions),
    description: cleanDescription(row.description),
    aon_url: row.aon_url,
  };
}

function formatMonsterResult(r: MonsterResult, idx: number): string {
  const mod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return [
    `--- Creature Result ${idx}: ${r.name} (Level ${r.level}) ---`,
    `Source: ${r.source} | Rarity: ${r.rarity} | Size: ${r.size}`,
    `Traits: ${r.traits.join(', ')}`,
    `URL: ${r.aon_url}`,
    '',
    `HP ${r.hp} | AC ${r.ac} | Fort ${mod(r.fort)} | Ref ${mod(r.ref)} | Will ${mod(r.will)} | Perception ${mod(r.perception)}`,
    `Str ${mod(r.str)} Dex ${mod(r.dex)} Con ${mod(r.con)} Int ${mod(r.int)} Wis ${mod(r.wis)} Cha ${mod(r.cha)}`,
    `Speed: ${r.speed}`,
    r.immunities ? `Immunities: ${r.immunities}` : null,
    r.weaknesses ? `Weaknesses: ${r.weaknesses}` : null,
    r.resistances ? `Resistances: ${r.resistances}` : null,
    r.melee ? `Melee: ${r.melee}` : null,
    r.ranged ? `Ranged: ${r.ranged}` : null,
    r.abilities ? `\nAbilities:\n${r.abilities}` : null,
    r.description ? `\n${r.description}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function searchMonsters(query: string): string {
  const d = requireDb();
  const rows = d
    .prepare(
      `SELECT * FROM monsters WHERE name LIKE ? ORDER BY
        CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END,
        level ASC LIMIT 3`,
    )
    .all(`%${query}%`, query, `${query}%`) as MonsterRow[];

  if (rows.length === 0) return `[No creatures found for "${query}"]`;
  return rows.map((r, i) => formatMonsterResult(rowToResult(r), i + 1)).join('\n\n');
}

// --- Monster browser queries -----------------------------------------------

import type { MonsterSearchParams, MonsterSummary, MonsterDetail, MonsterFacets } from '../shared/types.js';

function toMonsterFileUrl(relPath: string | null): string | null {
  if (!relPath) return null;
  return `monster-file://img/${encodeURIComponent(relPath)}`;
}

let facetsCache: MonsterFacets | null = null;

export function listMonsters(params: MonsterSearchParams): MonsterSummary[] {
  const d = requireDb();
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (params.keywords) {
    clauses.push('name LIKE ?');
    binds.push(`%${params.keywords}%`);
  }
  if (params.levels) {
    clauses.push('level BETWEEN ? AND ?');
    binds.push(params.levels[0], params.levels[1]);
  }
  if (params.rarities?.length) {
    clauses.push(`rarity IN (${params.rarities.map(() => '?').join(',')})`);
    binds.push(...params.rarities);
  }
  if (params.sizes?.length) {
    clauses.push(`size IN (${params.sizes.map(() => '?').join(',')})`);
    binds.push(...params.sizes);
  }
  if (params.creatureTypes?.length) {
    clauses.push(`creature_type IN (${params.creatureTypes.map(() => '?').join(',')})`);
    binds.push(...params.creatureTypes);
  }
  if (params.traits?.length) {
    for (const t of params.traits) {
      clauses.push('traits LIKE ?');
      binds.push(`%"${t}"%`);
    }
  }
  if (params.sources?.length) {
    clauses.push(`source IN (${params.sources.map(() => '?').join(',')})`);
    binds.push(...params.sources);
  }
  if (params.hpMin != null) {
    clauses.push('hp >= ?');
    binds.push(params.hpMin);
  }
  if (params.hpMax != null) {
    clauses.push('hp <= ?');
    binds.push(params.hpMax);
  }
  if (params.acMin != null) {
    clauses.push('ac >= ?');
    binds.push(params.acMin);
  }
  if (params.acMax != null) {
    clauses.push('ac <= ?');
    binds.push(params.acMax);
  }
  if (params.fortMin != null) {
    clauses.push('fort >= ?');
    binds.push(params.fortMin);
  }
  if (params.refMin != null) {
    clauses.push('ref >= ?');
    binds.push(params.refMin);
  }
  if (params.willMin != null) {
    clauses.push('will >= ?');
    binds.push(params.willMin);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sortCol = params.sortBy ?? 'level';
  const sortDir = params.sortDir ?? 'asc';
  const orderBy = `ORDER BY ${sortCol} ${sortDir}, name ASC`;
  const limit = params.limit ?? 5000;

  const sql = `SELECT name, level, hp, ac, fort, ref, will, rarity, size, creature_type, traits, source, aon_url
    FROM monsters ${where} ${orderBy} LIMIT ?`;
  const rows = d.prepare(sql).all(...binds, limit) as Array<
    Pick<
      MonsterRow,
      | 'name'
      | 'level'
      | 'hp'
      | 'ac'
      | 'fort'
      | 'ref'
      | 'will'
      | 'rarity'
      | 'size'
      | 'creature_type'
      | 'traits'
      | 'source'
      | 'aon_url'
    >
  >;

  return rows.map((r) => ({
    name: r.name,
    level: r.level,
    hp: r.hp,
    ac: r.ac,
    fort: r.fort,
    ref: r.ref,
    will: r.will,
    rarity: r.rarity,
    size: r.size,
    creatureType: r.creature_type,
    traits: tryParseJson<string[]>(r.traits, []),
    source: r.source,
    aonUrl: r.aon_url,
  }));
}

export function getMonsterFacets(): MonsterFacets {
  if (facetsCache) return facetsCache;
  const d = requireDb();

  const rarities = (
    d.prepare('SELECT DISTINCT rarity FROM monsters ORDER BY rarity').all() as Array<{ rarity: string }>
  ).map((r) => r.rarity);
  const sizes = (d.prepare('SELECT DISTINCT size FROM monsters ORDER BY size').all() as Array<{ size: string }>).map(
    (r) => r.size,
  );
  const creatureTypes = (
    d.prepare('SELECT DISTINCT creature_type FROM monsters ORDER BY creature_type').all() as Array<{
      creature_type: string;
    }>
  ).map((r) => r.creature_type);
  const sources = (
    d.prepare('SELECT DISTINCT source FROM monsters ORDER BY source').all() as Array<{ source: string }>
  ).map((r) => r.source);
  const levelRow = d.prepare('SELECT MIN(level) as min, MAX(level) as max FROM monsters').get() as {
    min: number;
    max: number;
  };

  // Traits are stored as JSON arrays — collect all unique values.
  const traitRows = d.prepare('SELECT DISTINCT traits FROM monsters').all() as Array<{ traits: string }>;
  const traitSet = new Set<string>();
  for (const row of traitRows) {
    for (const t of tryParseJson<string[]>(row.traits, [])) {
      traitSet.add(t);
    }
  }
  const traits = [...traitSet].sort();

  facetsCache = {
    rarities,
    sizes,
    creatureTypes,
    traits,
    sources,
    levelRange: [levelRow.min, levelRow.max],
  };
  return facetsCache;
}

export function getMonsterByName(name: string): MonsterDetail | null {
  const d = requireDb();
  const row = d.prepare('SELECT * FROM monsters WHERE name = ? LIMIT 1').get(name) as MonsterRow | undefined;
  if (!row) return null;
  const r = rowToResult(row);
  return {
    name: r.name,
    level: r.level,
    source: r.source,
    rarity: r.rarity,
    size: r.size,
    traits: r.traits,
    hp: r.hp,
    ac: r.ac,
    fort: r.fort,
    ref: r.ref,
    will: r.will,
    perception: r.perception,
    skills: row.skills,
    str: r.str,
    dex: r.dex,
    con: r.con,
    int: r.int,
    wis: r.wis,
    cha: r.cha,
    speed: r.speed,
    immunities: r.immunities,
    weaknesses: r.weaknesses,
    resistances: r.resistances,
    melee: r.melee,
    ranged: r.ranged,
    abilities: r.abilities,
    description: r.description,
    aonUrl: r.aon_url,
    imageUrl: toMonsterFileUrl(row.image_file),
    tokenUrl: toMonsterFileUrl(row.token_file),
  };
}

// --- Item queries -----------------------------------------------------------

export interface ItemRow {
  name: string;
  level: number;
  traits: string;
  price: string;
  bulk: string;
  usage: string;
  description: string;
  source: string;
  aon_url: string;
}

export function searchItems(query: string): string {
  const d = requireDb();
  const rows = d
    .prepare(
      `SELECT * FROM items WHERE name LIKE ? ORDER BY
        CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END,
        level ASC LIMIT 3`,
    )
    .all(`%${query}%`, query, `${query}%`) as ItemRow[];

  if (rows.length === 0) return `[No items found for "${query}"]`;

  return rows
    .map((r, i) => {
      const desc = cleanDescription(r.description);
      const truncated = desc.length > 1000 ? desc.slice(0, 1000) + '…' : desc;
      return [
        `--- Item Result ${i + 1}: ${r.name} (Level ${r.level}) ---`,
        `Source: ${r.source}`,
        `Price: ${r.price || '—'} | Bulk: ${r.bulk || '—'} | Usage: ${r.usage || '—'}`,
        `Traits: ${r.traits || '—'}`,
        `URL: ${r.aon_url}`,
        '',
        truncated,
      ].join('\n');
    })
    .join('\n\n');
}

// --- Item browser queries (used by the Items tab UI) -----------------------

import type { ItemBrowserRow, ItemBrowserDetail, ItemFacets, ItemSearchParams, ItemVariant } from '../shared/types.js';

const RARITY_TRAITS = new Set(['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE']);

/** Map a raw usage string to a coarse bucket for the filter panel. */
function usageBucket(usage: string | null): string {
  if (!usage) return 'Other';
  const u = usage.toLowerCase();
  if (u.startsWith('held')) return 'Held';
  if (u.startsWith('worn')) return 'Worn';
  if (u.startsWith('etched')) return 'Etched';
  if (u.startsWith('affixed')) return 'Affixed';
  if (u.startsWith('tattooed')) return 'Tattooed';
  if (u === 'carried') return 'Carried';
  return 'Other';
}

/** Extract rarity from a comma-separated traits string. */
function extractRarity(traits: string | null): string {
  if (!traits) return 'COMMON';
  for (const t of traits.split(',')) {
    const trimmed = t.trim().toUpperCase();
    if (RARITY_TRAITS.has(trimmed) && trimmed !== 'COMMON') return trimmed;
  }
  return 'COMMON';
}

/** Parse traits string into an array, excluding rarity traits. */
function parseTraits(traits: string | null): string[] {
  if (!traits) return [];
  return traits
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !RARITY_TRAITS.has(t.toUpperCase()));
}

/** Parse the price string to a numeric gp value for sorting. Items with
 *  no price sort to the end. Handles "1,600 gp", "5 sp", "1 cp", etc. */
function priceToCopper(price: string | null): number {
  if (!price) return Number.MAX_SAFE_INTEGER;
  // Normalize line breaks and whitespace
  const p = price.replace(/\n/g, ' ').trim().toLowerCase();
  let total = 0;
  const gpMatch = p.match(/([\d,]+)\s*gp/);
  const spMatch = p.match(/([\d,]+)\s*sp/);
  const cpMatch = p.match(/([\d,]+)\s*cp/);
  if (gpMatch) total += Number(gpMatch[1].replace(/,/g, '')) * 100;
  if (spMatch) total += Number(spMatch[1].replace(/,/g, '')) * 10;
  if (cpMatch) total += Number(cpMatch[1].replace(/,/g, ''));
  return total || Number.MAX_SAFE_INTEGER;
}

interface RawItemRow {
  id: string;
  name: string;
  level: number | null;
  traits: string | null;
  is_magical: number;
  price: string | null;
  bulk: string | null;
  usage: string | null;
  has_variants: number;
  has_activation: number;
  variants: string | null;
  description: string | null;
  source: string | null;
  aon_url: string | null;
  publication_remaster: number | null;
}

function rowToBrowserRow(r: RawItemRow): ItemBrowserRow {
  return {
    id: r.id,
    name: r.name,
    level: r.level,
    traits: parseTraits(r.traits),
    rarity: extractRarity(r.traits),
    price: r.price?.replace(/\n/g, ' ').trim() ?? null,
    bulk: r.bulk,
    usage: r.usage,
    isMagical: r.is_magical === 1,
    hasVariants: r.has_variants === 1,
    isRemastered: r.publication_remaster === 1 ? true : r.publication_remaster === 0 ? false : null,
  };
}

export function searchItemsBrowser(params: ItemSearchParams): ItemBrowserRow[] {
  const d = requireDb();

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  // Keyword search
  if (params.keywords?.trim()) {
    conditions.push('name LIKE ?');
    bindings.push(`%${params.keywords.trim()}%`);
  }

  // Level range
  if (params.levelMin != null) {
    conditions.push('level >= ?');
    bindings.push(params.levelMin);
  }
  if (params.levelMax != null) {
    conditions.push('level <= ?');
    bindings.push(params.levelMax);
  }

  // Rarity filter — match against the traits column
  if (params.rarities?.length) {
    const rarityClauses = params.rarities.map((r) => {
      if (r.toUpperCase() === 'COMMON') {
        // Common = no rarity trait present
        return "(traits IS NULL OR (traits NOT LIKE '%UNCOMMON%' AND traits NOT LIKE '%RARE%' AND traits NOT LIKE '%UNIQUE%'))";
      }
      bindings.push(`%${r.toUpperCase()}%`);
      return 'traits LIKE ?';
    });
    conditions.push(`(${rarityClauses.join(' OR ')})`);
  }

  // Magical filter
  if (params.isMagical === true) {
    conditions.push('is_magical = 1');
  } else if (params.isMagical === false) {
    conditions.push('is_magical = 0');
  }

  // Trait filter (AND — all selected traits must be present)
  if (params.traits?.length) {
    for (const trait of params.traits) {
      conditions.push('traits LIKE ?');
      bindings.push(`%${trait}%`);
    }
  }

  // Source filter
  if (params.sources?.length) {
    const placeholders = params.sources.map(() => '?').join(', ');
    conditions.push(`source IN (${placeholders})`);
    bindings.push(...params.sources);
  }

  // Usage category filter — usage LIKE prefix
  if (params.usageCategories?.length) {
    const usageClauses: string[] = [];
    for (const cat of params.usageCategories) {
      const prefix = cat.toLowerCase();
      if (prefix === 'other') {
        usageClauses.push(
          "(usage IS NULL OR (usage NOT LIKE 'held%' AND usage NOT LIKE 'worn%' AND usage NOT LIKE 'etched%' AND usage NOT LIKE 'affixed%' AND usage NOT LIKE 'tattooed%' AND usage != 'carried'))",
        );
      } else if (prefix === 'carried') {
        usageClauses.push("usage = 'carried'");
      } else {
        bindings.push(`${prefix}%`);
        usageClauses.push('usage LIKE ?');
      }
    }
    conditions.push(`(${usageClauses.join(' OR ')})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sort
  const sortField = params.sortBy ?? 'name';
  const sortDir = params.sortDir ?? 'asc';
  const dirSql = sortDir === 'desc' ? 'DESC' : 'ASC';
  let orderBy: string;
  if (sortField === 'price') {
    // Price sorting is tricky because the column is text. We'll sort
    // in JS after fetching, so just fetch by name here.
    orderBy = 'ORDER BY name ASC';
  } else if (sortField === 'level') {
    orderBy = `ORDER BY level ${dirSql}, name ASC`;
  } else {
    orderBy = `ORDER BY name ${dirSql}`;
  }

  const limit = params.limit ?? 500;
  const sql = `SELECT id, name, level, traits, is_magical, price, bulk, usage, has_variants, publication_remaster FROM items ${where} ${orderBy} LIMIT ?`;
  bindings.push(limit);

  const rows = d.prepare(sql).all(...bindings) as RawItemRow[];
  const results = rows.map(rowToBrowserRow);

  // Price sort in JS (since the column is text with mixed formats)
  if (sortField === 'price') {
    results.sort((a, b) => {
      const diff = priceToCopper(a.price) - priceToCopper(b.price);
      return sortDir === 'desc' ? -diff : diff;
    });
  }

  return results;
}

export function getItemBrowserDetail(id: string): ItemBrowserDetail | null {
  const d = requireDb();
  const row = d.prepare('SELECT * FROM items WHERE id = ?').get(id) as RawItemRow | undefined;
  if (!row) return null;

  const base = rowToBrowserRow(row);
  const variants = tryParseJson<Array<{ type: string; level?: number; price?: string }>>(row.variants, []);

  return {
    ...base,
    description: cleanDescription(row.description),
    source: row.source,
    aonUrl: row.aon_url,
    variants: variants.map(
      (v): ItemVariant => ({
        type: v.type,
        level: v.level ?? null,
        price: v.price?.replace(/\n/g, ' ').trim() ?? null,
      }),
    ),
    hasActivation: row.has_activation === 1,
  };
}

export function getItemFacets(): ItemFacets {
  const d = requireDb();

  // Traits — split each row's comma-separated traits, count, return top 50
  const traitRows = d.prepare('SELECT traits FROM items WHERE traits IS NOT NULL').all() as { traits: string }[];
  const traitCounts: Record<string, number> = {};
  for (const r of traitRows) {
    for (const t of r.traits.split(',')) {
      const trimmed = t.trim().toUpperCase();
      if (trimmed && !RARITY_TRAITS.has(trimmed)) {
        traitCounts[trimmed] = (traitCounts[trimmed] || 0) + 1;
      }
    }
  }
  const traits = Object.entries(traitCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([t]) => t);

  // Sources
  const sourceRows = d.prepare('SELECT DISTINCT source FROM items WHERE source IS NOT NULL ORDER BY source').all() as {
    source: string;
  }[];
  const sources = sourceRows.map((r) => r.source);

  // Usage categories (bucketed)
  const usageRows = d.prepare('SELECT DISTINCT usage FROM items').all() as { usage: string | null }[];
  const usageCats = new Set<string>();
  for (const r of usageRows) {
    usageCats.add(usageBucket(r.usage));
  }
  const usageCategories = [...usageCats].sort();

  return { traits, sources, usageCategories };
}

// --- Monster preview for hover card -----------------------------------------

export function getMonsterPreview(aonUrl: string): MonsterResult | null {
  const d = requireDb();
  const row = d.prepare('SELECT * FROM monsters WHERE aon_url = ? LIMIT 1').get(aonUrl) as MonsterRow | undefined;
  if (!row) return null;
  return rowToResult(row);
}
