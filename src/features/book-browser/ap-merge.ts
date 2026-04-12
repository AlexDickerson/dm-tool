// Groups multi-part Adventure Path books into merged entries for the
// catalog grid. Renderer-side only — no DB schema changes. Supplements
// (Player's Guide, Pawn Collection, etc.) stay as individual cards.

import type { Book } from "@shared/types";

export interface ApPartInfo {
  book: Book;
  partNumber: number;
  totalParts: number;
}

export interface ApGroup {
  /** The AP folder name, e.g. "Abomination Vaults". */
  subcategory: string;
  /** Numbered parts sorted by partNumber (1-based). */
  parts: ApPartInfo[];
  /** Non-part PDFs in the same AP folder (Player's Guide, etc). */
  supplements: Book[];
}

/** Matches "Part 1 of 3", "1 of 3", "Part 2 of 6", etc. in normalized
 *  titles. Covers all observed Paizo naming patterns:
 *    "Abomination Vaults AP - Part 1 of 3 - Ruins of Gauntlight"
 *    "Outlaws of Alkenstar AP - 1 of 3 - Punks in a Powderkeg"
 *    "Quest for the Frozen Flame AP - 1 of 3 Broken Tusk Moon"
 */
const PART_RE = /(?:Part\s+)?(\d+)\s+of\s+(\d+)/i;

export function parseApPart(
  book: Book,
): ApPartInfo | null {
  const m = book.title.match(PART_RE);
  if (!m) return null;
  return {
    book,
    partNumber: parseInt(m[1]!, 10),
    totalParts: parseInt(m[2]!, 10),
  };
}

/** Split the full book list into merged AP groups + everything else. */
export function groupAdventurePaths(books: Book[]): {
  apGroups: ApGroup[];
  otherBooks: Book[];
} {
  const otherBooks: Book[] = [];
  const apMap = new Map<
    string,
    { parts: ApPartInfo[]; supplements: Book[] }
  >();

  for (const b of books) {
    if (b.category !== "Adventure Paths" || !b.subcategory) {
      otherBooks.push(b);
      continue;
    }

    let entry = apMap.get(b.subcategory);
    if (!entry) {
      entry = { parts: [], supplements: [] };
      apMap.set(b.subcategory, entry);
    }

    const part = parseApPart(b);
    if (part) {
      entry.parts.push(part);
    } else {
      entry.supplements.push(b);
    }
  }

  const apGroups: ApGroup[] = [];
  for (const [subcategory, { parts, supplements }] of apMap) {
    parts.sort((a, b) => a.partNumber - b.partNumber);
    apGroups.push({ subcategory, parts, supplements });
  }
  // Sort groups alphabetically by AP name.
  apGroups.sort((a, b) => a.subcategory.localeCompare(b.subcategory));

  return { apGroups, otherBooks };
}

/** Total page count across all parts, or null if any part is un-ingested. */
export function apTotalPages(group: ApGroup): number | null {
  let total = 0;
  for (const p of group.parts) {
    if (p.book.pageCount == null) return null;
    total += p.book.pageCount;
  }
  return total;
}

/** Extract a human-readable part subtitle from the normalized title.
 *  E.g. "Abomination Vaults AP - Part 1 of 3 - Ruins of Gauntlight"
 *  → "Ruins of Gauntlight". */
export function partSubtitle(title: string): string {
  // Strip everything up to and including the "N of M" portion + any
  // trailing separator (dash or space).
  const stripped = title.replace(/^.*?\d+\s+of\s+\d+\s*[-–—]?\s*/i, "");
  return stripped || title;
}
