// Minimal MCP client for the foundry-mcp server's Streamable HTTP endpoint.
//
// This module owns the JSON-RPC + SSE-parsing plumbing. Callers get typed
// tool wrappers (findInCompendium, createActorFromCompendium, etc.) that
// hide the fact we're talking JSON-RPC under the hood. If we ever move off
// MCP or add a second transport, only this file changes.

import { MCP_PROTOCOL_VERSION } from './constants.js';

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface McpSession {
  url: string;
  sessionId: string;
  nextId: number;
}

async function mcpPost(
  session: McpSession,
  body: Record<string, unknown>,
): Promise<{ headers: Headers; data: Record<string, unknown> }> {
  const res = await fetch(`${session.url}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Session-Id': session.sessionId,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  // Notifications return 202 with no body.
  if (!text.trim()) {
    return { headers: res.headers, data: {} };
  }

  // The server returns SSE-framed JSON for tool responses — find the data: line.
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return { headers: res.headers, data: JSON.parse(line.slice(6)) as Record<string, unknown> };
    }
  }

  // Fallback to parsing the whole body as JSON.
  return { headers: res.headers, data: JSON.parse(text) as Record<string, unknown> };
}

/** Open a session with the foundry-mcp server. Performs the MCP
 *  initialize handshake and sends notifications/initialized. Sessions
 *  are cheap but not free — callers should reuse a session for the
 *  duration of a logical task (e.g. pushing one encounter's actors). */
export async function initSession(url: string): Promise<McpSession> {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dm-tool', version: '1.0' },
      },
    }),
  });

  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('No MCP session ID returned');
  await res.text(); // consume the init response body

  const session: McpSession = { url, sessionId, nextId: 2 };

  await mcpPost(session, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  return session;
}

/** Call a tool and parse the single JSON result. foundry-mcp tools return
 *  their structured results as a JSON-stringified text content block, so we
 *  unwrap and re-parse. */
export async function callTool(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = session.nextId++;
  const { data } = await mcpPost(session, {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

  const result = data['result'] as { content?: Array<{ type: string; text?: string }> } | undefined;
  const textContent = result?.content?.find((c) => c.type === 'text');

  if (!textContent?.text) {
    const error = data['error'] as { message?: string } | undefined;
    throw new Error(error?.message ?? 'No result from tool call');
  }

  if (textContent.text.startsWith('Error:')) {
    throw new Error(textContent.text);
  }

  return JSON.parse(textContent.text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Typed tool wrappers
//
// Shapes mirror foundry-mcp's handler return types. We don't share type
// definitions across repos — duplication here is a small cost for keeping
// the two packages independently shippable.
// ---------------------------------------------------------------------------

export interface CompendiumMatch {
  packId: string;
  packLabel: string;
  documentId: string;
  uuid: string;
  name: string;
  type: string;
  img: string;
}

export async function findInCompendium(
  session: McpSession,
  args: {
    name: string;
    documentType?: string;
    packId?: string;
    limit?: number;
  },
): Promise<CompendiumMatch[]> {
  const result = await callTool(session, 'find_in_compendium', args as Record<string, unknown>);
  return (result['matches'] as CompendiumMatch[] | undefined) ?? [];
}

export interface ActorResult {
  id: string;
  uuid: string;
  name: string;
  type: string;
  img: string;
  folder: string | null;
}

export async function createActorFromCompendium(
  session: McpSession,
  args: {
    packId: string;
    actorId: string;
    name?: string;
    folder?: string;
  },
): Promise<ActorResult> {
  const result = await callTool(session, 'create_actor_from_compendium', args as Record<string, unknown>);
  return result as unknown as ActorResult;
}

export type FolderDocumentType =
  | 'Actor'
  | 'Item'
  | 'Scene'
  | 'JournalEntry'
  | 'RollTable'
  | 'Macro'
  | 'Playlist'
  | 'Adventure'
  | 'Card';

export interface FolderResult {
  id: string;
  name: string;
  type: string;
  /** True when a new folder was created, false when an existing one was reused. */
  created: boolean;
}

export async function findOrCreateFolder(
  session: McpSession,
  args: {
    name: string;
    type: FolderDocumentType;
    parentFolderId?: string;
  },
): Promise<FolderResult> {
  const result = await callTool(session, 'find_or_create_folder', args as Record<string, unknown>);
  return result as unknown as FolderResult;
}

// ---------------------------------------------------------------------------
// Existing scene-push tool wrappers (used by foundry-push.ts)
// ---------------------------------------------------------------------------

export async function uploadAsset(
  session: McpSession,
  args: { path: string; data: string },
): Promise<Record<string, unknown>> {
  return callTool(session, 'upload_asset', args as Record<string, unknown>);
}

export async function createSceneFromUvtt(
  session: McpSession,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callTool(session, 'create_scene_from_uvtt', args);
}
