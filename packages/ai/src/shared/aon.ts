// Archives of Nethys lookup via their public Elasticsearch endpoint.

import { AON_BASE_URL, AON_ELASTICSEARCH_URL } from './constants.js';
import { stripHtml, truncate } from './text.js';

interface AonHit {
  name: string;
  category: string;
  text: string;
  source: string[];
  url: string;
}

function formatHits(hits: AonHit[], label: string): string {
  if (hits.length === 0) return `[No ${label} results found]`;
  return hits
    .map((h, i) => {
      const sources = Array.isArray(h.source) ? h.source.join(', ') : h.source;
      const body = truncate(stripHtml(h.text), 1500);
      return [
        `--- ${label} Result ${i + 1}: ${h.name} (${h.category}) ---`,
        `Source: ${sources}`,
        `URL: ${AON_BASE_URL}${h.url}`,
        '',
        body,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Core search function with optional category filtering.
 * Never throws — returns an error message string on failure.
 */
async function queryAoN(
  query: string,
  opts: { categories?: string[]; size?: number; label?: string } = {},
): Promise<string> {
  const { categories, size = 3, label = 'AoN' } = opts;

  try {
    const esQuery: Record<string, unknown> = categories
      ? {
          bool: {
            must: { multi_match: { query, fields: ['name^3', 'text'] } },
            filter: { terms: { category: categories } },
          },
        }
      : { multi_match: { query, fields: ['name^3', 'text'] } };

    const res = await fetch(AON_ELASTICSEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        query: esQuery,
        size,
        _source: ['name', 'category', 'text', 'source', 'url'],
      }),
    });

    if (!res.ok) return `[AoN lookup failed: HTTP ${res.status}]`;

    const data = (await res.json()) as { hits?: { hits?: Array<{ _source: AonHit }> } };
    const hits: AonHit[] = (data.hits?.hits ?? []).map((h: { _source: AonHit }) => h._source);

    return formatHits(hits, label);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[AoN lookup error: ${msg}]`;
  }
}

export function searchAoN(query: string): Promise<string> {
  return queryAoN(query, { label: 'Rules' });
}

export function searchMonster(query: string): Promise<string> {
  return queryAoN(query, { categories: ['creature'], label: 'Creature' });
}

export function searchItem(query: string): Promise<string> {
  return queryAoN(query, {
    categories: ['equipment', 'weapon', 'armor', 'shield'],
    label: 'Item',
  });
}

export function searchFeat(query: string): Promise<string> {
  return queryAoN(query, { categories: ['feat'], label: 'Feat' });
}

export function searchSpell(query: string): Promise<string> {
  return queryAoN(query, { categories: ['spell'], label: 'Spell' });
}
