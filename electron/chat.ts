// Two-pass chat orchestration: draft with tools → adversarial review → stream.
// Prompts live in prompts.ts; tool definitions live in chat-tools.ts.

import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, generateText, stepCountIs } from 'ai';
import type { ChatChunk, ChatMessage, ChatModel } from '../shared/types.js';
import { DEFAULT_MODEL, CHAT_STEP_LIMIT } from './constants.js';
import { CHAT_SYSTEM_PROMPT, CHAT_REVIEW_PROMPT } from './prompts.js';
import { chatTools, TOOL_STATUS_LABELS } from './chat-tools.js';

export async function streamChat({
  apiKey,
  messages,
  model = DEFAULT_MODEL,
  onChunk,
}: {
  apiKey: string;
  messages: ChatMessage[];
  model?: ChatModel;
  onChunk: (chunk: ChatChunk) => void;
}): Promise<void> {
  const anthropic = createAnthropic({ apiKey });
  const mapped = messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // --- Pass 1: Draft (with tools, not streamed to user) ---
  console.log('[chat] two-pass mode');
  console.log('[chat] pass 1: generating draft with tools…');
  onChunk({ type: 'tool-status', text: 'Researching…' });

  const draft = await generateText({
    model: anthropic(model),
    system: CHAT_SYSTEM_PROMPT,
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
  const toolContext = draft.steps
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
        toolContext || '(no tools were called)',
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
