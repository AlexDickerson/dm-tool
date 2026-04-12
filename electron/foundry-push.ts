// Push a map scene to Foundry VTT via the foundry-mcp Streamable HTTP endpoint.
//
// Orchestrates: initialize session → upload image → create scene with walls.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UvttResolution {
  pixels_per_grid: number;
  map_size: { x: number; y: number };
}

interface UvttPortal {
  position: { x: number; y: number };
  bounds: Array<{ x: number; y: number }>;
  closed?: boolean;
}

interface UvttData {
  resolution: UvttResolution;
  line_of_sight: Array<Array<{ x: number; y: number }>>;
  portals?: UvttPortal[];
}

export interface PushSceneOptions {
  foundryMcpUrl: string;
  name: string;
  imagePath: string;
  uvttData: UvttData;
  gridDistance?: number;
  gridUnits?: string;
}

export interface PushSceneResult {
  sceneId: string;
  sceneName: string;
  wallsCreated: number;
  doorsCreated: number;
}

// ---------------------------------------------------------------------------
// MCP Streamable HTTP helpers
// ---------------------------------------------------------------------------

interface McpSession {
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

  // Parse SSE response: find `data: {...}` line
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return { headers: res.headers, data: JSON.parse(line.slice(6)) as Record<string, unknown> };
    }
  }

  // Fallback: try parsing entire body as JSON
  return { headers: res.headers, data: JSON.parse(text) as Record<string, unknown> };
}

async function initSession(url: string): Promise<McpSession> {
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
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'dm-tool', version: '1.0' },
      },
    }),
  });

  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('No MCP session ID returned');

  // Consume the response body
  await res.text();

  const session: McpSession = { url, sessionId, nextId: 2 };

  // Send initialized notification
  await mcpPost(session, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  return session;
}

async function callTool(
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

  // Check if the tool returned an error
  if (textContent.text.startsWith('Error:')) {
    throw new Error(textContent.text);
  }

  return JSON.parse(textContent.text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function pushSceneToFoundry(opts: PushSceneOptions): Promise<PushSceneResult> {
  const session = await initSession(opts.foundryMcpUrl);

  // 1. Upload the map image
  const imageData = readFileSync(opts.imagePath).toString('base64');
  const fileName = basename(opts.imagePath);
  const uploadPath = `maps/${fileName}`;

  await callTool(session, 'upload_asset', {
    path: uploadPath,
    data: imageData,
  });

  // 2. Create the scene with walls from .uvtt
  const result = await callTool(session, 'create_scene_from_uvtt', {
    name: opts.name,
    img: uploadPath,
    uvtt: opts.uvttData,
    gridDistance: opts.gridDistance ?? 5,
    gridUnits: opts.gridUnits ?? 'ft',
    activate: true,
  });

  return {
    sceneId: result['id'] as string,
    sceneName: result['name'] as string,
    wallsCreated: (result['wallsCreated'] as number) ?? 0,
    doorsCreated: (result['doorsCreated'] as number) ?? 0,
  };
}
