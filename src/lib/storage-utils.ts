// Thin, swallow-errors-on-write localStorage helpers. Every component
// that persists preferences ended up reimplementing the same try/catch
// wrappers — centralising them keeps call sites terse and consistent.
//
// localStorage can throw for two real reasons: `SecurityError` in
// sandboxed iframes and `QuotaExceededError` when storage is full. Both
// are non-fatal for preference-sized data, so we fall back silently.

/** Read a raw string. Returns null if the key is missing or access throws. */
export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string. Silently ignores SecurityError / QuotaExceededError. */
export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Read and JSON.parse. Returns `fallback` if missing or malformed. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** JSON.stringify and write. Silently ignores errors. */
export function writeJson<T>(key: string, value: T): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Read a number. Returns `fallback` if missing/invalid. Clamps to
 *  [min, max] when both are provided. */
export function readNumber(key: string, fallback: number, min?: number, max?: number): number {
  const raw = readString(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && max !== undefined) {
    return Math.max(min, Math.min(max, n));
  }
  return n;
}
