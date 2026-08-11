import { lightWithStateSchema } from '@milight-studio/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MemoryPersistence, Store } from '../../src/domain/store.js';
import { buildTestApp, clientFor, type TestApp } from '../helpers/app.js';
import { FakeMilightHubServer } from '../helpers/fake-hub-server.js';

const hub = new FakeMilightHubServer();
let ctx: TestApp;

beforeAll(async () => {
  await hub.start();
});

afterAll(async () => {
  await hub.stop();
});

beforeEach(async () => {
  hub.reset();
  ctx = await buildTestApp({ hub: clientFor(hub.baseUrl), persistence: new MemoryPersistence() });
});

afterEach(async () => {
  await ctx.close();
});

describe('everything the API writes survives a restart', () => {
  it('round trips lights, groups, scenes and shadow state through a second Store', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 },
    });
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Bank', deviceId: '0x0002', remoteType: 'cct', groupId: 2, exposeToVoice: false },
    });
    const lightA = lightWithStateSchema.parse(first.json());
    const lightB = lightWithStateSchema.parse(second.json());

    const group = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      payload: { name: 'Woonkamer', lightIds: [lightA.id, lightB.id], room: 'Beneden' },
    });
    const groupId = group.json<{ id: string }>().id;

    const scene = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/scenes',
      payload: {
        name: 'Filmavond',
        steps: [
          { targetType: 'light', targetId: lightA.id, command: { power: 'on', brightness: 15 } },
          { targetType: 'group', targetId: groupId, command: { power: 'off' } },
        ],
      },
    });
    const sceneId = scene.json<{ id: string }>().id;

    // Change some shadow state too, so the persisted document is not just the entities.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${lightA.id}/state`,
      payload: { power: 'on', brightness: 42 },
    });

    await ctx.services.store.flush();

    const restarted = new Store(ctx.persistence, { debounceMs: 0 });
    await restarted.load();

    expect(restarted.data.version).toBe(1);
    expect(restarted.data.lights.map((light) => [light.id, light.name, light.deviceId])).toEqual([
      [lightA.id, 'Bureau', '0x0001'],
      [lightB.id, 'Bank', '0x0002'],
    ]);
    expect(restarted.data.groups).toEqual([
      expect.objectContaining({ id: groupId, name: 'Woonkamer', lightIds: [lightA.id, lightB.id] }),
    ]);
    expect(restarted.data.scenes).toEqual([expect.objectContaining({ id: sceneId, name: 'Filmavond' })]);
    expect(restarted.data.scenes[0]?.steps).toHaveLength(2);
    expect(restarted.data.states[lightA.id]).toMatchObject({ power: 'on', brightness: 42 });
    expect(restarted.data.states[lightB.id]).toMatchObject({ power: 'off' });
  });

  it('serves the restored data from a fresh app over the same persistence', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 },
    });
    await ctx.services.store.flush();

    const restarted = await buildTestApp({
      hub: clientFor(hub.baseUrl),
      persistence: ctx.persistence,
    });
    try {
      const response = await restarted.app.inject({ method: 'GET', url: '/api/v1/lights' });
      const parsed = response.json<{ lights: { name: string }[] }>();
      expect(parsed.lights.map((light) => light.name)).toEqual(['Bureau']);
    } finally {
      await restarted.close();
    }
  });

  it('forgets a deleted light and its state', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 },
    });
    const id = lightWithStateSchema.parse(created.json()).id;

    await ctx.app.inject({ method: 'DELETE', url: `/api/v1/lights/${id}` });
    await ctx.services.store.flush();

    const restarted = new Store(ctx.persistence, { debounceMs: 0 });
    await restarted.load();

    expect(restarted.data.lights).toEqual([]);
    expect(restarted.data.states[id]).toBeUndefined();
  });

  it('coalesces a burst of writes and still persists the final state', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 },
    });
    const id = lightWithStateSchema.parse(created.json()).id;

    for (const brightness of [10, 20, 30, 40, 50]) {
      await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/lights/${id}/state`,
        payload: { brightness },
      });
    }
    await ctx.services.store.flush();

    const restarted = new Store(ctx.persistence, { debounceMs: 0 });
    await restarted.load();
    expect(restarted.data.states[id]).toMatchObject({ brightness: 50, power: 'on' });
  });
});

describe('MemoryPersistence shared between stores', () => {
  it('isolates the two stores from each other until a flush happens', async () => {
    const shared = new MemoryPersistence();
    const writer = new Store(shared, { debounceMs: 60_000 });
    await writer.load();

    writer.mutate((data) => {
      data.groups.push({
        id: '11111111-2222-4333-8444-555555555555',
        name: 'Woonkamer',
        room: null,
        lightIds: [],
        exposeToVoice: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    const reader = new Store(shared, { debounceMs: 0 });
    await reader.load();
    expect(reader.data.groups).toEqual([]);

    await writer.flush();

    const afterFlush = new Store(shared, { debounceMs: 0 });
    await afterFlush.load();
    expect(afterFlush.data.groups).toHaveLength(1);
  });
});
