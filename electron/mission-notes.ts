// Filesystem utilities for the Obsidian-backed mission note workflow.
// Pulled out of electron/ipc/globe.ts so the IPC layer stays focused on
// IPC glue and the pure file/path logic is unit-testable in isolation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from './mission-parser.js';

/** Sanitise a string for use as a filename — strip characters illegal on
 *  Windows/macOS and collapse whitespace. */
export function safeFileName(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled'
  );
}

/** Recursively scan .md files under a directory for one whose YAML
 *  frontmatter contains `pin-id: <id>`. Skips hidden directories
 *  (.obsidian, .git, etc). Returns the absolute path if found, or null.
 *
 *  Only reads the first 512 bytes of each file — frontmatter is always at
 *  the very top and staying out of large-file bodies keeps the scan cheap
 *  on vaults with lots of long mission notes. */
export function findNoteByPinId(root: string, pinId: string): string | null {
  if (!existsSync(root)) return null;
  const needle = `pin-id: ${pinId}`;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fp = join(dir, entry);
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(fp);
      } else if (entry.endsWith('.md')) {
        try {
          const head = readFileSync(fp, { encoding: 'utf-8', flag: 'r' }).slice(0, 512);
          if (head.includes(needle)) return fp;
        } catch {
          /* unreadable — skip */
        }
      }
    }
  }
  return null;
}

/** Ensure a note's YAML frontmatter contains `pin-id: <id>`. If the file
 *  has no frontmatter, prepend one. If it already has frontmatter, add or
 *  replace the `pin-id` line. Returns the updated content. */
export function stampPinId(raw: string, pinId: string, kind: 'note' | 'mission'): string {
  const [fm, body] = splitFrontmatter(raw);
  if (fm === null) {
    return `---\npin-id: ${pinId}\nkind: ${kind}\n---\n\n${raw}`;
  }

  const lines = fm.split(/\r?\n/);
  let hasPinId = false;
  const updated = lines.map((line) => {
    if (/^pin-id\s*:/.test(line)) {
      hasPinId = true;
      return `pin-id: ${pinId}`;
    }
    return line;
  });
  if (!hasPinId) updated.unshift(`pin-id: ${pinId}`);

  return `---\n${updated.join('\n')}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}
