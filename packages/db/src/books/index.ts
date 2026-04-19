// BookDb class — read/write wrapper over the `books` table.
//
// The books table lives inside the pf2e.db file (alongside globe_pins,
// party_inventory, etc.), so BookDb takes a shared Database connection from
// `getPf2eDb()` rather than opening its own file. Kept separate from the
// pf2e module functions because BookDb is naturally class-shaped (holds
// prepared statements + cover-blob handling) and its consumer surface is
// small and self-contained.
export { BookDb, type ScannedFile } from './BookDb.js';
