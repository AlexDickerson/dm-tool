// Thin WebSocket client with auto-reconnect. Used by Inventory and
// Leaderboard routes to subscribe to the sidecar's streams. Exposed as a
// hook so components get the latest snapshot + a connection status flag.

import { useEffect, useRef, useState } from 'react';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface LiveState<T> {
  data: T | null;
  status: ConnectionStatus;
  /** Last time we received data (for "stale" indicators). */
  lastUpdated: number | null;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

/** Subscribe to a sidecar WebSocket stream with reconnect-on-close.
 *
 *  - `path` is the stream path (e.g. "/api/inventory/stream").
 *  - The base URL is same-origin; nginx proxies /api/ to the sidecar. For
 *    local dev against a sidecar on a different origin, the caller can
 *    pass an absolute ws(s):// URL via `overrideUrl`.
 */
export function useLiveStream<T>(path: string, overrideUrl?: string): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({
    data: null,
    status: 'connecting',
    lastUpdated: null,
  });
  const backoffRef = useRef(INITIAL_BACKOFF_MS);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      setState((s) => ({ ...s, status: 'connecting' }));

      const url = overrideUrl ?? buildWsUrl(path);
      socket = new WebSocket(url);

      socket.onopen = () => {
        backoffRef.current = INITIAL_BACKOFF_MS;
        setState((s) => ({ ...s, status: 'connected' }));
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as T;
          setState({ data: parsed, status: 'connected', lastUpdated: Date.now() });
        } catch (err) {
          console.error('live-stream: failed to parse message', err);
        }
      };

      socket.onclose = () => {
        if (closed) return;
        setState((s) => ({ ...s, status: 'disconnected' }));
        reconnectTimer = setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      };

      socket.onerror = () => {
        // Let onclose handle reconnect; close will fire right after.
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [path, overrideUrl]);

  return state;
}

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}
