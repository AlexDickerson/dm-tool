// Fetch a single AoN entry by its URL path for hover previews.

import type { AonPreviewData } from '../shared/types.js';

const AON_URL = 'https://elasticsearch.aonprd.com/aon/_search';

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|blockquote)[\s>]/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetch preview data for an AoN entry by URL path.
 * Returns structured creature data or generic text preview.
 */
export async function fetchAonPreview(urlPath: string): Promise<AonPreviewData | null> {
  try {
    const res = await fetch(AON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        query: { term: { url: urlPath } },
        size: 1,
        _source: [
          'name',
          'category',
          'text',
          'url',
          'summary',
          // Creature fields
          'level',
          'hp',
          'hp_raw',
          'ac',
          'fortitude_save',
          'reflex_save',
          'will_save',
          'perception',
          'speed_raw',
          'size',
          'trait_raw',
          'creature_ability',
          'creature_family',
          'immunity',
          'weakness_raw',
          'resistance',
          'rarity',
          'strength',
          'dexterity',
          'constitution',
          'intelligence',
          'wisdom',
          'charisma',
        ],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const hit = data.hits?.hits?.[0]?._source;
    if (!hit) return null;

    if (hit.category === 'creature') {
      // Extract the stat block: everything after the first `---` separator
      // in the raw text. This contains defenses, abilities, and attacks.
      const rawText = hit.text ?? '';
      const sections = rawText.split(/\s---\s/);
      const statBlock = sections.length > 1 ? sections.slice(1).join('\n---\n').trim() : '';

      return {
        type: 'creature',
        name: hit.name,
        level: hit.level,
        hp: hit.hp,
        ac: hit.ac,
        fortitude: hit.fortitude_save,
        reflex: hit.reflex_save,
        will: hit.will_save,
        perception: hit.perception,
        speed: hit.speed_raw ?? '',
        size: Array.isArray(hit.size) ? hit.size[0] : (hit.size ?? ''),
        traits: hit.trait_raw ?? [],
        abilities: hit.creature_ability ?? [],
        immunities: hit.immunity ?? [],
        weaknesses: hit.weakness_raw ?? '',
        rarity: hit.rarity ?? 'common',
        summary: hit.summary ?? '',
        strength: hit.strength,
        dexterity: hit.dexterity,
        constitution: hit.constitution,
        intelligence: hit.intelligence,
        wisdom: hit.wisdom,
        charisma: hit.charisma,
        statBlock,
      };
    }

    // Generic preview for rules, feats, spells, items, etc.
    const text = hit.text ? stripHtml(hit.text) : '';
    return {
      type: 'generic',
      name: hit.name ?? '',
      category: hit.category ?? '',
      text: text.length > 600 ? text.slice(0, 600) + '…' : text,
    };
  } catch {
    return null;
  }
}
