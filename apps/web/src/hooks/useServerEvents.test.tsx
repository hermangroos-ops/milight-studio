import type { LightWithState } from '@milight-studio/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '../api/query-keys.js';
import { createHarness, makeGroup, makeLight, makeQueryClient, makeState } from '../test-utils/index.js';

import { backoffDelay, eventsUrl, patchQueryClient, useServerEvents } from './useServerEvents.js';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
}

afterEach(() => {
  FakeSocket.instances = [];
  vi.unstubAllGlobals();
});

describe('backoffDelay', () => {
  it('doubles up to a ceiling', () => {
    expect(backoffDelay(0)).toBe(500);
    expect(backoffDelay(1)).toBe(1000);
    expect(backoffDelay(3)).toBe(4000);
    expect(backoffDelay(20)).toBe(30_000);
    expect(backoffDelay(-5)).toBe(500);
  });
});

describe('eventsUrl', () => {
  it('picks the socket scheme that matches the page', () => {
    expect(eventsUrl({ protocol: 'https:', host: 'huis.local' })).toBe('wss://huis.local/api/v1/events');
    expect(eventsUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/v1/events',
    );
  });
});

describe('patchQueryClient', () => {
  it('applies a light.state event to the cached list', () => {
    const client = makeQueryClient();
    const light = makeLight({ state: makeState({ power: 'off' }) });
    client.setQueryData(queryKeys.lights, [light]);

    patchQueryClient(
      client,
      JSON.stringify({
        type: 'light.state',
        lightId: light.id,
        state: makeState({ power: 'on', brightness: 42 }),
      }),
    );

    expect(client.getQueryData<LightWithState[]>(queryKeys.lights)?.[0]?.state.brightness).toBe(42);
  });

  it('applies group events', () => {
    const client = makeQueryClient();
    client.setQueryData(queryKeys.groups, []);
    const group = makeGroup({ name: 'Zolder' });

    patchQueryClient(client, JSON.stringify({ type: 'group.created', group }));

    expect(client.getQueryData<(typeof group)[]>(queryKeys.groups)).toHaveLength(1);
  });

  it('invalidates health on a hub status event', () => {
    const client = makeQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    patchQueryClient(
      client,
      JSON.stringify({ type: 'hub.status', reachable: true, version: null, checkedAt: 'now' }),
    );

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.health });
  });

  it('ignores unparseable payloads', () => {
    const client = makeQueryClient();
    client.setQueryData(queryKeys.lights, []);

    patchQueryClient(client, 'garbage');

    expect(client.getQueryData(queryKeys.lights)).toEqual([]);
  });
});

describe('useServerEvents', () => {
  it('opens a socket, reports status and patches the cache from messages', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const { client, wrapper } = createHarness(makeQueryClient());
    const light = makeLight({ state: makeState({ power: 'off' }) });
    client.setQueryData(queryKeys.lights, [light]);

    const { result, unmount } = renderHook(() => useServerEvents(), { wrapper });
    expect(result.current).toBe('connecting');

    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toContain('/api/v1/events');
    act(() => {
      socket.onopen?.();
    });
    await waitFor(() => {
      expect(result.current).toBe('open');
    });

    act(() => {
      socket.onmessage?.({
        data: JSON.stringify({ type: 'light.state', lightId: light.id, state: makeState({ power: 'on' }) }),
      });
    });
    expect(client.getQueryData<LightWithState[]>(queryKeys.lights)?.[0]?.state.power).toBe('on');

    unmount();
    expect(socket.close).toHaveBeenCalled();
  });

  it('reconnects after the socket closes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const { wrapper } = createHarness(makeQueryClient());

    const { unmount } = renderHook(() => useServerEvents(), { wrapper });
    await act(async () => {
      FakeSocket.instances[0]!.onclose?.();
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    unmount();
    vi.useRealTimers();
  });

  it('closes the socket on error so the reconnect loop takes over', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const { wrapper } = createHarness(makeQueryClient());

    const { unmount } = renderHook(() => useServerEvents(), { wrapper });
    act(() => {
      FakeSocket.instances[0]!.onerror?.();
    });

    expect(FakeSocket.instances[0]!.close).toHaveBeenCalled();
    unmount();
  });

  it('schedules a retry when the socket constructor throws', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    vi.stubGlobal(
      'WebSocket',
      vi.fn(() => {
        attempts += 1;
        throw new Error('nope');
      }),
    );
    const { wrapper } = createHarness(makeQueryClient());

    const { result, unmount } = renderHook(() => useServerEvents(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(attempts).toBeGreaterThan(1);
    expect(result.current).toBe('connecting');
    unmount();
    vi.useRealTimers();
  });

  it('does nothing in an environment without WebSocket', () => {
    vi.stubGlobal('WebSocket', undefined);
    const { wrapper } = createHarness(makeQueryClient());

    const { result } = renderHook(() => useServerEvents(), { wrapper });

    expect(result.current).toBe('connecting');
  });
});
