// Live-sync service. Two datasets (inventory, aurus), each with:
//   GET   /api/<name>           — read current snapshot (public)
//   POST  /api/<name>           — overwrite snapshot (DM only, bearer auth)
//   WS    /api/<name>/stream    — subscribe to updates (public, read-only)
//
// Auth model: a single shared secret passed as `Authorization: Bearer <secret>`
// on writes. Reads and WS subscriptions are unauthed since players need them
// and there's nothing private in the snapshots (secrets like DM notes stay
// in dm-tool's SQLite / Obsidian vault).

import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { createStores } from './store.js';
import type { AurusSnapshot, InventorySnapshot } from './types.js';

const PORT = parseInt(process.env.PORT ?? '30003', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR ?? './data';
const SHARED_SECRET = process.env.SHARED_SECRET;

if (!SHARED_SECRET) {
  console.error('SHARED_SECRET env var is required');
  process.exit(1);
}

const stores = createStores(DATA_DIR);

async function main(): Promise<void> {
  await stores.inventory.load();
  await stores.aurus.load();

  const app = Fastify({ logger: true });
  await app.register(websocketPlugin);

  // Permissive CORS — in practice this service sits behind nginx on the same
  // origin as the player portal, so CORS isn't exercised in prod. Leaving it
  // open for dev convenience (e.g. running player-map on :5173 against a
  // local sidecar).
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  function requireAuth(req: { headers: { authorization?: string } }): boolean {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return false;
    return header.slice(7) === SHARED_SECRET;
  }

  app.get('/health', async () => ({ ok: true }));

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
    await stores.inventory.set(snapshot);
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
    await stores.aurus.set(snapshot);
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

  await app.listen({ port: PORT, host: HOST });
  console.log(`sidecar listening on ${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
