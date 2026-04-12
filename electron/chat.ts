import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import type { ChatChunk, ChatMessage, ChatModel } from "../shared/types.js";
import { searchAoN, searchMonster as searchMonsterAoN, searchItem as searchItemAoN, searchFeat, searchSpell } from "./aon.js";
import { searchCommunity } from "./community.js";
import { searchMonsters as searchMonstersDb, searchItems as searchItemsDb } from "./pf2e-db.js";

const SYSTEM_PROMPT = `You are a TTRPG assistant embedded in a dungeon master's prep tool. You help a GM running Pathfinder 2e (remastered) campaigns.

You can help with:
- Rules lookups and clarifications
- Improvising NPCs, dialogue, and descriptions
- Generating encounter ideas, traps, and loot
- Suggesting plot hooks and story beats
- Adjudicating edge cases during play

IMPORTANT — Rules accuracy:
Before answering ANY question about PF2e rules, mechanics, conditions, spells, feats, items, actions, traits, or creature abilities, you MUST use the lookupRule tool to search Archives of Nethys first. Do not rely on memory for rules — always look them up. You may call the tool multiple times if the question spans multiple rules topics.

Tool search tips — the lookup searches an Elasticsearch index by keyword matching. For best results:
- Search for the EXACT rule name or title, not a natural-language question (e.g. "Prone" not "what happens when you fall down")
- Keep queries SHORT — 1-3 words work best (e.g. "flanking", "Cover", "Grab an Edge")
- When a question spans multiple rules, make SEPARATE searches for each (e.g. search "Prone" and then "Moving Through a Creature's Space" as two calls, not one combined query)
- If the first search doesn't find what you need, try the official rule/condition/feat name
- If the user references a specific rule by name, search for that exact name
- CRITICAL: PF2e rules have many subsections and sidebars that modify or extend general rules. When a question involves a condition + another mechanic (e.g. prone + sharing space), ALWAYS search for the combination as well as the individual rules. For example, if asked about prone creatures and space, search for "Prone", "Moving Through a Creature's Space", AND "Prone and Incapacitated Creatures" — the subsection often has the real answer.
- When your initial results say nothing specific about the interaction being asked about, try additional searches with different keyword combinations before concluding the rules are silent

You also have a searchDiscussions tool that searches Reddit (r/Pathfinder2e) and RPG Stack Exchange. Use it when:
- The official rules are ambiguous or silent on a topic
- The user asks about common interpretations or community consensus
- The question is about GM advice, encounter balance, or homebrew
- You want to supplement an official ruling with practical play experience
Always prioritize lookupRule for RAW; use searchDiscussions for community context.

IMPORTANT: For ANY rules question, you MUST call BOTH lookupRule AND searchDiscussions before responding. Always. No exceptions. Call them in parallel if possible. The community discussions frequently surface obscure subsections, sidebars, and errata that the official search misses.

For non-rules questions (narrative, improv, descriptions, plot ideas), you do not need to use either tool.

Keep answers concise, direct, and table-ready. Prefer bullet points over paragraphs when listing options. Cite the source book and AoN URL when referencing rules. If the lookup returns no results, say so rather than guessing.

CRITICAL: When citing AoN URLs, use ONLY the exact URLs returned by the tools. NEVER construct, guess, or modify URLs. Copy them verbatim from the tool results.

Do not apologize or hedge excessively. State the rule, cite the source, move on. If you gave incomplete information earlier in the conversation, just provide the correction directly without dwelling on the error.

NEVER offer GM advice, suggest house rules, or remind the GM they can rule however they want. The user is an experienced GM — they know their authority. Just state what the rules say (or don't say) and stop. If the rules are silent, say "the rules don't address this" and nothing more.

You are operating in DRAFT mode. Your response will be reviewed before being shown to the user. Write your best answer — it will be checked for completeness and accuracy.`;

const REVIEW_PROMPT = `You are a PF2e rules auditor. Your job is to DISPROVE the draft answer.

You have been given:
1. The user's original question
2. Tool results from Archives of Nethys and community discussions
3. A draft answer

Your process:
1. READ EVERY TOOL RESULT CAREFULLY. Look for rules text, subsections, sidebars, or community posts that the draft may have ignored or misinterpreted.
2. ACTIVELY TRY TO DISPROVE the draft's conclusion. Assume the draft is wrong and look for evidence in the tool results that contradicts it. PF2e has many subsections and exceptions that override general rules.
3. If the tool results contain a rule that contradicts the draft — even a single line — the draft is WRONG. Use the tool result to write the correct answer.
4. If you cannot find evidence to disprove the draft after thorough review, then and only then accept the draft's conclusion.

Pay special attention to:
- Negative rulings ("no, you cannot") — these are almost always incomplete. Look for exceptions in the tool results.
- Subsection rules that modify or override the general rule the draft cited
- Community posts that point to commonly-missed rules

Produce the FINAL answer in markdown format. Use headings, bold, bullet points, and inline links. Keep it concise, direct, and table-ready. Cite source books and link to AoN pages.

CRITICAL: Use ONLY the exact AoN URLs from the tool results. NEVER construct, guess, or modify URLs — copy them verbatim.

Do not mention the review process, the draft, or that you are an auditor — just provide the answer.

NEVER offer GM advice, suggest house rules, or remind the user they can rule however they want. The user is an experienced GM. Just state what the rules say (or don't say) and stop.`;

const lookupRule = tool({
  description:
    "Search Archives of Nethys (the official PF2e SRD) for rules content. " +
    "Use SHORT keyword queries (1-3 words) matching the official rule/condition/feat/spell name. " +
    "Make multiple focused calls rather than one long query. " +
    "Examples: 'Prone', 'flanking', 'Magic Missile', 'Moving Through a Creature\\'s Space'.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "The search query — a rule name, condition, spell, feat, or topic " +
        "(e.g. 'flanking', 'frightened condition', 'magic missile')",
      ),
  }),
  execute: async ({ query }) => searchAoN(query),
});

