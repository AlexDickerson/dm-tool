// Minimal YAML frontmatter parser for globe pin mission notes.
//
// We don't need full YAML semantics — only the specific shape that our
// mission notes use. Keeping this in-house avoids adding a heavyweight
// YAML dependency for a handful of fields.
//
// Supported syntax:
//   key: value                       -> string/number/boolean
//   key: |                           -> multi-line string (block scalar)
//     first line
//     second line
//   key:                             -> list (next lines start with "- ")
//     - item one
//     - item two
//   objectives:                      -> list of objects with "text:" + "primary:"
//     - text: "Do the thing"
//       primary: true
//   threats:                         -> list of "Name | level | type" strings
//     - Nabasu | 8 | Demon

import type {
  MissionData,
  MissionObjective,
  MissionReward,
  MissionStatus,
  MissionThreat,
  MissionThreatLevel,
} from '../shared/types.js';

type Scalar = string | number | boolean;
type YamlValue = Scalar | Scalar[] | Record<string, Scalar>[];
type YamlObject = Record<string, YamlValue>;

/** Split a markdown file into (frontmatter-text, body-text).
 *  Returns [null, fullText] if no frontmatter is present. */
export function splitFrontmatter(raw: string): [string | null, string] {
  const trimmed = raw.replace(/^\uFEFF/, ''); // strip BOM
  if (!trimmed.startsWith('---')) return [null, raw];
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) return [null, raw];
  const fm = trimmed.slice(4, end).trimEnd();
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  return [fm, body];
}

/** Parse our limited YAML dialect into a flat object. */
export function parseYaml(text: string): YamlObject {
  const lines = text.split(/\r?\n/);
  const out: YamlObject = {};
  let i = 0;

  const indentOf = (line: string): number => {
    let n = 0;
    while (n < line.length && line[n] === ' ') n++;
    return n;
  };

  const parseScalar = (raw: string): Scalar => {
    const s = raw.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    // Strip matching quotes
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1];
    const inline = match[2];

    // Block scalar: key: |
    if (inline === '|') {
      const baseIndent = i + 1 < lines.length ? indentOf(lines[i + 1]) : 0;
      const parts: string[] = [];
      i++;
      while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) >= baseIndent)) {
        parts.push(lines[i].slice(baseIndent));
        i++;
      }
      out[key] = parts.join('\n').trimEnd();
      continue;
    }

    // Inline value
    if (inline !== '') {
      out[key] = parseScalar(inline);
      i++;
      continue;
    }

    // Block list: next lines begin with "- "
    const listItems: Scalar[] = [];
    const objItems: Record<string, Scalar>[] = [];
    i++;
    while (i < lines.length) {
      const cur = lines[i];
      if (!cur.trim()) {
        i++;
        continue;
      }
      const listMatch = /^(\s*)-\s+(.*)$/.exec(cur);
      if (!listMatch) break;
      const itemIndent = listMatch[1].length;
      const first = listMatch[2];

      // Does this item have a key: value (start of an object)?
      const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(first);
      if (kv) {
        const obj: Record<string, Scalar> = {};
        obj[kv[1]] = parseScalar(kv[2]);
        i++;
        // Read continuation lines belonging to this object
        while (i < lines.length) {
          const next = lines[i];
          if (!next.trim()) {
            i++;
            continue;
          }
          const nextIndent = indentOf(next);
          if (nextIndent <= itemIndent) break;
          const nextKv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(next.trim());
          if (!nextKv) break;
          obj[nextKv[1]] = parseScalar(nextKv[2]);
          i++;
        }
        objItems.push(obj);
      } else {
        listItems.push(parseScalar(first));
        i++;
      }
    }
    out[key] = objItems.length > 0 ? objItems : listItems;
  }

  return out;
}

// --- Coercion helpers -------------------------------------------------------

function asStr(v: YamlValue | undefined, fallback = ''): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'string') return v;
  return String(v);
}

function asNum(v: YamlValue | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return undefined;
}

function asStrArr(v: YamlValue | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x)));
  return [];
}

const THREAT_LEVELS: MissionThreatLevel[] = ['Trivial', 'Low', 'Moderate', 'Severe', 'Extreme'];
const STATUSES: MissionStatus[] = ['Available', 'Assigned', 'Active', 'Completed', 'Failed'];

function coerceThreatLevel(v: YamlValue | undefined): MissionThreatLevel {
  const s = asStr(v).toLowerCase();
  const match = THREAT_LEVELS.find((t) => t.toLowerCase() === s);
  return match ?? 'Moderate';
}

function coerceStatus(v: YamlValue | undefined): MissionStatus {
  const s = asStr(v).toLowerCase();
  const match = STATUSES.find((t) => t.toLowerCase() === s);
  return match ?? 'Available';
}

/** Parse objectives from frontmatter.
 *  Supports:
 *    1. List of objects: [{ text, primary }] or [{ text, required }]
 *       `primary` and `required` are aliases — both mean "must-do".
 *    2. List of strings with "* " prefix for primary:
 *       ["* Reach the outpost", "Rescue survivors"]
 */
