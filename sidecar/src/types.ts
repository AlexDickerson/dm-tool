// Data shapes are duplicated here (rather than imported from ../../shared)
// because the sidecar is a separable deploy unit — it must be able to build
// standalone without the dm-tool repo alongside it. Keep in sync with
// shared/types.ts in dm-tool.

export interface PartyInventoryItem {
  id: string;
  name: string;
  qty: number;
  category: 'consumable' | 'equipment' | 'quest' | 'treasure' | 'other';
  bulk?: number;
  valueCp?: number;
  aonUrl?: string;
  note?: string;
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

export interface InventorySnapshot {
  items: PartyInventoryItem[];
  updatedAt: string;
}

export interface AurusSnapshot {
  teams: AurusTeam[];
  updatedAt: string;
}