const searchDiscussions = tool({
  description:
    "Search PF2e community discussions on Reddit (r/Pathfinder2e, r/Pathfinder_RPG) and RPG Stack Exchange. " +
    "Use this for edge cases, ambiguous rules interpretations, GM advice, homebrew opinions, or when " +
    "the official rules don't fully answer the question. NOT for official rules text — use lookupRule for that.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "The search query — a rules question or topic " +
        "(e.g. 'prone sharing space RAW', 'balancing boss encounters')",
      ),
  }),
  execute: async ({ query }) => searchCommunity(query),
});

const lookupMonster = tool({
  description:
    "Look up a PF2e creature/monster by name. " +
    "Returns stats, abilities, and description.",
  inputSchema: z.object({
    query: z.string().describe("Creature name (e.g. 'Goblin Warrior', 'Adult Red Dragon', 'Lich')"),
  }),
  execute: async ({ query }) => {
    try {
      const local = searchMonstersDb(query);
      if (!local.startsWith("[No")) return local;
    } catch { /* DB not loaded, fall through */ }
    return searchMonsterAoN(query);
  },
});

const lookupItem = tool({
  description:
    "Look up a PF2e item (equipment, weapon, armor, shield) by name. " +
    "Returns stats, price, traits, and description.",
  inputSchema: z.object({
    query: z.string().describe("Item name (e.g. 'Longsword', 'Healing Potion', 'Striking Rune')"),
  }),
  execute: async ({ query }) => {
    try {
      const local = searchItemsDb(query);
      if (!local.startsWith("[No")) return local;
    } catch { /* DB not loaded, fall through */ }
    return searchItemAoN(query);
  },
});

const lookupFeat = tool({
  description:
    "Look up a PF2e feat by name on Archives of Nethys. " +
    "Returns prerequisites, actions, traits, and description.",
  inputSchema: z.object({
    query: z.string().describe("Feat name (e.g. 'Power Attack', 'Fleet', 'Incredible Initiative')"),
  }),
  execute: async ({ query }) => searchFeat(query),
});

const lookupSpell = tool({
  description:
    "Look up a PF2e spell by name on Archives of Nethys. " +
    "Returns rank, traditions, components, range, and description.",
  inputSchema: z.object({
    query: z.string().describe("Spell name (e.g. 'Fireball', 'Heal', 'Magic Missile')"),
  }),
  execute: async ({ query }) => searchSpell(query),
});

export async function streamChat({
  apiKey,
  messages,
  model = "claude-sonnet-4-6",
  onChunk,
}: {
  apiKey: string;
  messages: ChatMessage[];
  model?: ChatModel;
  onChunk: (chunk: ChatChunk) => void;
}): Promise<void> {
  const anthropic = createAnthropic({ apiKey });
  const mapped = messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // --- Pass 1: Draft (with tools, not streamed to user) ---
  // Always two-pass: the model decides whether to use tools based on the
  // system prompt. Keyword detection was too brittle.
  console.log("[chat] two-pass mode");
  console.log("[chat] pass 1: generating draft with tools…");
  onChunk({ type: "tool-status", text: "Researching…" });

  const draft = await generateText({
    model: anthropic(model),
    system: SYSTEM_PROMPT,
    messages: mapped,
    tools: { lookupRule, searchDiscussions, lookupMonster, lookupItem, lookupFeat, lookupSpell },
    stopWhen: stepCountIs(3),
  });

  // Surface which tools were called for UI feedback.
  for (const step of draft.steps) {
    for (const tc of step.toolCalls) {
      const p = tc as unknown as { toolName: string; input: { query: string } };
      const labels: Record<string, string> = {
        searchDiscussions: "Searching community",
        lookupMonster: "Looking up creature",
        lookupItem: "Looking up item",
        lookupFeat: "Looking up feat",
        lookupSpell: "Looking up spell",
      };
      const label = labels[p.toolName] ?? "Looking up";
      console.log(`[chat] tool call: ${p.toolName}("${p.input?.query ?? "?"}")`);
      onChunk({ type: "tool-status", text: `${label}: ${p.input?.query ?? "…"}` });
    }
  }

  // Collect all tool results so the reviewer can see them.
  const toolContext = draft.steps
    .flatMap((s) => s.toolResults)
    .map((tr) => {
      const r = tr as unknown as { toolName: string; output: string };
      console.log(`[chat] tool result: ${r.toolName} (${String(r.output).length} chars)`);
      return `[Tool: ${r.toolName}]\n${r.output}`;
    })
    .join("\n\n");

  console.log("[chat] pass 1 draft:\n---\n%s\n---", draft.text);

  // --- Pass 2: Review + stream final answer ---
  console.log("[chat] pass 2: reviewing draft…");
  onChunk({ type: "tool-status", text: "Reviewing answer…" });

  const reviewMessages: Array<{ role: "user"; content: string }> = [
    {
      role: "user",
      content: [
        "## Original question",
        messages[messages.length - 1].content,
        "",
        "## Tool results",
        toolContext || "(no tools were called)",
        "",
        "## Draft answer",
        draft.text,
      ].join("\n"),
    },
  ];

  const reviewed = streamText({
    model: anthropic(model),
    system: REVIEW_PROMPT,
    messages: reviewMessages,
  });

  for await (const part of reviewed.fullStream) {
    if (part.type === "text-delta") {
      onChunk({ type: "delta", text: (part as unknown as { text: string }).text });
    }
  }

  onChunk({ type: "done" });
}
