// In-memory stores for the three live-synced datasets. Portal restart
// loses state by design — the DM auto-pushes on every edit, so the
// cache refills on the next change. For a cold-start scenario (portal
// just deployed, DM hasn't made an edit yet) the Resync button in the
// DM's Settings > Player Portal section force-rebuilds and pushes.

import type { AurusSnapshot, GlobeSnapshot, InventorySnapshot } from './types.js';

const emptyInventory = (): InventorySnapshot => ({
  items: [],
  updatedAt: new Date().toISOString(),
});

const emptyAurus = (): AurusSnapshot => ({
  teams: [],
  updatedAt: new Date().toISOString(),
});

const emptyGlobe = (): GlobeSnapshot => ({
  pins: [],
  updatedAt: new Date().toISOString(),
});

export class Store<T> {
  private cache: T;
  private readonly listeners = new Set<(snapshot: T) => void>();

  constructor(initial: T) {
    this.cache = initial;
  }

  get(): T {
    return this.cache;
  }

  set(next: T): void {
    this.cache = next;
    for (const fn of this.listeners) fn(next);
  }

  subscribe(fn: (snapshot: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function createStores() {
  return {
    inventory: new Store<InventorySnapshot>(emptyInventory()),
    aurus: new Store<AurusSnapshot>(emptyAurus()),
    globe: new Store<GlobeSnapshot>(emptyGlobe()),
  };
}
