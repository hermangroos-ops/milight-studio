import { apiErrorSchema, healthSchema, lightWithStateSchema } from '@milight-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, clientFor, type TestApp } from '../helpers/app.js';
import { FakeMilightHubServer } from '../helpers/fake-hub-server.js';

const contexts: TestApp[] = [];
const servers: FakeMilightHubServer[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startHub(): Promise<FakeMilightHubServer> {
  const hub = new FakeMilightHubServer();
  servers.push(hub);
  await hub.start();
  return hub;
}

async function buildAgainst(hub: FakeMilightHubServer): Promise<TestApp> {
  const ctx = await buildTestApp({ hub: clientFor(hub.baseUrl, { retries: 0 }) });
  contexts.push(ctx);
  return ctx;
}

async function addLight(ctx: TestApp, deviceId: string): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/lights',
    payload: { name: `Light ${deviceId}`, deviceId, remoteType: 'rgb_cct', groupId: 1 },
  });
  return lightWithStateSchema.parse(response.json()).id;
}

describe('a hub that goes away', () => {
  it('marks the light unreachable and reports the API as degraded', async () => {
    const hub = await startHub();
    const ctx = await buildAgainst(hub);
    const id = await addLight(ctx, '0x0001');

    // Healthy to begin with.
    await ctx.services.hubMonitor.check();
    const healthy = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(healthSchema.parse(healthy.json())).toMatchObject({
      status: 'ok',
      hub: { reachable: true },
    });

    await hub.stop();

    const command = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on' },
    });

    expect(command.statusCode).toBe(503);
    expect(apiErrorSchema.parse(command.json()).error.code).toBe('hub_unreachable');

    const light = await ctx.app.inject({ method: 'GET', url: `/api/v1/lights/${id}` });
    expect(lightWithStateSchema.parse(light.json()).state.reachable).toBe(false);

    await ctx.services.hubMonitor.check();
    const degraded = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(healthSchema.parse(degraded.json())).toMatchObject({
      status: 'degraded',
      hub: { reachable: false, version: null },
    });
  });

  it('pushes a hub.status event when reachability flips', async () => {
    const hub = await startHub();
    const ctx = await buildAgainst(hub);

    await ctx.services.hubMonitor.check();
    expect(ctx.emitted.at(-1)).toMatchObject({ type: 'hub.status', reachable: true });

    await hub.stop();
    await ctx.services.hubMonitor.check();
    expect(ctx.emitted.at(-1)).toMatchObject({ type: 'hub.status', reachable: false });
  });

  it('recovers on its own once the hub comes back', async () => {
    const hub = await startHub();
    const ctx = await buildAgainst(hub);
    const id = await addLight(ctx, '0x0001');

    hub.respondWith(() => ({ status: 503, body: { error: 'busy' } }));
    const failed = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on' },
    });
    expect(failed.statusCode).toBe(502);
    expect(
      lightWithStateSchema.parse((await ctx.app.inject(`/api/v1/lights/${id}`)).json()).state.reachable,
    ).toBe(false);

    hub.reset();
    const recovered = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on' },
    });

    expect(recovered.statusCode).toBe(200);
    expect(lightWithStateSchema.parse(recovered.json()).state).toMatchObject({
      reachable: true,
      power: 'on',
    });
  });

  it('keeps controlling the reachable members of a group when one address fails', async () => {
    const hub = await startHub();
    const ctx = await buildAgainst(hub);
    const good = await addLight(ctx, '0x0001');
    const bad = await addLight(ctx, '0x0002');

    const group = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      payload: { name: 'Woonkamer', lightIds: [good, bad] },
    });
    const groupId = group.json<{ id: string }>().id;

    hub.respondWith((request) =>
      request.path.includes('0x0002')
        ? { status: 500, body: { error: 'radio busy' } }
        : { body: { success: true } },
    );

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupId}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{ lights: { id: string }[]; failed: { lightId: string }[] }>();
    expect(result.lights.map((light) => light.id)).toEqual([good]);
    expect(result.failed.map((failure) => failure.lightId)).toEqual([bad]);
  });

  it('never leaves the API unresponsive while the hub is down', async () => {
    const hub = await startHub();
    const ctx = await buildAgainst(hub);
    await addLight(ctx, '0x0001');
    await hub.stop();

    for (const url of ['/api/v1/lights', '/api/v1/groups', '/api/v1/scenes', '/api/v1/remote-types']) {
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(200);
    }
  });
});
