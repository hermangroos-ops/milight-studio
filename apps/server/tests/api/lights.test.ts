import { MilightHubResponseError, MilightHubUnreachableError } from '@milight-studio/milight-client';
import { apiErrorSchema, lightWithStateSchema } from '@milight-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildTestApp, type TestApp } from '../helpers/app.js';
import { MISSING_ID } from '../helpers/support.js';

const listSchema = z.object({ lights: z.array(lightWithStateSchema) }).strict();

let ctx: TestApp;

const create = async (patch: Record<string, unknown> = {}): Promise<z.infer<typeof lightWithStateSchema>> => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/lights',
    payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1, ...patch },
  });
  expect(response.statusCode).toBe(201);
  return lightWithStateSchema.parse(response.json());
};

beforeEach(async () => {
  ctx = await buildTestApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('GET /api/v1/lights', () => {
  it('answers an empty list before anything exists', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });
    expect(response.statusCode).toBe(200);
    expect(listSchema.parse(response.json())).toEqual({ lights: [] });
  });

  it('answers every light with its state, matching the shared schema', async () => {
    await create({ name: 'Bureau', deviceId: '0x0001' });
    await create({ name: 'Bank', deviceId: '0x0002' });

    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });
    const parsed = listSchema.parse(response.json());
    expect(parsed.lights.map((light) => light.name)).toEqual(['Bureau', 'Bank']);
  });
});

describe('POST /api/v1/lights', () => {
  it('creates a light and answers 201 with the created resource', async () => {
    const light = await create({ name: '  Bureau  ', deviceId: '0x1', room: 'Studeerkamer' });

    expect(light).toMatchObject({
      name: 'Bureau',
      room: 'Studeerkamer',
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 1,
      exposeToVoice: true,
    });
    expect(light.state.power).toBe('off');
  });

  it('accepts a null room', async () => {
    expect((await create({ room: null })).room).toBeNull();
  });

  it('answers 409 for a duplicate radio address', async () => {
    await create({ name: 'Eerste', deviceId: '0x0007', groupId: 3 });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Tweede', deviceId: '0x7', remoteType: 'rgb_cct', groupId: 3 },
    });

    expect(response.statusCode).toBe(409);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('conflict');
    expect(parsed.error.message).toContain('Eerste');
  });

  it('answers 400 for a group the remote type cannot address', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Strip', deviceId: '0x0001', remoteType: 'rgb', groupId: 3 },
    });

    expect(response.statusCode).toBe(400);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details?.[0]?.path).toBe('groupId');
  });
});

describe('GET /api/v1/lights/:id', () => {
  it('answers a single light', async () => {
    const created = await create();
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/lights/${created.id}` });

    expect(response.statusCode).toBe(200);
    expect(lightWithStateSchema.parse(response.json())).toEqual(created);
  });

  it('answers 404 in the error envelope for an unknown id', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/lights/${MISSING_ID}` });

    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });
});

describe('PATCH /api/v1/lights/:id', () => {
  it('renames a light', async () => {
    const created = await create({ name: 'Oud' });
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/lights/${created.id}`,
      payload: { name: 'Nieuw' },
    });

    expect(response.statusCode).toBe(200);
    expect(lightWithStateSchema.parse(response.json()).name).toBe('Nieuw');
  });

  it('moves a light to a new radio address', async () => {
    const created = await create();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/lights/${created.id}`,
      payload: { deviceId: '0x00ab', remoteType: 'fut089', groupId: 7 },
    });

    expect(lightWithStateSchema.parse(response.json())).toMatchObject({
      deviceId: '0x00ab',
      remoteType: 'fut089',
      groupId: 7,
    });
  });

  it('answers 409 when the new address is taken', async () => {
    await create({ name: 'Bezet', deviceId: '0x0001', groupId: 1 });
    const other = await create({ name: 'Vrij', deviceId: '0x0002', groupId: 2 });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/lights/${other.id}`,
      payload: { deviceId: '0x0001', groupId: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('conflict');
  });

  it('answers 404 for an unknown light', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/lights/${MISSING_ID}`,
      payload: { name: 'Nieuw' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/lights/:id', () => {
  it('answers 204 with an empty body and removes the light', async () => {
    const created = await create();
    const response = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/lights/${created.id}` });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });
    expect(listSchema.parse(list.json()).lights).toEqual([]);
  });

  it('answers 404 for an unknown light', async () => {
    const response = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/lights/${MISSING_ID}` });
    expect(response.statusCode).toBe(404);
  });
});

