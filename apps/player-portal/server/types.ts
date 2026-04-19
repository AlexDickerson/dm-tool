// Data shapes are duplicated here (rather than imported from the shared
// workspace package) because the server builds with NodeNext module
// resolution — .ts source from @dm-tool/shared isn't consumable at
// runtime. Keep these in sync with packages/shared/src/types.ts on the
// fields the player portal and DM push agree on.

export interface PartyInventoryItem {
  id: string;
  name: string;
  qty: number;
  category: 'consumable' | 'equipment' | 'quest' | 'treasure' | 'other';
  bulk?: number;
  valueCp?: number;
  aonUrl?: string;
  note?: string;
  carriedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AurusTeam {
  id: string;
  name: string;
  emblem?: string;
  color: string;
  combatPower: number;
  valueReclaimedCp: number;
  isPlayerParty: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// Globe pins pushed from dm-tool. The server is a pass-through — it
// doesn't inspect `mission` beyond storing it. Mission data is shaped +
// DM-scrubbed before the push, see dm-tool's encounter-push / globe.ts.
export interface GlobePin {
  id: string;
  lng: number;
  lat: number;
  label: string;
  icon: string;
  zoom: number;
  note: string;
  kind: 'note' | 'mission';
  mission?: Record<string, unknown>;
}

export interface InventorySnapshot {
  items: PartyInventoryItem[];
  updatedAt: string;
}

export interface AurusSnapshot {
  teams: AurusTeam[];
  updatedAt: string;
}

export interface GlobeSnapshot {
  pins: GlobePin[];
  updatedAt: string;
}
