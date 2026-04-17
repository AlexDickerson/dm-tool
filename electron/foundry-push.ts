// Push a map scene to Foundry VTT via the foundry-mcp Streamable HTTP endpoint.
//
// Orchestrates: initialize session → upload image → create scene. When uvttData
// is provided, walls + doors are generated from it; otherwise a plain scene is
// created sized to the image.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { MCP_PROTOCOL_VERSION } from './constants.js';

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
  /** When provided, the scene is created with walls + doors derived from the
   *  .uvtt. When omitted, a plain scene is created — requires imageDimensions. */
  uvttData?: UvttData;
  /** Required when uvttData is not provided. Used as the scene's pixel
   *  width/height so the background image fills the canvas. */
  imageDimensions?: { width: number; height: number };
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

  // Notifications return 202 with no body
  if (!text.trim()) {
    return { headers: res.headers, data: {} };
  }

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
        protocolVersion: MCP_PROTOCOL_VERSION,
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

/** Default pixels per grid square when synthesizing an empty uvtt blob. Foundry's
 *  default is 100 px = 5 ft per square, matching our fallback grid settings. */
const DEFAULT_PIXELS_PER_GRID = 100;

export async function pushSceneToFoundry(opts: PushSceneOptions): Promise<PushSceneResult> {
  if (!opts.uvttData && !opts.imageDimensions) {
    throw new Error('pushSceneToFoundry: imageDimensions is required when uvttData is not provided');
  }

  const session = await initSession(opts.foundryMcpUrl);

  // 1. Upload the map image
  const imageData = readFileSync(opts.imagePath).toString('base64');
  const fileName = basename(opts.imagePath);
  const uploadPath = `maps/${fileName}`;

  await callTool(session, 'upload_asset', {
    path: uploadPath,
    data: imageData,
  });

  // 2. Create the scene. We always go through `create_scene_from_uvtt` even for
  //    wall-less maps, because foundry-mcp's plain `create_scene` handler only
  //    sets `scene.background.src` — which Foundry v14 ignores in favor of
  //    `levels[0].background.src`. The uvtt handler sets the Level correctly, so
  //    the image actually renders. When we don't have a real .uvtt file we
  //    synthesize a minimal blob sized to the image with no walls or portals.
  const uvttData: UvttData = opts.uvttData ?? {
    resolution: {
      pixels_per_grid: DEFAULT_PIXELS_PER_GRID,
      map_size: {
        x: opts.imageDimensions!.width / DEFAULT_PIXELS_PER_GRID,
        y: opts.imageDimensions!.height / DEFAULT_PIXELS_PER_GRID,
      },
    },
    line_of_sight: [],
  };

  const result = await callTool(session, 'create_scene_from_uvtt', {
    name: opts.name,
    img: uploadPath,
    uvtt: uvttData,
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
