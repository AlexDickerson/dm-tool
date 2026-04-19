// JSON-file persistence for the two live-synced datasets. One file per
// dataset keeps each snapshot self-contained and easy to inspect/backup.
// Writes are atomic via write-then-rename so a kill mid-write can't leave
// a truncated file.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  private readonly filePath: string;
  private readonly listeners = new Set<(snapshot: T) => void>();

  constructor(filePath: string, initial: T) {
    this.filePath = filePath;
    this.cache = initial;
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      await mkdir(dirname(this.filePath), { recursive: true });
      await this.persist(this.cache);
      return;
    }
    const raw = await readFile(this.filePath, 'utf-8');
    this.cache = JSON.parse(raw) as T;
  }

  get(): T {
    return this.cache;
  }

  async set(next: T): Promise<void> {
    this.cache = next;
    await this.persist(next);
    for (const fn of this.listeners) fn(next);
  }

  subscribe(fn: (snapshot: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async persist(value: T): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8');
    await rename(tmp, this.filePath);
  }
}

export function createStores(dataDir: string) {
  return {
    inventory: new Store<InventorySnapshot>(join(dataDir, 'inventory.json'), emptyInventory()),
    aurus: new Store<AurusSnapshot>(join(dataDir, 'aurus.json'), emptyAurus()),
    globe: new Store<GlobeSnapshot>(join(dataDir, 'globe.json'), emptyGlobe()),
  };
}
