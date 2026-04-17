/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, readNumber, readString, writeJson, writeString } from './storage-utils';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readString', () => {
  it('returns the stored value', () => {
    localStorage.setItem('k', 'v');
    expect(readString('k')).toBe('v');
  });

  it('returns null for a missing key', () => {
    expect(readString('missing')).toBeNull();
  });

  it('returns null when getItem throws (SecurityError)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readString('k')).toBeNull();
  });
});

describe('writeString', () => {
  it('persists the value', () => {
    writeString('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
  });

  it('swallows QuotaExceededError', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeString('k', 'v')).not.toThrow();
  });
});

describe('readJson', () => {
  it('parses a JSON-encoded value', () => {
    localStorage.setItem('k', JSON.stringify({ a: 1 }));
    expect(readJson<{ a: number }>('k', { a: 0 })).toEqual({ a: 1 });
  });

  it('returns the fallback when the key is missing', () => {
    expect(readJson('missing', 'fallback')).toBe('fallback');
  });

  it('returns the fallback when the value is not valid JSON', () => {
    localStorage.setItem('k', '{not json');
    expect(readJson('k', 'fallback')).toBe('fallback');
  });

  it('round-trips arbitrary serializable shapes via writeJson', () => {
    const original = { nested: { list: [1, 2, 3], flag: true } };
    writeJson('k', original);
    expect(readJson('k', null)).toEqual(original);
  });
});

describe('writeJson', () => {
  it('serializes the value before persisting', () => {
    writeJson('k', { a: 1 });
    expect(localStorage.getItem('k')).toBe('{"a":1}');
  });
});

describe('readNumber', () => {
  it('parses a numeric string', () => {
    localStorage.setItem('k', '42');
    expect(readNumber('k', 0)).toBe(42);
  });

  it('returns the fallback when the key is missing', () => {
    expect(readNumber('missing', 99)).toBe(99);
  });

  it('returns the fallback when the stored value is not a finite number', () => {
    localStorage.setItem('k', 'not-a-number');
    expect(readNumber('k', 99)).toBe(99);
  });

  it('clamps to [min, max] when both bounds are provided', () => {
    localStorage.setItem('k', '500');
    expect(readNumber('k', 10, 0, 100)).toBe(100);
    localStorage.setItem('k', '-5');
    expect(readNumber('k', 10, 0, 100)).toBe(0);
  });

  it('does not clamp when bounds are omitted', () => {
    localStorage.setItem('k', '999');
    expect(readNumber('k', 0)).toBe(999);
  });
});
