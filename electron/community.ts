// Community search — Reddit (r/Pathfinder2e, r/Pathfinder_RPG) and
// RPG Stack Exchange. Used by the chat assistant's searchCommunity tool
// to find discussions, rulings interpretations, and GM advice.

/** Strip HTML tags for Stack Exchange bodies. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|pre|code|blockquote)[\s>]/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string, max = 800): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

// ---------------------------------------------------------------------------
// Reddit via their public search JSON endpoint
// ---------------------------------------------------------------------------

interface RedditPost {
  title: string;
  selftext: string;
  permalink: string;
  score: number;
  num_comments: number;
}

async function searchReddit(query: string): Promise<string[]> {
  const url = new URL("https://www.reddit.com/r/Pathfinder2e+Pathfinder_RPG/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("restrict_sr", "on");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("limit", "3");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "dm-tool/0.1" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const posts: RedditPost[] = (data?.data?.children ?? []).map(
      (c: { data: RedditPost }) => c.data,
    );

    return posts.map((p) => {
      const body = p.selftext ? truncate(p.selftext) : "(link post — no body text)";
      return [
        `[Reddit] ${p.title}`,
        `Score: ${p.score} | Comments: ${p.num_comments}`,
        `URL: https://www.reddit.com${p.permalink}`,
        "",
        body,
      ].join("\n");
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// RPG Stack Exchange via their public API
// ---------------------------------------------------------------------------

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
  const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("q", query);
  url.searchParams.set("tagged", "pathfinder-2e");
  url.searchParams.set("site", "rpg");
  url.searchParams.set("pagesize", "3");
  url.searchParams.set("filter", "withbody");

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];

    const data: SEResponse = await res.json();

    return (data.items ?? []).map((q) => {
      const body = q.body_markdown
        ? truncate(q.body_markdown)
        : truncate(stripHtml(q.title));
      return [
        `[RPG Stack Exchange] ${stripHtml(q.title)}`,
        `Score: ${q.score} | Answers: ${q.answer_count}`,
        `URL: ${q.link}`,
        "",
        body,
      ].join("\n");
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Combined search
// ---------------------------------------------------------------------------

/**
 * Search Reddit and RPG Stack Exchange for PF2e community discussions.
 * Returns a formatted string with results from both sources.
 * Never throws.
 */
export async function searchCommunity(query: string): Promise<string> {
  const [redditResults, seResults] = await Promise.all([
    searchReddit(query),
    searchStackExchange(query),
  ]);

  const all = [...redditResults, ...seResults];

  if (all.length === 0) {
    return `[No community results found for "${query}"]`;
  }

  return all.map((r, i) => `--- Community Result ${i + 1} ---\n${r}`).join("\n\n");
}
