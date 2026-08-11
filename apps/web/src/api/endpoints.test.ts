import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './endpoints.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((_url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          lights: [],
          groups: [],
          scenes: [],
          bridges: [],
          remoteTypes: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

describe('api endpoints', () => {
  it('maps every read endpoint to the right path and unwraps the envelope', async () => {
    await expect(api.listLights()).resolves.toEqual([]);
    expect(lastCall()[0]).toBe('/api/v1/lights');

    await expect(api.listGroups()).resolves.toEqual([]);
    expect(lastCall()[0]).toBe('/api/v1/groups');

    await expect(api.listScenes()).resolves.toEqual([]);
    expect(lastCall()[0]).toBe('/api/v1/scenes');

    await expect(api.bridges()).resolves.toEqual([]);
    expect(lastCall()[0]).toBe('/api/v1/bridges');

    await expect(api.remoteTypes()).resolves.toEqual([]);
    expect(lastCall()[0]).toBe('/api/v1/remote-types');

    await api.health();
    expect(lastCall()[0]).toBe('/api/v1/health');

    await api.getLight('a');
    expect(lastCall()[0]).toBe('/api/v1/lights/a');

    await api.getGroup('g');
    expect(lastCall()[0]).toBe('/api/v1/groups/g');

    await expect(api.groupLights('g')).resolves.toEqual([]);
    expect(lastCall()[0]).toBe('/api/v1/groups/g/lights');
  });

  it('maps every write endpoint to the right method', async () => {
    await api.createLight({
      name: 'Bank',
      deviceId: '0x1f2a',
      remoteType: 'rgb_cct',
      groupId: 1,
      exposeToVoice: true,
    });
    expect(lastCall()).toEqual(['/api/v1/lights', expect.objectContaining({ method: 'POST' })]);

    await api.updateLight('a', { name: 'Nieuw' });
    expect(lastCall()).toEqual(['/api/v1/lights/a', expect.objectContaining({ method: 'PATCH' })]);

    await api.deleteLight('a');
    expect(lastCall()).toEqual(['/api/v1/lights/a', expect.objectContaining({ method: 'DELETE' })]);

    await api.setLightState('a', { power: 'on' });
    expect(lastCall()).toEqual(['/api/v1/lights/a/state', expect.objectContaining({ method: 'PUT' })]);

    await api.refreshLight('a');
    expect(lastCall()[0]).toBe('/api/v1/lights/a/refresh');

    await api.pairLight('a');
    expect(lastCall()[0]).toBe('/api/v1/lights/a/pair');

    await api.unpairLight('a');
    expect(lastCall()[0]).toBe('/api/v1/lights/a/unpair');

    await api.createGroup({ name: 'Woonkamer', lightIds: [], exposeToVoice: true });
    expect(lastCall()).toEqual(['/api/v1/groups', expect.objectContaining({ method: 'POST' })]);

    await api.updateGroup('g', { name: 'Zolder' });
    expect(lastCall()).toEqual(['/api/v1/groups/g', expect.objectContaining({ method: 'PATCH' })]);

    await api.deleteGroup('g');
    expect(lastCall()).toEqual(['/api/v1/groups/g', expect.objectContaining({ method: 'DELETE' })]);

    await api.setGroupState('g', { power: 'off' });
    expect(lastCall()).toEqual(['/api/v1/groups/g/state', expect.objectContaining({ method: 'PUT' })]);

    await api.createScene({
      name: 'Filmavond',
      steps: [{ targetType: 'light', targetId: 'a', command: { power: 'on' } }],
      exposeToVoice: true,
    });
    expect(lastCall()).toEqual(['/api/v1/scenes', expect.objectContaining({ method: 'POST' })]);

    await api.updateScene('s', { name: 'Ochtend' });
    expect(lastCall()).toEqual(['/api/v1/scenes/s', expect.objectContaining({ method: 'PATCH' })]);

    await api.deleteScene('s');
    expect(lastCall()).toEqual(['/api/v1/scenes/s', expect.objectContaining({ method: 'DELETE' })]);

    await api.activateScene('s');
    expect(lastCall()).toEqual(['/api/v1/scenes/s/activate', expect.objectContaining({ method: 'POST' })]);
  });
});
