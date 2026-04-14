import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { THUMBNAIL_SUFFIX } from './constants';

/** shadcn's standard className helper — concats classes and resolves
 *  Tailwind conflicts (`p-2 p-4` → `p-4`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Build a URL for the custom `map-file://` protocol that the Electron
 *  main process handles. The renderer should never construct raw file://
 *  URLs — they'll be blocked by CSP.
 *
 *  The URL shape is `map-file://maps/<encoded-filename>`. The fixed
 *  "maps" host is not strictly necessary, but it's load-bearing for a
 *  subtle reason: when a custom scheme is registered with `standard:
 *  true`, Chromium normalizes bare `map-file://<filename>` URLs by
 *  treating the filename as the hostname and appending a trailing `/`.
 *  Using a fixed host keeps the filename in the URL's *path* component
 *  where it survives normalization intact. */
export function mapFileUrl(fileName: string): string {
  return `map-file://maps/${encodeURIComponent(fileName)}`;
}

/** Thumbnail filename convention from dnd_map_tagger.pipeline: the
 *  thumbnail sits next to the original with ".thumb.jpg" appended after
 *  the original extension. E.g. `Alchemists_Lab.jpg` →
 *  `Alchemists_Lab.jpg.thumb.jpg`. */
export function thumbnailUrl(fileName: string): string {
  return mapFileUrl(`${fileName}${THUMBNAIL_SUFFIX}`);
}

/** Convert a raw tag value from the tagger index into a display string.
 *  Tags come out of the DB as lowercase snake/kebab-case (`river_lake`,
 *  `ancient-ruins`, `feywild`). This splits on separators and title-cases
 *  each word so the filter panel and detail pane read like prose. The raw
 *  string is still used as the key for selection/lookup — only the
 *  rendered text is rewritten. */
export function formatTag(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
