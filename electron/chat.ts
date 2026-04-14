// Chat orchestration.
//
// Two modes:
//   • General (default) — single-pass streaming with optional tool use.
//   • Rules (/rule)     — two-pass: draft with mandatory tools → adversarial
//                         review → streamed final answer.
//
// Prompts live in prompts.ts; tool definitions live in chat-tools.ts.

import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, generateText, stepCountIs } from 'ai';
import type { ChatChunk, ChatMessage, ChatModel } from '../shared/types.js';
import { DEFAULT_MODEL, CHAT_STEP_LIMIT } from './constants.js';
import { CHAT_GENERAL_PROMPT, CHAT_RULES_PROMPT, CHAT_REVIEW_PROMPT } from './prompts.js';
import { chatTools, TOOL_STATUS_LABELS } from './chat-tools.js';

function buildSystemPrompt(base: string, pageContext?: string): string {
  if (!pageContext) return base;
  console.log(`[chat] injecting tool page context (${pageContext.length} chars)`);
  return (
    base +
    '\n\n---\n\nThe user currently has a web tool open in the Tools tab. ' +
    'Here is the visible text content of that page (truncated to ~8 000 chars). ' +
    "Reference this context if the user's question relates to it:\n\n" +
    pageContext
  );
}

export async function streamChat({
  apiKey,
  messages,
  model = DEFAULT_MODEL,
  rulesMode = false,
  toolContext: pageContext,
  onChunk,
}: {
  apiKey: string;
  messages: ChatMessage[];
  model?: ChatModel;
  rulesMode?: boolean;
  toolContext?: string;
  onChunk: (chunk: ChatChunk) => void;
}): Promise<void> {
  const anthropic = createAnthropic({ apiKey });
  const mapped = messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  if (rulesMode) {
    await streamRulesMode(anthropic, model, mapped, messages, pageContext, onChunk);
  } else {
    await streamGeneralMode(anthropic, model, mapped, pageContext, onChunk);
  }
}

// ---------------------------------------------------------------------------
// General mode — single pass, streamed directly
// ---------------------------------------------------------------------------

async function streamGeneralMode(
  anthropic: ReturnType<typeof createAnthropic>,
  model: ChatModel,
  mapped: Array<{ role: 'user' | 'assistant'; content: string }>,
  pageContext: string | undefined,
  onChunk: (chunk: ChatChunk) => void,
): Promise<void> {
  console.log('[chat] general mode (single-pass)');

  const systemPrompt = buildSystemPrompt(CHAT_GENERAL_PROMPT, pageContext);

  const result = streamText({
    model: anthropic(model),
    system: systemPrompt,
    messages: mapped,
    tools: chatTools,
    stopWhen: stepCountIs(CHAT_STEP_LIMIT),
  });

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      onChunk({ type: 'delta', text: (part as unknown as { text: string }).text });
    } else if (part.type === 'tool-call') {
      const p = part as unknown as { toolName: string; args: { query: string } };
      const label = TOOL_STATUS_LABELS[p.toolName] ?? 'Looking up';
      console.log(`[chat] tool call: ${p.toolName}("${p.args?.query ?? '?'}")`);
      onChunk({ type: 'tool-status', text: `${label}: ${p.args?.query ?? '…'}` });
    }
  }

  onChunk({ type: 'done' });
}

// ---------------------------------------------------------------------------
// Rules mode — two-pass: draft with tools → adversarial review → stream
// ---------------------------------------------------------------------------

async function streamRulesMode(
  anthropic: ReturnType<typeof createAnthropic>,
  model: ChatModel,
  mapped: Array<{ role: 'user' | 'assistant'; content: string }>,
  messages: ChatMessage[],
  pageContext: string | undefined,
  onChunk: (chunk: ChatChunk) => void,
): Promise<void> {
  console.log('[chat] rules mode (two-pass)');

  const systemPrompt = buildSystemPrompt(CHAT_RULES_PROMPT, pageContext);

  // --- Pass 1: Draft (with tools, not streamed to user) ---
  console.log('[chat] pass 1: generating draft with tools…');
  onChunk({ type: 'tool-status', text: 'Researching…' });

  const draft = await generateText({
    model: anthropic(model),
    system: systemPrompt,
    messages: mapped,
    tools: chatTools,
    stopWhen: stepCountIs(CHAT_STEP_LIMIT),
  });

  // Surface which tools were called for UI feedback.
  for (const step of draft.steps) {
    for (const tc of step.toolCalls) {
      const p = tc as unknown as { toolName: string; input: { query: string } };
      const label = TOOL_STATUS_LABELS[p.toolName] ?? 'Looking up';
      console.log(`[chat] tool call: ${p.toolName}("${p.input?.query ?? '?'}")`);
      onChunk({ type: 'tool-status', text: `${label}: ${p.input?.query ?? '…'}` });
    }
  }

  // Collect all tool results so the reviewer can see them.
  const toolResults = draft.steps
    .flatMap((s) => s.toolResults)
    .map((tr) => {
      const r = tr as unknown as { toolName: string; output: string };
      console.log(`[chat] tool result: ${r.toolName} (${String(r.output).length} chars)`);
      return `[Tool: ${r.toolName}]\n${r.output}`;
    })
    .join('\n\n');

  console.log('[chat] pass 1 draft:\n---\n%s\n---', draft.text);

  // --- Pass 2: Review + stream final answer ---
  console.log('[chat] pass 2: reviewing draft…');
  onChunk({ type: 'tool-status', text: 'Reviewing answer…' });

  const reviewMessages: Array<{ role: 'user'; content: string }> = [
    {
      role: 'user',
      content: [
        '## Original question',
        messages[messages.length - 1].content,
        '',
        '## Tool results',
        toolResults || '(no tools were called)',
        '',
        '## Draft answer',
        draft.text,
      ].join('\n'),
    },
  ];

  const reviewed = streamText({
    model: anthropic(model),
    system: CHAT_REVIEW_PROMPT,
    messages: reviewMessages,
  });

  for await (const part of reviewed.fullStream) {
    if (part.type === 'text-delta') {
      onChunk({ type: 'delta', text: (part as unknown as { text: string }).text });
    }
  }

  onChunk({ type: 'done' });
}
