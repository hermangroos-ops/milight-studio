import { API_BASE_PATH, type Group, type LightWithState, type Scene } from '@milight-studio/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { queryKeys } from '../api/query-keys.js';
import { applyServerEvent, parseServerEvent, type CacheSnapshot } from '../state/server-event-cache.js';

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

export function backoffDelay(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt));
}

export function eventsUrl(location: { protocol: string; host: string }): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${API_BASE_PATH}/events`;
}

/** Reads the current caches, applies the event, and writes back only what changed. */
export function patchQueryClient(client: QueryClient, raw: unknown): void {
  const event = parseServerEvent(raw);
  if (!event) return;

  const before: CacheSnapshot = {
    lights: client.getQueryData<LightWithState[]>(queryKeys.lights) ?? [],
    groups: client.getQueryData<Group[]>(queryKeys.groups) ?? [],
    scenes: client.getQueryData<Scene[]>(queryKeys.scenes) ?? [],
    hub: null,
    lastSceneActivatedId: null,
  };
  const after = applyServerEvent(before, event);

  if (after.lights !== before.lights) client.setQueryData(queryKeys.lights, after.lights);
  if (after.groups !== before.groups) client.setQueryData(queryKeys.groups, after.groups);
  if (after.scenes !== before.scenes) client.setQueryData(queryKeys.scenes, after.scenes);
  if (after.hub !== null) void client.invalidateQueries({ queryKey: queryKeys.health });
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/**
 * Opens the event WebSocket and keeps the React Query cache in sync.
 * Reconnects with exponential backoff; the socket is closed on unmount.
 */
export function useServerEvents(): ConnectionStatus {
  const client = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof WebSocket === 'undefined') return;

    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = (): void => {
      if (disposed) return;
      setStatus('connecting');
      let socket: WebSocket;
      try {
        socket = new WebSocket(eventsUrl(window.location));
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setStatus('open');
      };
      socket.onmessage = (message: MessageEvent<unknown>) => {
        patchQueryClient(client, message.data);
      };
      socket.onerror = () => {
        socket.close();
      };
      socket.onclose = () => {
        setStatus('closed');
        scheduleReconnect();
      };
    };

    const scheduleReconnect = (): void => {
      if (disposed) return;
      const delay = backoffDelay(attempt);
      attempt += 1;
      timer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      const socket = socketRef.current;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [client]);

  return status;
}
