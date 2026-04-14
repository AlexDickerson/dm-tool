// Minimal Anthropic Messages API client used by the encounter-hook
// regenerator. Lives in the main process so:
//   - the API key never has to traverse the renderer's network stack
//   - we can read the local thumbnail off disk and base64-encode it
//   - we sidestep CORS / CSP entirely
//
// We don't use the official @anthropic-ai/sdk here because it pulls in a
// surprising amount of weight for one HTTP call, and electron-vite's main
// bundler can be finicky with it. A direct fetch is a dozen lines and
// keeps the dependency surface small.

import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { MapDetail } from '../shared/types.js';
import {
  DEFAULT_MODEL,
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  ENCOUNTER_HOOK_MAX_TOKENS,
  THUMBNAIL_SUFFIX,
} from './constants.js';
import { buildEncounterHookPrompt } from './prompts.js';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function mediaTypeFor(filePath: string): ImageMediaType {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

/** Read a file and return `{base64, mediaType}` for embedding in an
 *  Anthropic image content block. Throws if the file doesn't exist. */
function loadImageAsBase64(filePath: string): {
  base64: string;
  mediaType: ImageMediaType;
} {
  if (!existsSync(filePath)) {
    throw new Error(`Image not found at ${filePath}`);
  }
  const buf = readFileSync(filePath);
  return {
    base64: buf.toString('base64'),
    mediaType: mediaTypeFor(filePath),
  };
}

/** Resolve the on-disk path of the pre-generated thumbnail for a map.
 *  Falls back to the original full-size image if no thumbnail exists. */
function resolveImagePath(libraryPath: string, fileName: string): string {
  const thumb = join(libraryPath, `${fileName}${THUMBNAIL_SUFFIX}`);
  if (existsSync(thumb)) return thumb;
  return join(libraryPath, fileName);
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicResponse {
  content: Array<AnthropicTextBlock | { type: string }>;
  // Other fields exist but we don't need them.
}

/** Strip Markdown code fences (```json … ```) the model sometimes wraps
 *  responses in despite the instructions, and parse the JSON array. */
function parseHookList(rawText: string): string[] {
  let text = rawText.trim();
  // Strip ```json … ``` or ``` … ``` if present.
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Anthropic returned non-JSON content: ${(e as Error).message}. Raw: ${rawText.slice(0, 200)}`, {
      cause: e,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Anthropic returned non-array JSON: ${typeof parsed}`);
  }
  const hooks = parsed
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (hooks.length === 0) {
    throw new Error('Anthropic returned an empty hook list');
  }
  return hooks;
}

/** Generate fresh encounter hooks for one map. Throws on any failure
 *  (network, auth, parse) so callers can surface a useful error string. */
export async function generateEncounterHooks(args: {
  apiKey: string;
  libraryPath: string;
  detail: MapDetail;
}): Promise<string[]> {
  const { apiKey, libraryPath, detail } = args;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Anthropic API key is not set. Add one in Settings.');
  }

  const imagePath = resolveImagePath(libraryPath, detail.fileName);
  const { base64, mediaType } = loadImageAsBase64(imagePath);
  const prompt = buildEncounterHookPrompt(detail);

  const body = {
    model: DEFAULT_MODEL,
    max_tokens: ENCOUNTER_HOOK_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
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
  return parseHookList(textBlock.text);
}
