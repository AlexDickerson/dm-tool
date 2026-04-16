// Minimal type subset for the player-facing read-only globe.
// Mirrors the relevant parts of dm-tool's shared/types.ts.

export type GlobePinKind = 'note' | 'mission';
export type MissionThreatLevel = 'Trivial' | 'Low' | 'Moderate' | 'Severe' | 'Extreme';
export type MissionStatus = 'Available' | 'Active' | 'Completed' | 'Failed';

export interface GlobePin {
  id: string;
  lng: number;
  lat: number;
  label: string;
  icon: string;
  zoom: number;
  kind: GlobePinKind;
  /** Pre-parsed mission data, present only for mission pins. */
  mission?: MissionData;
}

export interface MissionObjective {
  id: string;
  text: string;
  isPrimary: boolean;
  completed: boolean;
}

export interface MissionThreat {
  id: string;
  name: string;
  level: number;
  type?: string;
}

export interface MissionReward {
  gold?: number;
  xp?: number;
  items?: string[];
}

export interface MissionData {
  name: string;
  threatLevel: MissionThreatLevel;
  status: MissionStatus;
  recommendedLevel: string;
  estimatedSessions: string;
  location: string;
  questGiver: { name: string; title: string };
  briefing: string[];
  objectives: MissionObjective[];
  threats: MissionThreat[];
  rewards: MissionReward;
  dmNotes: string;
  datePosted: string;
  sourceBook?: string;
}

/** Shape of the exported data.json produced by the DM tool. */
export interface ExportData {
  exportedAt: string;
  pins: GlobePin[];
}
