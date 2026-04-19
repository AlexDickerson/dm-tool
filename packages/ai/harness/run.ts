// CLI harness for AI agents.
//
// Usage:
//   tsx harness/run.ts --fixture fixtures/chat/rules-frightened.json
//   tsx harness/run.ts --fixture fixtures/chat/general-flanking.json --transcript
//
// Reads ANTHROPIC_API_KEY from env. No pf2e-db deps — tool lookups fall through
// to Archives of Nethys (realistic for prompt iteration).

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ChatChunk, ChatMessage, ChatModel } from '@dm-tool/shared/types';
import { streamChat } from '../src/chat/index.js';

interface ChatFixture {
  messages: ChatMessage[];
  rulesMode?: boolean;
  toolContext?: string;
  model?: ChatModel;
}

async function main() {
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string', short: 'f' },
      transcript: { type: 'boolean', short: 't', default: false },
    },
  });

  if (!values.fixture) {
    console.error('Usage: tsx harness/run.ts --fixture <path> [--transcript]');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const fixturePath = resolve(values.fixture);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as ChatFixture;

  const start = Date.now();
  let output = '';
  const toolCalls: string[] = [];

  const onChunk = (chunk: ChatChunk) => {
    switch (chunk.type) {
      case 'delta':
        process.stdout.write(chunk.text ?? '');
        output += chunk.text ?? '';
        break;
      case 'tool-status':
        // ANSI dim
        process.stderr.write(`\x1b[2m[${chunk.text}]\x1b[0m\n`);
        if (chunk.text) toolCalls.push(chunk.text);
        break;
      case 'error':
        process.stderr.write(`\x1b[31m[error: ${chunk.error}]\x1b[0m\n`);
        break;
    }
  };

  await streamChat({
    apiKey,
    messages: fixture.messages,
    rulesMode: fixture.rulesMode,
    toolContext: fixture.toolContext,
    model: fixture.model,
    onChunk,
  });

  const duration = Date.now() - start;
  process.stdout.write('\n');
  const meta = { duration_ms: duration, tool_calls: toolCalls.length, output_chars: output.length };
  process.stderr.write(`\x1b[2m${JSON.stringify(meta)}\x1b[0m\n`);

  if (values.transcript) {
    const transcriptPath = resolve(dirname(fixturePath), basename(fixturePath, '.json') + '.transcript.md');
    const md = [
      `# ${basename(fixturePath, '.json')}`,
      `_${new Date().toISOString()}_`,
      '',
      '## Input',
      '```json',
      JSON.stringify(fixture, null, 2),
      '```',
      '',
      '## Tool calls',
      toolCalls.length ? toolCalls.map((t) => `- ${t}`).join('\n') : '_(none)_',
      '',
      '## Output',
      '',
      output,
      '',
      '## Meta',
      '```json',
      JSON.stringify(meta, null, 2),
      '```',
      '',
    ].join('\n');
    writeFileSync(transcriptPath, md);
    process.stderr.write(`\x1b[2mwrote ${transcriptPath}\x1b[0m\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
