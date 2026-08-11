import type { LightWithState } from '@milight-studio/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHarness, makeGroup, makeLight, makeQueryClient, makeState } from '../test-utils/index.js';

import { ApiError } from './client.js';
import { api } from './endpoints.js';
import {
  describeError,
  useActivateScene,
  useCreateLight,
  useDeleteLight,
  useGroupCommand,
  useLightCommand,
  usePairLight,
} from './mutations.js';
import { queryKeys } from './query-keys.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('describeError', () => {
  it('prefers the API message, then a plain error, then a fallback', () => {
    expect(describeError(new ApiError(404, 'not_found', 'Niet gevonden'))).toBe('Niet gevonden');
    expect(describeError(new Error('boem'))).toBe('boem');
    expect(describeError('iets')).toBe('Er ging iets mis.');
  });
});

describe('useLightCommand', () => {
  it('updates the cache optimistically and keeps the server answer', async () => {
    const light = makeLight({ state: makeState({ power: 'off', brightness: 10 }) });
    const server: LightWithState = { ...light, state: makeState({ power: 'on', brightness: 55 }) };
    const { client, wrapper } = createHarness(makeQueryClient());
    client.setQueryData(queryKeys.lights, [light]);

    let resolve: (value: LightWithState) => void = () => undefined;
    vi.spyOn(api, 'setLightState').mockReturnValue(
      new Promise<LightWithState>((done) => {
        resolve = done;
      }),
    );

    const { result } = renderHook(() => useLightCommand(), { wrapper });
    act(() => {
      result.current.mutate({ lightId: light.id, command: { power: 'on', brightness: 55 } });
    });

    await waitFor(() => {
      expect(client.getQueryData<LightWithState[]>(queryKeys.lights)?.[0]?.state.power).toBe('on');
    });
    expect(client.getQueryData<LightWithState[]>(queryKeys.lights)?.[0]?.state.brightness).toBe(55);

    act(() => {
      resolve(server);
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryData<LightWithState[]>(queryKeys.lights)?.[0]).toEqual(server);
  });

  it('rolls the cache back when the command fails', async () => {
    const light = makeLight({ state: makeState({ power: 'off' }) });
    const { client, wrapper } = createHarness(makeQueryClient());
    client.setQueryData(queryKeys.lights, [light]);
    vi.spyOn(api, 'setLightState').mockRejectedValue(new ApiError(502, 'hub_error', 'Hub weg'));

    const { result } = renderHook(() => useLightCommand(), { wrapper });
    act(() => {
      result.current.mutate({ lightId: light.id, command: { power: 'on' } });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(client.getQueryData<LightWithState[]>(queryKeys.lights)).toEqual([light]);
  });

  it('does nothing to an empty cache', async () => {
    const light = makeLight();
    const { client, wrapper } = createHarness(makeQueryClient());
    vi.spyOn(api, 'setLightState').mockResolvedValue(light);

    const { result } = renderHook(() => useLightCommand(), { wrapper });
    act(() => {
      result.current.mutate({ lightId: light.id, command: { power: 'on' } });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryData(queryKeys.lights)).toBeUndefined();
  });
});

describe('useGroupCommand', () => {
  it('patches every member optimistically and merges the response', async () => {
    const first = makeLight({ state: makeState({ power: 'off' }) });
    const second = makeLight({ state: makeState({ power: 'off' }) });
    const { client, wrapper } = createHarness(makeQueryClient());
    client.setQueryData(queryKeys.lights, [first, second]);

    const updated = { ...first, state: makeState({ power: 'on', brightness: 90 }) };
    vi.spyOn(api, 'setGroupState').mockResolvedValue({
      group: makeGroup({ lightIds: [] }),
      lights: [updated],
      failed: [{ lightId: second.id, code: 'unsupported_capability', message: 'Kan dit niet' }],
    });

    const { result } = renderHook(() => useGroupCommand(), { wrapper });
    act(() => {
      result.current.mutate({
        groupId: 'group-1',
        lightIds: [first.id, second.id],
        command: { power: 'on' },
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const lights = client.getQueryData<LightWithState[]>(queryKeys.lights);
    expect(lights?.[0]?.state.brightness).toBe(90);
    expect(lights?.[1]?.state.power).toBe('on');
  });

  it('restores the snapshot when the whole group command fails', async () => {
    const light = makeLight({ state: makeState({ power: 'off' }) });
    const { client, wrapper } = createHarness(makeQueryClient());
    client.setQueryData(queryKeys.lights, [light]);
    vi.spyOn(api, 'setGroupState').mockRejectedValue(new Error('kapot'));

    const { result } = renderHook(() => useGroupCommand(), { wrapper });
    act(() => {
      result.current.mutate({ groupId: 'g', lightIds: [light.id], command: { power: 'on' } });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(client.getQueryData<LightWithState[]>(queryKeys.lights)?.[0]?.state.power).toBe('off');
  });
});

describe('invalidating mutations', () => {
  it('invalidates the light list after a create', async () => {
    const { client, wrapper } = createHarness(makeQueryClient());
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(api, 'createLight').mockResolvedValue(makeLight());

    const { result } = renderHook(() => useCreateLight(), { wrapper });
    act(() => {
      result.current.mutate({
        name: 'Bank',
        deviceId: '0x1f2a',
        remoteType: 'rgb_cct',
        groupId: 1,
        exposeToVoice: true,
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.lights });
  });

  it('surfaces failures as an error state', async () => {
    const { wrapper } = createHarness(makeQueryClient());
    vi.spyOn(api, 'deleteLight').mockRejectedValue(new ApiError(409, 'conflict', 'In gebruik'));

    const { result } = renderHook(() => useDeleteLight(), { wrapper });
    act(() => {
      result.current.mutate('light-1');
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('routes pair and unpair to the right endpoint', async () => {
    const { wrapper } = createHarness(makeQueryClient());
    const pair = vi.spyOn(api, 'pairLight').mockResolvedValue(undefined);
    const unpair = vi.spyOn(api, 'unpairLight').mockResolvedValue(undefined);

    const { result } = renderHook(() => usePairLight(), { wrapper });
    act(() => {
      result.current.mutate({ id: 'light-1', pair: true });
    });
    await waitFor(() => {
      expect(pair).toHaveBeenCalledWith('light-1');
    });

    act(() => {
      result.current.mutate({ id: 'light-1', pair: false });
    });
    await waitFor(() => {
      expect(unpair).toHaveBeenCalledWith('light-1');
    });
  });
});

describe('useActivateScene', () => {
  it('reports the number of applied steps', async () => {
    const { client, wrapper } = createHarness(makeQueryClient());
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(api, 'activateScene').mockResolvedValue({
      scene: { name: 'Filmavond' } as never,
      appliedSteps: 3,
      failed: [{ lightId: 'light-1', code: 'hub_error', message: 'weg' }],
    });

    const { result } = renderHook(() => useActivateScene(), { wrapper });
    act(() => {
      result.current.mutate('scene-1');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.lights });
  });

  it('handles activation errors', async () => {
    const { wrapper } = createHarness(makeQueryClient());
    vi.spyOn(api, 'activateScene').mockRejectedValue(new Error('nee'));

    const { result } = renderHook(() => useActivateScene(), { wrapper });
    act(() => {
      result.current.mutate('scene-1');
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
