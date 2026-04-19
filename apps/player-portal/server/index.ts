// Player portal server. Serves the built SPA, the live-sync API (what used
// to be the sidecar), and proxies /map/ to map.pathfinderwiki.com to
// sidestep CORS on tile requests.
//
// Live-sync API — three datasets (inventory, aurus, globe), each with:
//   GET   /api/<name>           — read current snapshot (public)
//   POST  /api/<name>           — overwrite snapshot (DM only, bearer auth)
//   WS    /api/<name>/stream    — subscribe to updates (public, read-only)
//
// State is in-memory only. Portal restart loses it; the DM auto-pushes
// on every edit, so the cache refills within seconds of play resuming.
//
// Auth: single shared secret as `Authorization: Bearer <secret>` on writes.
// Reads/WS are unauthed since players need them and nothing private lives
// in these feeds (DM notes stay in dm-tool's SQLite / Obsidian vault).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fastifyHttpProxy from '@fastify/http-proxy';
import { createStores } from './store.js';
import type { AurusSnapshot, GlobeSnapshot, InventorySnapshot } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const SHARED_SECRET = process.env.SHARED_SECRET;
// In prod the compiled server sits at server-dist/index.js and the SPA
// build is at dist/. In dev Vite serves static from memory on :5173 and
// proxies /api and /map here, so dist/ may not exist — we skip static
// serving in that case.
const STATIC_DIR = process.env.STATIC_DIR ?? join(__dirname, '..', 'dist');

if (!SHARED_SECRET) {
  console.error('SHARED_SECRET env var is required');
  process.exit(1);
}

const stores = createStores();

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  await app.register(websocketPlugin);

  // CORS — in prod the SPA and API share an origin so this is a no-op.
  // Only matters in dev when Vite on :5173 hits the server on :3000.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') reply.code(204).send();
  });

  function requireAuth(req: { headers: { authorization?: string } }): boolean {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return false;
    return header.slice(7) === SHARED_SECRET;
  }

  app.get('/health', async () => ({ ok: true }));

  // Reverse-proxy /map/ to map.pathfinderwiki.com — tiles appear to come
  // from our origin, so the browser's CORS check passes. Replaces the
  // nginx location /map block the previous deployment used.
  await app.register(fastifyHttpProxy, {
    upstream: 'https://map.pathfinderwiki.com',
    prefix: '/map',
    rewritePrefix: '/',
    http2: false,
  });

  // --- Inventory ---------------------------------------------------------

  app.get('/api/inventory', async () => stores.inventory.get());

  app.post<{ Body: InventorySnapshot }>('/api/inventory', async (req, reply) => {
    if (!requireAuth(req)) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body;
    if (!body || !Array.isArray(body.items)) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const snapshot: InventorySnapshot = {
      items: body.items,
      updatedAt: new Date().toISOString(),
    };
    stores.inventory.set(snapshot);
    return { ok: true, updatedAt: snapshot.updatedAt };
  });

  app.get('/api/inventory/stream', { websocket: true }, (socket) => {
    socket.send(JSON.stringify(stores.inventory.get()));
    const unsub = stores.inventory.subscribe((snap) => {
      try {
        socket.send(JSON.stringify(snap));
      } catch {
        /* socket closing — unsub will fire via close */
      }
    });
    socket.on('close', unsub);
  });

  // --- Aurus leaderboard --------------------------------------------------

  app.get('/api/aurus', async () => stores.aurus.get());

  app.post<{ Body: AurusSnapshot }>('/api/aurus', async (req, reply) => {
    if (!requireAuth(req)) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body;
    if (!body || !Array.isArray(body.teams)) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const snapshot: AurusSnapshot = {
      teams: body.teams,
      updatedAt: new Date().toISOString(),
    };
    stores.aurus.set(snapshot);
    return { ok: true, updatedAt: snapshot.updatedAt };
  });

  app.get('/api/aurus/stream', { websocket: true }, (socket) => {
    socket.send(JSON.stringify(stores.aurus.get()));
    const unsub = stores.aurus.subscribe((snap) => {
      try {
        socket.send(JSON.stringify(snap));
      } catch {
        /* ignore */
      }
    });
    socket.on('close', unsub);
  });

  // --- Globe pins --------------------------------------------------------
  // Replaces the old data.json static export. DM pushes the full pin
  // snapshot on every edit; players GET it on page load and subscribe
  // to the WS stream for live updates.

  app.get('/api/globe', async () => stores.globe.get());

  app.post<{ Body: GlobeSnapshot }>('/api/globe', async (req, reply) => {
    if (!requireAuth(req)) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body;
    if (!body || !Array.isArray(body.pins)) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const snapshot: GlobeSnapshot = {
      pins: body.pins,
      updatedAt: new Date().toISOString(),
    };
    stores.globe.set(snapshot);
    return { ok: true, updatedAt: snapshot.updatedAt };
  });

  app.get('/api/globe/stream', { websocket: true }, (socket) => {
    socket.send(JSON.stringify(stores.globe.get()));
    const unsub = stores.globe.subscribe((snap) => {
      try {
        socket.send(JSON.stringify(snap));
      } catch {
        /* ignore */
      }
    });
    socket.on('close', unsub);
  });

  // --- Static SPA --------------------------------------------------------
  // Only register if dist/ exists — in dev, Vite serves static itself and
  // forwards API/map traffic here via its dev-server proxy.
  if (existsSync(STATIC_DIR)) {
    await app.register(fastifyStatic, { root: STATIC_DIR });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/map/')) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      // SPA fallback — deep-linked client routes get index.html.
      reply.sendFile('index.html');
    });
  }

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
