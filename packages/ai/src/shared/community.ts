// Community search — Reddit (r/Pathfinder2e, r/Pathfinder_RPG) and RPG Stack Exchange.

import { stripHtml, truncate } from './text.js';

interface RedditPost {
  title: string;
  selftext: string;
  permalink: string;
  score: number;
  num_comments: number;
}

async function searchReddit(query: string): Promise<string[]> {
  const url = new URL('https://www.reddit.com/r/Pathfinder2e+Pathfinder_RPG/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('restrict_sr', 'on');
  url.searchParams.set('sort', 'relevance');
  url.searchParams.set('limit', '3');

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'dm-tool/0.1' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { data?: { children?: Array<{ data: RedditPost }> } };
    const posts: RedditPost[] = (data?.data?.children ?? []).map((c: { data: RedditPost }) => c.data);

    return posts.map((p) => {
      const body = p.selftext ? truncate(p.selftext, 800) : '(link post — no body text)';
      return [
        `[Reddit] ${p.title}`,
        `Score: ${p.score} | Comments: ${p.num_comments}`,
        `URL: https://www.reddit.com${p.permalink}`,
        '',
        body,
      ].join('\n');
    });
  } catch {
    return [];
  }
}

interface SERawQuestion {
  title: string;
  link: string;
  score: number;
  answer_count: number;
  body_markdown?: string;
}

interface SEResponse {
  items: SERawQuestion[];
}

async function searchStackExchange(query: string): Promise<string[]> {
  const url = new URL('https://api.stackexchange.com/2.3/search/advanced');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('sort', 'relevance');
  url.searchParams.set('q', query);
  url.searchParams.set('tagged', 'pathfinder-2e');
  url.searchParams.set('site', 'rpg');
  url.searchParams.set('pagesize', '3');
  url.searchParams.set('filter', 'withbody');

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];

    const data = (await res.json()) as SEResponse;

    return (data.items ?? []).map((q) => {
      const body = q.body_markdown ? truncate(q.body_markdown, 800) : truncate(stripHtml(q.title), 800);
      return [
        `[RPG Stack Exchange] ${stripHtml(q.title)}`,
        `Score: ${q.score} | Answers: ${q.answer_count}`,
        `URL: ${q.link}`,
        '',
        body,
      ].join('\n');
    });
  } catch {
    return [];
  }
}

/**
 * Search Reddit and RPG Stack Exchange for PF2e community discussions.
 * Returns a formatted string with results from both sources. Never throws.
 */
export async function searchCommunity(query: string): Promise<string> {
  const [redditResults, seResults] = await Promise.all([searchReddit(query), searchStackExchange(query)]);

  const all = [...redditResults, ...seResults];

  if (all.length === 0) {
    return `[No community results found for "${query}"]`;
  }

  return all.map((r, i) => `--- Community Result ${i + 1} ---\n${r}`).join('\n\n');
}
