import { MilightHubUnreachableError } from '@milight-studio/milight-client';
import type { HubAddress } from '@milight-studio/milight-client';
import { apiErrorSchema, groupSchema, lightWithStateSchema } from '@milight-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildTestApp, type TestApp } from '../helpers/app.js';
import { MISSING_ID } from '../helpers/support.js';

const groupListSchema = z.object({ groups: z.array(groupSchema) }).strict();
const memberListSchema = z.object({ lights: z.array(lightWithStateSchema) }).strict();
const commandResultSchema = z
  .object({
    group: groupSchema,
    lights: z.array(lightWithStateSchema),
    failed: z.array(z.object({ lightId: z.string(), code: z.string(), message: z.string() }).strict()),
  })
  .strict();

let ctx: TestApp;

async function addLight(deviceId: string, patch: Record<string, unknown> = {}): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/lights',
    payload: { name: `Light ${deviceId}`, deviceId, remoteType: 'rgb_cct', groupId: 1, ...patch },
  });
  expect(response.statusCode).toBe(201);
  return lightWithStateSchema.parse(response.json()).id;
}

async function addGroup(payload: Record<string, unknown>): Promise<z.infer<typeof groupSchema>> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/groups', payload });
  expect(response.statusCode).toBe(201);
  return groupSchema.parse(response.json());
}

beforeEach(async () => {
  ctx = await buildTestApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('GET /api/v1/groups', () => {
  it('answers an empty list before anything exists', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/groups' });
    expect(response.statusCode).toBe(200);
    expect(groupListSchema.parse(response.json())).toEqual({ groups: [] });
  });

  it('answers every group', async () => {
    await addGroup({ name: 'Woonkamer' });
    await addGroup({ name: 'Zolder' });

    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/groups' });
    expect(groupListSchema.parse(response.json()).groups.map((group) => group.name)).toEqual([
      'Woonkamer',
      'Zolder',
    ]);
  });
});

describe('POST /api/v1/groups', () => {
  it('creates a group with defaults applied', async () => {
    const group = await addGroup({ name: '  Woonkamer ' });
    expect(group).toMatchObject({ name: 'Woonkamer', room: null, lightIds: [], exposeToVoice: true });
  });

  it('de-duplicates the member list', async () => {
    const light = await addLight('0x0001');
    const group = await addGroup({ name: 'Woonkamer', lightIds: [light, light] });
    expect(group.lightIds).toEqual([light]);
  });

  it('answers 409 for a duplicate name, whatever the casing', async () => {
    await addGroup({ name: 'Woonkamer' });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      payload: { name: 'woonkamer' },
    });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('conflict');
  });

  it('answers 400 for unknown member ids', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      payload: { name: 'Woonkamer', lightIds: [MISSING_ID] },
    });

    expect(response.statusCode).toBe(400);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details?.[0]?.path).toBe('lightIds');
  });
});

describe('GET /api/v1/groups/:id and /lights', () => {
  it('answers a single group', async () => {
    const group = await addGroup({ name: 'Woonkamer' });
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/groups/${group.id}` });

    expect(response.statusCode).toBe(200);
    expect(groupSchema.parse(response.json())).toEqual(group);
  });

  it('answers the member lights with their state', async () => {
    const a = await addLight('0x0001');
    const b = await addLight('0x0002');
    const group = await addGroup({ name: 'Woonkamer', lightIds: [b, a] });

    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/groups/${group.id}/lights` });

    expect(response.statusCode).toBe(200);
    expect(memberListSchema.parse(response.json()).lights.map((light) => light.id)).toEqual([b, a]);
  });

  it.each(['', '/lights'])('answers 404 for an unknown group%s', async (suffix) => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/groups/${MISSING_ID}${suffix}` });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });
});

describe('PATCH /api/v1/groups/:id', () => {
  it('renames a group and replaces its members', async () => {
    const light = await addLight('0x0001');
    const group = await addGroup({ name: 'Oud' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/groups/${group.id}`,
      payload: { name: 'Nieuw', lightIds: [light] },
    });

    expect(response.statusCode).toBe(200);
    expect(groupSchema.parse(response.json())).toMatchObject({ name: 'Nieuw', lightIds: [light] });
  });

  it('answers 409 for a name another group already uses', async () => {
    await addGroup({ name: 'Bezet' });
    const group = await addGroup({ name: 'Vrij' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/groups/${group.id}`,
      payload: { name: 'Bezet' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('answers 404 for an unknown group', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/groups/${MISSING_ID}`,
      payload: { name: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/groups/:id', () => {
  it('answers 204 and leaves the member lights alone', async () => {
    const light = await addLight('0x0001');
    const group = await addGroup({ name: 'Woonkamer', lightIds: [light] });

    const response = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/groups/${group.id}` });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const lights = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });
    expect(lights.json().lights).toHaveLength(1);
  });

  it('answers 404 for an unknown group', async () => {
    const response = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/groups/${MISSING_ID}` });
    expect(response.statusCode).toBe(404);
  });
});

describe('PUT /api/v1/groups/:id/state', () => {
  it('fans the command out to every member', async () => {
    const a = await addLight('0x0001');
    const b = await addLight('0x0002');
    const group = await addGroup({ name: 'Woonkamer', lightIds: [a, b] });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${group.id}/state`,
      payload: { power: 'on', brightness: 30 },
    });

    expect(response.statusCode).toBe(200);
    const parsed = commandResultSchema.parse(response.json());
    expect(parsed.lights.map((light) => light.id)).toEqual([a, b]);
    expect(parsed.failed).toEqual([]);
    expect(ctx.fakeHub?.commands.map((call) => call.address.deviceId)).toEqual(['0x0001', '0x0002']);
  });

  it('reports a partial failure with a 200 and a populated failed list', async () => {
    const good = await addLight('0x0001');
    const bad = await addLight('0x0002');
    const group = await addGroup({ name: 'Woonkamer', lightIds: [good, bad] });

    ctx.fakeHub!.failWith = new MilightHubUnreachableError('down');
    ctx.fakeHub!.failWhen = (address?: HubAddress) => address?.deviceId === '0x0002';

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${group.id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(200);
    const parsed = commandResultSchema.parse(response.json());
    expect(parsed.lights.map((light) => light.id)).toEqual([good]);
    expect(parsed.failed).toEqual([{ lightId: bad, code: 'hub_unreachable', message: expect.any(String) }]);
  });

  it('answers 503 when no member could be reached at all', async () => {
    const light = await addLight('0x0001');
    const group = await addGroup({ name: 'Woonkamer', lightIds: [light] });
    ctx.fakeHub!.failWith = new MilightHubUnreachableError('down');

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${group.id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('hub_unreachable');
  });

  it('answers 400 for a group with no members', async () => {
    const group = await addGroup({ name: 'Leeg' });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${group.id}/state`,
      payload: { power: 'on' },
    });

    expect(response.statusCode).toBe(400);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details?.[0]?.path).toBe('lightIds');
  });

  it('answers 404 for an unknown group', async () => {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${MISSING_ID}/state`,
      payload: { power: 'on' },
    });
    expect(response.statusCode).toBe(404);
  });
});