describe('PUT /api/v1/lights/:id/state', () => {
  it('applies a command and answers the new state', async () => {
    const created = await create({ deviceId: '0x000a', groupId: 2 });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${created.id}/state`,
      payload: { power: 'on', brightness: 40 },
    });

    expect(response.statusCode).toBe(200);
    const parsed = lightWithStateSchema.parse(response.json());
    expect(parsed.state).toMatchObject({ power: 'on', brightness: 40, reachable: true });

    expect(ctx.fakeHub?.commands).toEqual([
      {
        address: { deviceId: '0x000a', remoteType: 'rgb_cct', groupId: 2 },
        body: { status: 'ON', level: 40 },
      },
    ]);
  });

  it('answers 400 for conflicting command fields', async () => {
    const created = await create();
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${created.id}/state`,
      payload: { hue: 30, colorTemperature: 3000 },
    });

    expect(response.statusCode).toBe(400);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details?.[0]?.path).toBe('colorTemperature');
  });

  it('answers 422 when the protocol cannot do any part of the command', async () => {
    const created = await create({ remoteType: 'cct', groupId: 1 });
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${created.id}/state`,
      payload: { hue: 200 },
    });

    expect(response.statusCode).toBe(422);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('unsupported_capability');
    expect(parsed.error.details?.[0]?.path).toBe('color');
  });

  it('answers 503 when the hub cannot be reached', async () => {
    const created = await create();
    ctx.fakeHub!.failWith = new MilightHubUnreachableError('no route to host');

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${created.id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('hub_unreachable');
  });

  it('answers 502 when the hub rejects the request', async () => {
    const created = await create();
    ctx.fakeHub!.failWith = new MilightHubResponseError('bad gateway', 500, 'boom');

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${created.id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(502);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('hub_error');
  });

  it('answers 404 for an unknown light', async () => {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${MISSING_ID}/state`,
      payload: { power: 'on' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/v1/lights/:id/refresh', () => {
  it('folds the hub state into the shadow state', async () => {
    const created = await create();
    ctx.fakeHub!.state = { state: 'ON', level: 80, bulb_mode: 'color', hue: 100, saturation: 50 };

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/lights/${created.id}/refresh`,
    });

    expect(response.statusCode).toBe(200);
    expect(lightWithStateSchema.parse(response.json()).state).toMatchObject({
      power: 'on',
      brightness: 80,
      colorMode: 'color',
    });
  });

  it('answers 503 when the hub is unreachable', async () => {
    const created = await create();
    ctx.fakeHub!.failWith = new MilightHubUnreachableError('down');

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/lights/${created.id}/refresh`,
    });
    expect(response.statusCode).toBe(503);
  });
});

describe('POST /api/v1/lights/:id/pair and /unpair', () => {
  it.each(['pair', 'unpair'] as const)('answers 204 and sends %s to the hub', async (operation) => {
    const created = await create({ deviceId: '0x00ff', remoteType: 'rgbw', groupId: 3 });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/lights/${created.id}/${operation}`,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(ctx.fakeHub?.calls.at(-1)).toEqual({
      kind: operation,
      address: { deviceId: '0x00ff', remoteType: 'rgbw', groupId: 3 },
    });
  });

  it.each(['pair', 'unpair'] as const)('answers 503 from %s when the hub is down', async (operation) => {
    const created = await create();
    ctx.fakeHub!.failWith = new MilightHubUnreachableError('down');

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/lights/${created.id}/${operation}`,
    });
    expect(response.statusCode).toBe(503);
  });

  it.each(['pair', 'unpair'] as const)('answers 404 from %s for an unknown light', async (operation) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/lights/${MISSING_ID}/${operation}`,
    });
    expect(response.statusCode).toBe(404);
  });
});
