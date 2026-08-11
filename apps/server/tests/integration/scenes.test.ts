import { lightWithStateSchema, sceneSchema } from '@milight-studio/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, clientFor, type TestApp } from '../helpers/app.js';
import { FakeMilightHubServer } from '../helpers/fake-hub-server.js';

const hub = new FakeMilightHubServer();
let ctx: TestApp;

interface Fixture {
  bureau: string;
  bank: string;
  keuken: string;
  strip: string;
  groupId: string;
  sceneId: string;
}

async function addLight(
  name: string,
  deviceId: string,
  remoteType: string,
  groupId: number,
): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/lights',
    payload: { name, deviceId, remoteType, groupId },
  });
  expect(response.statusCode).toBe(201);
  return lightWithStateSchema.parse(response.json()).id;
}

/** Four lights across three protocols, a group of two of them, and a scene over both. */
async function seed(): Promise<Fixture> {
  const bureau = await addLight('Bureau', '0x0001', 'rgb_cct', 1);
  const bank = await addLight('Bank', '0x0002', 'rgb_cct', 2);
  const keuken = await addLight('Keuken', '0x0003', 'cct', 1);
  const strip = await addLight('Strip', '0x0004', 'fut020', 0);

  const group = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/groups',
    payload: { name: 'Woonkamer', lightIds: [bank, keuken] },
  });
  expect(group.statusCode).toBe(201);
  const groupId = group.json<{ id: string }>().id;

  const scene = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/scenes',
    payload: {
      name: 'Filmavond',
      room: 'Woonkamer',
      steps: [
        { targetType: 'light', targetId: bureau, command: { power: 'on', brightness: 15, hue: 30 } },
        { targetType: 'group', targetId: groupId, command: { power: 'on', brightness: 40 } },
        { targetType: 'light', targetId: strip, command: { power: 'on', hex: '#0000ff' } },
      ],
    },
  });
  expect(scene.statusCode).toBe(201);

  return { bureau, bank, keuken, strip, groupId, sceneId: sceneSchema.parse(scene.json()).id };
}

beforeAll(async () => {
  await hub.start();
});

afterAll(async () => {
  await hub.stop();
});

beforeEach(async () => {
  hub.reset();
  ctx = await buildTestApp({ hub: clientFor(hub.baseUrl) });
});

afterEach(async () => {
  await ctx.close();
});

describe('running a full scene', () => {
  it('touches every light and group, in order, with the right hub bodies', async () => {
    const fixture = await seed();

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scenes/${fixture.sceneId}/activate`,
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{ appliedSteps: number; failed: unknown[] }>();
    expect(result).toMatchObject({ appliedSteps: 3, failed: [] });

    expect(hub.commands).toEqual([
      {
        path: '/gateways/0x0001/rgb_cct/1',
        body: { status: 'ON', level: 15, hue: 30, saturation: 100 },
      },
      { path: '/gateways/0x0002/rgb_cct/2', body: { status: 'ON', level: 40 } },
      // The CCT bulb in the group cannot do colour but can still be dimmed.
      { path: '/gateways/0x0003/cct/1', body: { status: 'ON', level: 40 } },
      // fut020 has no addressable power and no brightness, so it is toggled.
      { path: '/gateways/0x0004/fut020/0', body: { hue: 240, saturation: 100, commands: ['toggle'] } },
    ]);
  });

  it('leaves every touched light in the state the scene asked for', async () => {
    const fixture = await seed();
    await ctx.app.inject({ method: 'POST', url: `/api/v1/scenes/${fixture.sceneId}/activate` });

    const lights = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });
    const byId = new Map(
      lights
        .json<{ lights: { id: string; state: Record<string, unknown> }[] }>()
        .lights.map((light) => [light.id, light.state]),
    );

    expect(byId.get(fixture.bureau)).toMatchObject({
      power: 'on',
      brightness: 15,
      hue: 30,
      colorMode: 'color',
    });
    expect(byId.get(fixture.bank)).toMatchObject({ power: 'on', brightness: 40 });
    expect(byId.get(fixture.keuken)).toMatchObject({ power: 'on', brightness: 40 });
    expect(byId.get(fixture.strip)).toMatchObject({ power: 'on', hue: 240, colorMode: 'color' });
  });

  it('serialises every request the scene generates', async () => {
    const fixture = await seed();
    hub.responseYields = 2;

    await ctx.app.inject({ method: 'POST', url: `/api/v1/scenes/${fixture.sceneId}/activate` });

    expect(hub.maxInFlight).toBe(1);
  });

  it('reports a failing step without aborting the rest of the scene', async () => {
    const fixture = await seed();
    hub.respondWith((request) =>
      request.path.includes('0x0002') ? { status: 500, body: {} } : { body: { success: true } },
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scenes/${fixture.sceneId}/activate`,
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{ appliedSteps: number; failed: unknown[] }>();

    // The group step still counts as applied: the second member succeeded.
    expect(result.appliedSteps).toBe(3);
    expect(result.failed).toEqual([]);

    const group = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/groups/${fixture.groupId}/lights`,
    });
    const members = group.json<{ lights: { id: string; state: { reachable: boolean } }[] }>().lights;
    expect(members.find((light) => light.id === fixture.bank)?.state.reachable).toBe(false);
    expect(members.find((light) => light.id === fixture.keuken)?.state.reachable).toBe(true);
  });

  it('reports a step whose every target failed', async () => {
    const fixture = await seed();
    hub.respondWith((request) =>
      request.path.includes('0x0001') ? { status: 500, body: {} } : { body: { success: true } },
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scenes/${fixture.sceneId}/activate`,
    });

    const result = response.json<{
      appliedSteps: number;
      failed: { targetType: string; targetId: string }[];
    }>();
    expect(result.appliedSteps).toBe(2);
    expect(result.failed).toEqual([
      { targetType: 'light', targetId: fixture.bureau, code: 'hub_error', message: expect.any(String) },
    ]);
  });

  it('announces the activation on the event bus', async () => {
    const fixture = await seed();
    ctx.emitted.length = 0;

    await ctx.app.inject({ method: 'POST', url: `/api/v1/scenes/${fixture.sceneId}/activate` });

    expect(ctx.emitted.at(-1)).toEqual({ type: 'scene.activated', sceneId: fixture.sceneId });
    expect(ctx.emitted.filter((event) => event.type === 'light.state')).toHaveLength(4);
  });

  it('drops a deleted light from the scene and keeps running the rest', async () => {
    const fixture = await seed();
    await ctx.app.inject({ method: 'DELETE', url: `/api/v1/lights/${fixture.bureau}` });

    const scene = await ctx.app.inject({ method: 'GET', url: `/api/v1/scenes/${fixture.sceneId}` });
    expect(sceneSchema.parse(scene.json()).steps).toHaveLength(2);

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scenes/${fixture.sceneId}/activate`,
    });
    expect(response.json<{ appliedSteps: number }>().appliedSteps).toBe(2);
  });
});