function coerceObjectives(v: YamlValue | undefined): MissionObjective[] {
  if (!Array.isArray(v)) return [];
  return v.map((item, idx): MissionObjective => {
    if (typeof item === 'string') {
      const isPrimary = item.startsWith('* ');
      const text = isPrimary ? item.slice(2).trim() : item.trim();
      return { id: String(idx + 1), text, isPrimary, completed: false };
    }
    // Object form
    const obj = item as Record<string, Scalar>;
    const isPrimary =
      obj.primary === true ||
      obj.primary === 'true' ||
      obj.required === true ||
      obj.required === 'true';
    return {
      id: String(idx + 1),
      text: asStr(obj.text),
      isPrimary,
      completed: obj.completed === true || obj.completed === 'true',
    };
  });
}

/** Parse threats.
 *  Supports:
 *    1. Pipe-separated string: "Nabasu | 8 | Demon"
 *    2. Objects: { name: "Nabasu", level: 8, type: "Demon" }
 *
 *  Level can be numeric or a string placeholder like "—" (common for
 *  environmental hazards that don't map to a creature CR). The parsed
 *  value is stored verbatim and the UI just displays it. */
function coerceThreats(v: YamlValue | undefined): MissionThreat[] {
  if (!Array.isArray(v)) return [];
  return v.map((item, idx): MissionThreat => {
    if (typeof item === 'string') {
      const parts = item.split('|').map((p) => p.trim());
      const numLevel = asNum(parts[1]);
      return {
        id: String(idx + 1),
        name: parts[0] ?? '',
        level: numLevel ?? (parts[1] || 1),
        type: parts[2] || undefined,
      };
    }
    const obj = item as Record<string, Scalar>;
    const numLevel = asNum(obj.level);
    return {
      id: String(idx + 1),
      name: asStr(obj.name),
      level: numLevel !== undefined ? numLevel : obj.level !== undefined ? asStr(obj.level) : 1,
      type: obj.type ? asStr(obj.type) : undefined,
    };
  });
}

/** Split markdown body into briefing paragraphs. Skips heading lines
 *  (lines starting with "#") since those duplicate the mission name. */
function parseBriefing(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith('#'));
}

/** Parse an Obsidian mission note (frontmatter + body) into MissionData. */
export function parseMissionNote(raw: string, fallbackName: string): MissionData {
  const [fm, body] = splitFrontmatter(raw);
  const meta = fm ? parseYaml(fm) : {};

  const rewards: MissionReward = {};
  const gold = asNum(meta.gold);
  const xp = asNum(meta.xp);
  const items = asStrArr(meta.items);
  if (gold !== undefined) rewards.gold = gold;
  if (xp !== undefined) rewards.xp = xp;
  if (items.length > 0) rewards.items = items;

  // Optional "about the mission" fields from the richer note format.
  // Absent → undefined so the briefing UI can hide them conditionally.
  const arm = meta.arm ? asStr(meta.arm) : undefined;
  const assignedTo = meta['assigned-to'] ? asStr(meta['assigned-to']) : undefined;
  const artifact = meta.artifact ? asStr(meta.artifact) : undefined;

  return {
    name: asStr(meta.name, fallbackName),
    threatLevel: coerceThreatLevel(meta['threat-level']),
    status: coerceStatus(meta.status),
    recommendedLevel: asStr(meta['recommended-level']),
    estimatedSessions: asStr(meta['estimated-sessions']),
    location: asStr(meta.location),
    questGiver: {
      name: asStr(meta['quest-giver']),
      title: asStr(meta['quest-giver-title']),
    },
    briefing: parseBriefing(body),
    objectives: coerceObjectives(meta.objectives),
    threats: coerceThreats(meta.threats),
    rewards,
    dmNotes: asStr(meta['dm-notes']),
    datePosted: asStr(meta['date-posted']),
    sourceBook: meta['source-book'] ? asStr(meta['source-book']) : undefined,
    arm,
    assignedTo,
    artifact,
  };
}

/** Generate a fresh mission note template with all fields pre-filled as examples. */
export function missionNoteTemplate(pinId: string, label: string, lat: number, lng: number): string {
  const name = label || 'New Mission';
  return [
    '---',
    `pin-id: ${pinId}`,
    'kind: mission',
    `name: ${JSON.stringify(name)}`,
    'status: Available',
    'assigned-to: ""',
    'arm: ""',
    'threat-level: Moderate',
    'recommended-level: "5"',
    'estimated-sessions: "1-2"',
    `location: ${JSON.stringify(`${lat.toFixed(3)}, ${lng.toFixed(3)}`)}`,
    'quest-giver: ""',
    'quest-giver-title: ""',
    'date-posted: ""',
    'source-book: ""',
    'artifact: ""',
    'gold: 0',
    'xp: 0',
    'items: []',
    'objectives:',
    '  - text: Primary objective goes here.',
    '    required: true',
    '  - text: Optional secondary objective.',
    '    required: false',
    'threats:',
    '  - name: Threat Name',
    '    level: 5',
    '    type: creature',
    'dm-notes: |',
    '  GM-only notes here.',
    '---',
    '',
    `# ${name}`,
    '',
    'Write the briefing text here. Paragraphs are separated by blank lines.',
    '',
    'Add as many paragraphs as you need — each becomes a section of the in-game parchment briefing.',
    '',
  ].join('\n');
}
