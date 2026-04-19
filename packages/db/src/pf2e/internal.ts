// Tiny helpers used by more than one domain module. Kept local to the pf2e
// subpackage rather than pulled from @dm-tool/shared so the DB layer can't
// accidentally pick up UI-flavoured utilities.

/** Attempt to parse JSON, returning `fallback` on failure or null input. */
export function tryParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
