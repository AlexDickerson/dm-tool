// Read-only wrapper around the PF2e SQLite database.
// Used by chat tools for monster, item, and NPC lookups instead of
// hitting the AoN Elasticsearch endpoint.

import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function openPf2eDb(path: string): void {
  if (db) return;
  db = new Database(path, { readonly: true });
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

/** Strip Foundry @UUID/@ references and basic HTML from descriptions. */
function cleanDescription(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/@UUID\[Compendium\.[^\]]+\]\{([^}]+)\}/g, '$1')
    .replace(/@UUID\[Compendium\.[^\]]+\]/g, '')
    .replace(/@Check\[([^|]+)\|dc:(\d+)\]/g, '$1 DC $2')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[\s>]/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tryParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
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
      return `${a.name} +${a.bonus}${traits}, Damage ${dmg}`;
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

// --- Monster preview for hover card -----------------------------------------

export function getMonsterPreview(aonUrl: string): MonsterResult | null {
  const d = requireDb();
  const row = d.prepare('SELECT * FROM monsters WHERE aon_url = ? LIMIT 1').get(aonUrl) as MonsterRow | undefined;
  if (!row) return null;
  return rowToResult(row);
}
