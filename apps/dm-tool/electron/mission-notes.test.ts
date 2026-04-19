import * as fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fsMockState = vi.hoisted(() => ({
  unreadablePath: null as string | null,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(((path, ...args) => {
      if (path === fsMockState.unreadablePath) {
        throw new Error('EACCES: permission denied');
      }
      return actual.readFileSync(
        path,
        ...(args as Parameters<typeof actual.readFileSync> extends [any, ...infer Rest] ? Rest : never),
      );
    }) as typeof actual.readFileSync),
  };
});

import { findNoteByPinId, safeFileName, stampPinId } from './mission-notes';
import { parseYaml, splitFrontmatter } from './mission-parser';

afterEach(() => {
  fsMockState.unreadablePath = null;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// safeFileName — strip illegal chars and collapse whitespace
// ---------------------------------------------------------------------------

describe('safeFileName', () => {
  it('leaves a clean name unchanged', () => {
    expect(safeFileName('Alchemists Lab')).toBe('Alchemists Lab');
  });

  it('strips characters illegal on Windows and macOS', () => {
    // <>:"/\|?* plus control chars
    expect(safeFileName('a<b>c:"d/e\\f|g?h*i')).toBe('abcdefghi');
  });

  it('strips ASCII control characters', () => {
    expect(safeFileName('bad\u0000name\u001f')).toBe('badname');
  });

  it('collapses runs of spaces into a single space', () => {
    expect(safeFileName('  many   spaces   between ')).toBe('many spaces between');
  });

  it('strips tabs as control characters (rather than treating them as whitespace)', () => {
    // Tabs are \x09 — inside the \x00-\x1f control-char range, so they're
    // stripped entirely rather than collapsed into a space. Documents
    // the current behavior; embedded tabs in labels would join adjacent
    // words. Unlikely in practice but worth pinning.
    expect(safeFileName('spaces\tbetween')).toBe('spacesbetween');
  });

  it('returns "Untitled" when the input is empty after sanitisation', () => {
    expect(safeFileName('')).toBe('Untitled');
    expect(safeFileName('<<<>>>')).toBe('Untitled');
    expect(safeFileName('   ')).toBe('Untitled');
  });
});

// ---------------------------------------------------------------------------
// stampPinId — round-trip the YAML frontmatter with a pin-id guarantee
// ---------------------------------------------------------------------------

describe('stampPinId', () => {
  it('prepends a fresh frontmatter block when the file has none', () => {
    const out = stampPinId('# Just a body\n\nHello', 'pin-1', 'note');
    const [fm, body] = splitFrontmatter(out);
    expect(fm).toBeTruthy();
    const meta = parseYaml(fm!);
    expect(meta['pin-id']).toBe('pin-1');
    expect(meta.kind).toBe('note');
    // The original body is preserved (exact whitespace may be adjusted).
    expect(body).toContain('# Just a body');
    expect(body).toContain('Hello');
  });

  it('uses the given kind when synthesizing frontmatter (mission vs note)', () => {
    const asMission = stampPinId('body', 'pin-1', 'mission');
    const asNote = stampPinId('body', 'pin-1', 'note');
    expect(parseYaml(splitFrontmatter(asMission)[0]!).kind).toBe('mission');
    expect(parseYaml(splitFrontmatter(asNote)[0]!).kind).toBe('note');
  });

  it('adds pin-id to existing frontmatter that lacks it (prepended as first line)', () => {
    const raw = ['---', 'name: Hello', 'status: Active', '---', '', '# Body'].join('\n');
    const out = stampPinId(raw, 'pin-1', 'note');
    const [fm] = splitFrontmatter(out);
    expect(fm).toBeTruthy();
    // New line must come first so the 512-byte find-by-pin-id scan always
    // catches it, even when the existing frontmatter is long.
    expect(fm!.split('\n')[0]).toBe('pin-id: pin-1');
    const meta = parseYaml(fm!);
    expect(meta['pin-id']).toBe('pin-1');
    expect(meta.name).toBe('Hello');
    expect(meta.status).toBe('Active');
  });

  it('replaces an existing pin-id value in place', () => {
    const raw = ['---', 'pin-id: old-pin', 'name: Hello', '---', 'body'].join('\n');
    const out = stampPinId(raw, 'new-pin', 'mission');
    const [fm] = splitFrontmatter(out);
    const meta = parseYaml(fm!);
    expect(meta['pin-id']).toBe('new-pin');
    expect(meta.name).toBe('Hello');
  });

  it('tolerates loose spacing around the pin-id key (e.g. "pin-id  :")', () => {
    const raw = ['---', 'pin-id  :   old', 'name: Hello', '---'].join('\n');
    const out = stampPinId(raw, 'new', 'note');
    const meta = parseYaml(splitFrontmatter(out)[0]!);
    expect(meta['pin-id']).toBe('new');
  });

  it('preserves non-pin-id lines verbatim when replacing', () => {
    const raw = ['---', 'name: Keep Me', 'pin-id: old', 'status: Active', '---', 'body content'].join('\n');
    const out = stampPinId(raw, 'new', 'note');
    const meta = parseYaml(splitFrontmatter(out)[0]!);
    expect(meta.name).toBe('Keep Me');
    expect(meta.status).toBe('Active');
    expect(meta['pin-id']).toBe('new');
  });

  it('preserves the body exactly when frontmatter already exists', () => {
    const raw = ['---', 'name: Hello', '---', '', '# Body', '', 'paragraph'].join('\n');
    const out = stampPinId(raw, 'pin-1', 'note');
    const [, body] = splitFrontmatter(out);
    expect(body).toContain('# Body');
    expect(body).toContain('paragraph');
  });

  it('ensures the body starts with a newline (single blank line between --- and body)', () => {
    // If the existing body does not start with a newline, stampPinId
    // guarantees one gets inserted so downstream parsing sees the blank.
    const raw = '---\nname: Hello\n---\n# Body';
    const out = stampPinId(raw, 'pin-1', 'note');
    // After the closing `---` there should be a newline before `# Body`.
    expect(out).toMatch(/---\n\n# Body/);
  });
});

describe('findNoteByPinId', () => {
  it('returns null when the root directory does not exist', () => {
    const missingRoot = join(tmpdir(), `missing-root-${Date.now()}`);
    expect(findNoteByPinId(missingRoot, 'pin-1')).toBeNull();
  });

  it('finds a matching markdown file in nested directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'mission-notes-'));
    try {
      const nestedDir = join(root, 'missions', 'chapter-1');
      mkdirSync(nestedDir, { recursive: true });
      const notePath = join(nestedDir, 'ambush.md');
      writeFileSync(notePath, '---\npin-id: pin-42\n---\n\n# Encounter', 'utf8');
      expect(findNoteByPinId(root, 'pin-42')).toBe(notePath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips hidden directories when scanning', () => {
    const root = mkdtempSync(join(tmpdir(), 'mission-notes-'));
    try {
      const hiddenDir = join(root, '.obsidian');
      mkdirSync(hiddenDir, { recursive: true });
      writeFileSync(join(hiddenDir, 'hidden.md'), '---\npin-id: pin-hidden\n---\n', 'utf8');
      expect(findNoteByPinId(root, 'pin-hidden')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores unreadable markdown entries and continues scanning', () => {
    const root = mkdtempSync(join(tmpdir(), 'mission-notes-'));
    try {
      const badPath = join(root, 'bad.md');
      writeFileSync(badPath, '---\npin-id: pin-good\n---\n', 'utf8');
      fsMockState.unreadablePath = badPath;

      const goodPath = join(root, 'good.md');
      writeFileSync(goodPath, '---\npin-id: pin-good\n---\n', 'utf8');

      expect(findNoteByPinId(root, 'pin-good')).toBe(goodPath);
      expect(vi.mocked(fs.readFileSync)).toHaveBeenCalledWith(badPath, {
        encoding: 'utf-8',
        flag: 'r',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null when pin-id is not within the first 512 bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'mission-notes-'));
    try {
      const longPrefix = 'x'.repeat(520);
      writeFileSync(join(root, 'late-pin.md'), `${longPrefix}\npin-id: pin-late\n`, 'utf8');
      expect(findNoteByPinId(root, 'pin-late')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
