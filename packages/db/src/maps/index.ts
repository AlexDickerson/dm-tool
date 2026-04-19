// Read-only wrapper around the map-tagger's SQLite index. Owns its own DB
// handle (map-index.db), separate from pf2e.db. The schema is the contract
// with the Python map-tagger; see MapDb.ts for details.
export { MapDb } from './MapDb.js';
