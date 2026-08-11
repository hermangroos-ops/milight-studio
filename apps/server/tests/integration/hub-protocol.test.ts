import { lightWithStateSchema } from '@milight-studio/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, clientFor, type TestApp } from '../helpers/app.js';
import { FakeMilightHubServer } from '../helpers/fake-hub-server.js';

const hub = new FakeMilightHubServer();
let ctx: TestApp;

async function addLight(patch: Record<string, unknown> = {}): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/lights',
    payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1, ...patch },
  });
  expect(response.statusCode).toBe(201);
  return lightWithStateSchema.parse(response.json()).id;
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

describe('a command travels all the way to the hub', () => {
  it('produces exactly the expected PUT on the wire', async () => {
    const id = await addLight({ deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(200);
    expect(hub.commands).toEqual([{ path: '/gateways/0x0001/rgb_cct/1', body: { status: 'ON' } }]);
    expect(hub.requests[0]?.method).toBe('PUT');
  });

  it('keeps the field order the hub relies on', async () => {
    const id = await addLight();

    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on', brightness: 40, hue: 200, saturation: 60, transitionMs: 1000 },
    });

    expect(Object.keys(hub.commands[0]?.body as Record<string, unknown>)).toEqual([
      'status',
      'level',
      'hue',
      'saturation',
      'transition',
    ]);
  });

  it('addresses each protocol and zone on its own path', async () => {
    const rgb = await addLight({ deviceId: '0x00ab', remoteType: 'fut089', groupId: 7 });
    const cct = await addLight({ deviceId: '0x00cd', remoteType: 'cct', groupId: 2 });

    await ctx.app.inject({ method: 'PUT', url: `/api/v1/lights/${rgb}/state`, payload: { hue: 10 } });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${cct}/state`,
      payload: { colorTemperature: 3000 },
    });

    expect(hub.commands.map((command) => command.path)).toEqual([
      '/gateways/0x00ab/fut089/7',
      '/gateways/0x00cd/cct/2',
    ]);
    expect(hub.commands[1]?.body).toEqual({ color_temp: 333 });
  });

  it('reads the state back from the hub on refresh', async () => {
    const id = await addLight();
    hub.respondWith(() => ({
      body: { state: 'ON', level: 80, bulb_mode: 'color', hue: 120, saturation: 40 },
    }));

    const response = await ctx.app.inject({ method: 'POST', url: `/api/v1/lights/${id}/refresh` });

    expect(response.statusCode).toBe(200);
    expect(lightWithStateSchema.parse(response.json()).state).toMatchObject({
      power: 'on',
      brightness: 80,
      colorMode: 'color',
      hue: 120,
    });
    expect(hub.requests.at(-1)).toMatchObject({ method: 'GET', path: '/gateways/0x0001/rgb_cct/1' });
  });

  it('sends the pairing commands as the hub expects them', async () => {
    const id = await addLight();

    await ctx.app.inject({ method: 'POST', url: `/api/v1/lights/${id}/pair` });
    await ctx.app.inject({ method: 'POST', url: `/api/v1/lights/${id}/unpair` });

    expect(hub.commands).toEqual([
      { path: '/gateways/0x0001/rgb_cct/1', body: { commands: ['pair'] } },
      { path: '/gateways/0x0001/rgb_cct/1', body: { commands: ['unpair'] } },
    ]);
  });
});

describe('the serial queue really serialises', () => {
  it('never lets two requests overlap on the hub, however many are fired at once', async () => {
    const first = await addLight({ deviceId: '0x0001' });
    const second = await addLight({ deviceId: '0x0002' });

    const group = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      payload: { name: 'Woonkamer', lightIds: [first, second] },
    });
    const groupId = group.json<{ id: string }>().id;

    // Every response yields the event loop a few times, so any concurrency would show up.
    hub.responseYields = 3;

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        ctx.app.inject({
          method: 'PUT',
          url: `/api/v1/groups/${groupId}/state`,
          payload: { brightness: index * 10 },
        }),
      ),
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(hub.commands).toHaveLength(20);
    expect(hub.maxInFlight).toBe(1);
  });

  it('preserves the order commands were queued in', async () => {
    const id = await addLight();
    hub.responseYields = 2;

    await Promise.all(
      [10, 20, 30, 40, 50].map((brightness) =>
        ctx.app.inject({
          method: 'PUT',
          url: `/api/v1/lights/${id}/state`,
          payload: { brightness },
        }),
      ),
    );

    expect(hub.commands.map((command) => (command.body as { level: number }).level)).toEqual([
      10, 20, 30, 40, 50,
    ]);
  });
});

describe('retrying a flaky hub', () => {
  it('succeeds after the hub failed twice', async () => {
    const id = await addLight();
    hub.failTimes(2, 500);

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(200);
    expect(hub.requests.filter((request) => request.method === 'PUT')).toHaveLength(3);
    expect(lightWithStateSchema.parse(response.json()).state.power).toBe('on');
  });

  it('gives up once the retries are exhausted and reports 502', async () => {
    const id = await addLight();
    hub.failTimes(99, 503);

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(502);
    expect(hub.requests.filter((request) => request.method === 'PUT')).toHaveLength(3);
  });

  it('does not retry a request the hub rejected outright', async () => {
    const id = await addLight();
    hub.respondWith(() => ({ status: 400, body: { error: 'malformed' } }));

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(502);
    expect(hub.requests.filter((request) => request.method === 'PUT')).toHaveLength(1);
  });

  it('probes reachability through /about', async () => {
    const status = await ctx.services.hubMonitor.check();

    expect(status).toMatchObject({ reachable: true, version: '1.11.0' });
    expect(hub.requests.at(-1)).toMatchObject({ method: 'GET', path: '/about' });
  });
});
