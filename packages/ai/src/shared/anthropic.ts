// Minimal Anthropic Messages API client used by the non-streaming agents
// (classifier, encounter hooks, loot). Chat uses the Vercel SDK for its
// streaming + tool-use primitives; everything else just posts one message.
//
// We don't use @anthropic-ai/sdk here because it pulls in a surprising amount
// of weight for one HTTP call and electron-vite's main bundler can be finicky
// with it. A direct fetch is a few dozen lines and keeps the dep surface small.

import { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION } from './constants.js';

export type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface AnthropicCallInput {
  apiKey: string;
  model: string;
  maxTokens: number;
  prompt: string;
  /** Optional image attached as the first content block. */
  image?: {
    buffer: Buffer;
    mediaType: VisionMediaType;
  };
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicResponse {
  content: Array<AnthropicTextBlock | { type: string }>;
}

/** Call the Anthropic messages API with a single turn (optional image + text)
 *  and return the raw text block. Throws on network/HTTP/shape errors. */
export async function callAnthropic(req: AnthropicCallInput): Promise<string> {
  if (!req.apiKey || req.apiKey.trim().length === 0) {
    throw new Error('Anthropic API key is not set.');
  }

  const content: Array<Record<string, unknown>> = [];
  if (req.image) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: req.image.mediaType,
        data: req.image.buffer.toString('base64'),
      },
    });
  }
  content.push({ type: 'text', text: req.prompt });

  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: [{ role: 'user', content }],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 300) || res.statusText}`);
  }

  const json = (await res.json()) as AnthropicResponse;
  const textBlock = json.content?.find((c): c is AnthropicTextBlock => c.type === 'text');
  if (!textBlock) {
    throw new Error('Anthropic response had no text content block');
  }
  return textBlock.text;
}
