// Shared helper for best-effort POST of JSON payloads to the live-sync
// sidecar. Callers (inventory, aurus, globe) assume the local SQLite
// write has already succeeded — a sidecar failure is logged as a warning
// and swallowed so it never surfaces to the user.

import type { DmToolConfig } from './config.js';

/**
 * Best-effort POST of a JSON payload to a sidecar endpoint.
 * Silent no-op if sidecarUrl/sidecarSecret are not configured.
 * Network and non-2xx errors are logged as warnings and swallowed.
 */
export async function pushToSidecar(cfg: DmToolConfig, path: string, body: unknown, label: string): Promise<void> {
  if (!cfg.sidecarUrl || !cfg.sidecarSecret) return;
  const url = `${cfg.sidecarUrl.replace(/\/+$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.sidecarSecret}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`${label} sidecar push failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn(`${label} sidecar push error:`, (err as Error).message);
  }
}
