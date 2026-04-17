import { describe, expect, it } from 'vitest';
import { missionNoteTemplate, parseMissionNote, parseYaml, splitFrontmatter } from './mission-parser';

// ---------------------------------------------------------------------------
// splitFrontmatter
// ---------------------------------------------------------------------------

describe('splitFrontmatter', () => {
  it('splits a document with frontmatter into [fm, body]', () => {
    // Note: splitFrontmatter strips exactly one newline after the
    // closing `---`. A blank line between frontmatter and body is
    // preserved (as a single leading newline on body) so downstream
    // paragraph-splitting still sees it as a paragraph boundary.
    const raw = ['---', 'name: Hello', 'status: Active', '---', '# Body', '', 'first paragraph'].join('\n');
    const [fm, body] = splitFrontmatter(raw);
    expect(fm).toBe('name: Hello\nstatus: Active');
    expect(body).toBe('# Body\n\nfirst paragraph');
  });

  it('returns [null, raw] when no frontmatter is present', () => {
    const [fm, body] = splitFrontmatter('no frontmatter here');
    expect(fm).toBeNull();
    expect(body).toBe('no frontmatter here');
  });

  it('strips a leading UTF-8 BOM before checking for ---', () => {
    const raw = '\uFEFF---\nname: Hello\n---\nBody';
    const [fm, body] = splitFrontmatter(raw);
    expect(fm).toBe('name: Hello');
    expect(body).toBe('Body');
  });

  it('returns [null, raw] when the opening --- has no matching close', () => {
    const [fm, body] = splitFrontmatter('---\nname: Hello\nno closing fence');
    expect(fm).toBeNull();
    expect(body).toBe('---\nname: Hello\nno closing fence');
  });

  it('handles CRLF line endings in the body', () => {
    const raw = '---\nname: Hello\n---\r\n# Body';
    const [fm, body] = splitFrontmatter(raw);
    expect(fm).toBe('name: Hello');
    expect(body).toBe('# Body');
  });
});

// ---------------------------------------------------------------------------
// parseYaml
// ---------------------------------------------------------------------------

