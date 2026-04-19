// Module-function data layer over pf2e.db — the app-owned SQLite file that
// stores settings, globe pins, party inventory, encounters, Aurus teams, hook
// overrides, pack mappings, plus the read-only PF2e compendium tables (monsters,
// items, NPCs) that pf2e-db consumed from a pre-built database.
//
// Module-level singleton: call openPf2eDb(path) once at startup, then use the
// exported functions directly. Not class-based because 41 call sites across
// Electron IPC handlers would rather say `getSetting('x')` than
// `pf2eDb.settings.get('x')`.

export { openPf2eDb, isPf2eDbOpen, closePf2eDb, getPf2eDb } from './connection.js';
export { getSetting, setSetting, deleteSetting, getAllSettings, replaceSettings } from './settings.js';
export { getAdditionalHooksFor, upsertAdditionalHooks } from './hooks.js';
export {
  listPackMappings,
  hasPackMappings,
  replacePackMappings,
  upsertPackMapping,
  renamePackMappings,
} from './packs.js';
export { listGlobePins, upsertGlobePin, deleteGlobePin, setMissionMarkdown, getMissionMarkdown } from './globe.js';
export { listInventory, upsertInventory, deleteInventory } from './inventory.js';
export { listEncounters, upsertEncounter, deleteEncounter } from './combat.js';
export { listAurusTeams, upsertAurusTeam, deleteAurusTeam } from './aurus.js';
export {
  searchMonsters,
  listMonsters,
  getMonsterFacets,
  getMonsterRowByName,
  getMonsterByName,
  getMonsterPreview,
  searchItems,
  searchItemsBrowser,
  getItemBrowserDetail,
  getItemFacets,
  buildLootShortlist,
} from './compendium.js';
