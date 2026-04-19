export function stripHtml(html: string): string {
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|pre|code|blockquote)[\s>]/gi, '\n');
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]+>/g, '');
  } while (text !== prev);
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  return text
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (m) => entities[m])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

/** Attempt to parse JSON, returning `fallback` on failure or null input. */
export function tryParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