describe('parseYaml', () => {
  it('parses scalar values with type inference', () => {
    const out = parseYaml(['name: Hello', 'count: 42', 'ratio: 1.5', 'active: true', 'archived: false'].join('\n'));
    expect(out).toEqual({
      name: 'Hello',
      count: 42,
      ratio: 1.5,
      active: true,
      archived: false,
    });
  });

  it('strips matching single or double quotes from scalar values', () => {
    const out = parseYaml(['a: "double quoted"', "b: 'single quoted'", 'c: unquoted'].join('\n'));
    expect(out).toEqual({ a: 'double quoted', b: 'single quoted', c: 'unquoted' });
  });

  it('does NOT coerce "true"/"false" inside quotes', () => {
    const out = parseYaml('flag: "true"');
    expect(out).toEqual({ flag: 'true' });
  });

  it('parses a block scalar introduced with |', () => {
    const out = parseYaml(['summary: |', '  first line', '  second line', '', '  after blank'].join('\n'));
    expect(out.summary).toBe('first line\nsecond line\n\nafter blank');
  });

  it('parses a simple list of strings', () => {
    const out = parseYaml(['items:', '  - sword', '  - shield', '  - potion'].join('\n'));
    expect(out.items).toEqual(['sword', 'shield', 'potion']);
  });

  it('parses a list of objects (continuation lines indented under the same item)', () => {
    const out = parseYaml(
      [
        'objectives:',
        '  - text: Reach the gate',
        '    primary: true',
        '  - text: Rescue survivors',
        '    primary: false',
      ].join('\n'),
    );
    expect(out.objectives).toEqual([
      { text: 'Reach the gate', primary: true },
      { text: 'Rescue survivors', primary: false },
    ]);
  });

  it('ignores blank lines and `#` comments', () => {
    const out = parseYaml(['# a comment', '', 'name: Hello', '# another', 'count: 1'].join('\n'));
    expect(out).toEqual({ name: 'Hello', count: 1 });
  });

  it('ignores lines that do not match the key: value shape', () => {
    const out = parseYaml(['name: Hello', 'this is not a key line', 'count: 2'].join('\n'));
    expect(out).toEqual({ name: 'Hello', count: 2 });
  });

  it('allows kebab-case keys', () => {
    const out = parseYaml('threat-level: Severe');
    expect(out).toEqual({ 'threat-level': 'Severe' });
  });

  it('returns an empty list when the block has no items', () => {
    const out = parseYaml(['items:', 'name: Hello'].join('\n'));
    expect(out.items).toEqual([]);
    expect(out.name).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// parseMissionNote
// ---------------------------------------------------------------------------

describe('parseMissionNote', () => {
  it('uses the fallback name when the frontmatter has no `name` field', () => {
    const result = parseMissionNote('', 'Fallback Mission');
    expect(result.name).toBe('Fallback Mission');
  });

  it('defaults threatLevel to Moderate and status to Available when unspecified', () => {
    const result = parseMissionNote('---\nname: X\n---\n', 'fb');
    expect(result.threatLevel).toBe('Moderate');
    expect(result.status).toBe('Available');
  });

  it('coerces threat level case-insensitively', () => {
    const raw = ['---', 'name: X', 'threat-level: severe', '---'].join('\n');
    expect(parseMissionNote(raw, 'fb').threatLevel).toBe('Severe');
  });

  it('falls back to Moderate for an unknown threat level', () => {
    const raw = ['---', 'name: X', 'threat-level: Catastrophic', '---'].join('\n');
    expect(parseMissionNote(raw, 'fb').threatLevel).toBe('Moderate');
  });

  it('falls back to Available for an unknown status', () => {
    const raw = ['---', 'name: X', 'status: Bogus', '---'].join('\n');
    expect(parseMissionNote(raw, 'fb').status).toBe('Available');
  });

  it('splits the body into paragraphs and skips heading lines', () => {
    const raw = [
      '---',
      'name: X',
      '---',
      '',
      '# Heading should be dropped',
      '',
      'First paragraph',
      '',
      'Second paragraph',
    ].join('\n');
    expect(parseMissionNote(raw, 'fb').briefing).toEqual(['First paragraph', 'Second paragraph']);
  });

  it('leaves the briefing empty when the body is only headings', () => {
    const raw = ['---', 'name: X', '---', '', '# Heading only'].join('\n');
    expect(parseMissionNote(raw, 'fb').briefing).toEqual([]);
  });

  // --- objectives --------------------------------------------------------

  it('parses objectives from the object form with `primary`', () => {
    const raw = [
      '---',
      'name: X',
      'objectives:',
      '  - text: Reach the gate',
      '    primary: true',
      '  - text: Rescue survivors',
      '    primary: false',
      '---',
    ].join('\n');
    const objs = parseMissionNote(raw, 'fb').objectives;
    expect(objs).toEqual([
      { id: '1', text: 'Reach the gate', isPrimary: true, completed: false },
      { id: '2', text: 'Rescue survivors', isPrimary: false, completed: false },
    ]);
  });

  it('accepts `required` as an alias for `primary`', () => {
    const raw = ['---', 'name: X', 'objectives:', '  - text: Do the thing', '    required: true', '---'].join('\n');
    expect(parseMissionNote(raw, 'fb').objectives[0].isPrimary).toBe(true);
  });

  it('parses objectives from the string-list form with "* " prefix for primary', () => {
    const raw = ['---', 'name: X', 'objectives:', '  - "* Reach the outpost"', '  - Rescue survivors', '---'].join(
      '\n',
    );
    const objs = parseMissionNote(raw, 'fb').objectives;
    expect(objs).toEqual([
      { id: '1', text: 'Reach the outpost', isPrimary: true, completed: false },
      { id: '2', text: 'Rescue survivors', isPrimary: false, completed: false },
    ]);
  });

  it('returns an empty objectives array when missing or non-list', () => {
    expect(parseMissionNote('---\nname: X\n---', 'fb').objectives).toEqual([]);
  });

  // --- threats -----------------------------------------------------------

  it('parses pipe-separated threat strings', () => {
    const raw = ['---', 'name: X', 'threats:', '  - Nabasu | 8 | Demon', '  - Hazard | 5', '---'].join('\n');
    const threats = parseMissionNote(raw, 'fb').threats;
    expect(threats).toEqual([
      { id: '1', name: 'Nabasu', level: 8, type: 'Demon' },
      { id: '2', name: 'Hazard', level: 5, type: undefined },
    ]);
  });

  it('keeps non-numeric threat levels verbatim (e.g. "—" for hazards)', () => {
    const raw = ['---', 'name: X', 'threats:', '  - Collapsing Floor | — | Hazard', '---'].join('\n');
    const threats = parseMissionNote(raw, 'fb').threats;
    expect(threats[0].level).toBe('—');
  });

  it('parses object-form threats with numeric and string levels', () => {
    const raw = [
      '---',
      'name: X',
      'threats:',
      '  - name: Nabasu',
      '    level: 8',
      '    type: Demon',
      '  - name: Floor',
      '    level: "—"',
      '---',
    ].join('\n');
    const threats = parseMissionNote(raw, 'fb').threats;
    expect(threats[0]).toEqual({ id: '1', name: 'Nabasu', level: 8, type: 'Demon' });
    expect(threats[1]).toEqual({ id: '2', name: 'Floor', level: '—', type: undefined });
  });

  // --- rewards -----------------------------------------------------------

  it('omits reward fields that are not present in frontmatter', () => {
    const raw = ['---', 'name: X', '---'].join('\n');
    expect(parseMissionNote(raw, 'fb').rewards).toEqual({});
  });

  it('includes gold/xp/items when present', () => {
    const raw = ['---', 'name: X', 'gold: 500', 'xp: 1200', 'items:', '  - Amulet', '  - Ring', '---'].join('\n');
    expect(parseMissionNote(raw, 'fb').rewards).toEqual({ gold: 500, xp: 1200, items: ['Amulet', 'Ring'] });
  });

  // --- optional string fields -------------------------------------------

  it('leaves optional rich-format fields undefined when absent', () => {
    const raw = ['---', 'name: X', '---'].join('\n');
    const m = parseMissionNote(raw, 'fb');
    expect(m.arm).toBeUndefined();
    expect(m.assignedTo).toBeUndefined();
    expect(m.artifact).toBeUndefined();
    expect(m.sourceBook).toBeUndefined();
  });

  it('surfaces arm / assigned-to / artifact / source-book when present', () => {
    const raw = [
      '---',
      'name: X',
      'arm: "Pathfinder Society"',
      'assigned-to: "The Party"',
      'artifact: "[[Amulet of Ire]]"',
      'source-book: "Book 3"',
      '---',
    ].join('\n');
    const m = parseMissionNote(raw, 'fb');
    expect(m.arm).toBe('Pathfinder Society');
    expect(m.assignedTo).toBe('The Party');
    expect(m.artifact).toBe('[[Amulet of Ire]]');
    expect(m.sourceBook).toBe('Book 3');
  });
});

// ---------------------------------------------------------------------------
// missionNoteTemplate  (round-trip: generated template must parse cleanly)
// ---------------------------------------------------------------------------

describe('missionNoteTemplate', () => {
  it('includes a pin-id frontmatter line with the given id', () => {
    const tpl = missionNoteTemplate('abc123', 'Test Mission', 10, 20);
    expect(tpl).toMatch(/^---\npin-id: abc123$/m);
  });

  it('falls back to "New Mission" when label is empty', () => {
    const tpl = missionNoteTemplate('id', '', 0, 0);
    expect(tpl).toMatch(/^name: "New Mission"$/m);
    expect(tpl).toMatch(/^# New Mission$/m);
  });

  it('round-trips: the generated template parses into a valid MissionData', () => {
    const tpl = missionNoteTemplate('pin-1', 'Example Mission', 12.3456, -45.6789);
    const mission = parseMissionNote(tpl, 'fallback');

    expect(mission.name).toBe('Example Mission');
    expect(mission.status).toBe('Available');
    expect(mission.threatLevel).toBe('Moderate');
    expect(mission.location).toBe('12.346, -45.679');
    expect(mission.objectives).toHaveLength(2);
    expect(mission.objectives[0].isPrimary).toBe(true);
    expect(mission.objectives[1].isPrimary).toBe(false);
    expect(mission.threats).toHaveLength(1);
    expect(mission.threats[0]).toEqual({ id: '1', name: 'Threat Name', level: 5, type: 'creature' });
    expect(mission.rewards).toEqual({ gold: 0, xp: 0 });
    expect(mission.dmNotes).toBe('GM-only notes here.');
    expect(mission.briefing.length).toBeGreaterThan(0);
  });
});
