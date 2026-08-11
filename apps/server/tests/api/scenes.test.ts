import { MilightHubUnreachableError } from '@milight-studio/milight-client';
import type { HubAddress } from '@milight-studio/milight-client';
import { apiErrorSchema, lightWithStateSchema, sceneSchema } from '@milight-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildTestApp, type TestApp } from '../helpers/app.js';
import { MISSING_ID } from '../helpers/support.js';

const sceneListSchema = z.object({ scenes: z.array(sceneSchema) }).strict();
const activationSchema = z
  .object({
    scene: sceneSchema,
    appliedSteps: z.number().int(),
    failed: z.array(
      z
        .object({
          targetType: z.enum(['light', 'group']),
          targetId: z.string(),
          code: z.string(),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

let ctx: TestApp;

async function addLight(deviceId: string): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/lights',
    payload: { name: `Light ${deviceId}`, deviceId, remoteType: 'rgb_cct', groupId: 1 },
  });
  return lightWithStateSchema.parse(response.json()).id;
}

async function addScene(payload: Record<string, unknown>): Promise<z.infer<typeof sceneSchema>> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/scenes', payload });
  expect(response.statusCode).toBe(201);
  return sceneSchema.parse(response.json());
}

beforeEach(async () => {
  ctx = await buildTestApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('GET /api/v1/scenes', () => {
  it('answers an empty list before anything exists', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/scenes' });
    expect(response.statusCode).toBe(200);
    expect(sceneListSchema.parse(response.json())).toEqual({ scenes: [] });
  });
});

describe('POST /api/v1/scenes', () => {
  it('creates a scene with defaults applied', async () => {
    const light = await addLight('0x0001');
    const scene = await addScene({
      name: '  Filmavond ',
      steps: [{ targetType: 'light', targetId: light, command: { brightness: 20 } }],
    });

    expect(scene).toMatchObject({ name: 'Filmavond', room: null, exposeToVoice: true });
    expect(scene.steps).toHaveLength(1);
  });

  it('answers 400 for a scene without steps', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/scenes',
      payload: { name: 'Leeg', steps: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('validation_failed');
  });

  it('answers 400 for an unknown target', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/scenes',
      payload: {
        name: 'Filmavond',
        steps: [{ targetType: 'light', targetId: MISSING_ID, command: { power: 'on' } }],
      },
    });

    expect(response.statusCode).toBe(400);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.details?.[0]?.path).toBe('steps');
  });

  it('answers 409 for a duplicate name', async () => {
    const light = await addLight('0x0001');
    const steps = [{ targetType: 'light', targetId: light, command: { power: 'on' } }];
    await addScene({ name: 'Filmavond', steps });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/scenes',
      payload: { name: 'filmavond', steps },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('GET /api/v1/scenes/:id', () => {
  it('answers a single scene', async () => {
    const light = await addLight('0x0001');
    const scene = await addScene({
      name: 'Filmavond',
      steps: [{ targetType: 'light', targetId: light, command: { power: 'on' } }],
    });

    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/scenes/${scene.id}` });
    expect(response.statusCode).toBe(200);
    expect(sceneSchema.parse(response.json())).toEqual(scene);
  });

  it('answers 404 for an unknown scene', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/scenes/${MISSING_ID}` });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });
});

describe('PATCH /api/v1/scenes/:id', () => {
  it('renames a scene and replaces its steps', async () => {
    const a = await addLight('0x0001');
    const b = await addLight('0x0002');
    const scene = await addScene({
      name: 'Oud',
      steps: [{ targetType: 'light', targetId: a, command: { power: 'on' } }],
    });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/scenes/${scene.id}`,
      payload: {
        name: 'Nieuw',
        steps: [{ targetType: 'light', targetId: b, command: { power: 'off' } }],
      },
    });

    expect(response.statusCode).toBe(200);
    const parsed = sceneSchema.parse(response.json());
    expect(parsed.name).toBe('Nieuw');
    expect(parsed.steps[0]?.targetId).toBe(b);
  });

  it('answers 404 for an unknown scene', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/scenes/${MISSING_ID}`,
      payload: { name: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/scenes/:id', () => {
  it('answers 204 and removes the scene', async () => {
    const light = await addLight('0x0001');
    const scene = await addScene({
      name: 'Filmavond',
      steps: [{ targetType: 'light', targetId: light, command: { power: 'on' } }],
    });

    const response = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/scenes/${scene.id}` });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/scenes' });
    expect(sceneListSchema.parse(list.json()).scenes).toEqual([]);
  });

  it('answers 404 for an unknown scene', async () => {
    const response = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/scenes/${MISSING_ID}` });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/v1/scenes/:id/activate', () => {
  it('runs every step in order and reports how many were applied', async () => {
    const a = await addLight('0x0001');
    const b = await addLight('0x0002');
    const scene = await addScene({
      name: 'Filmavond',
      steps: [
        { targetType: 'light', targetId: a, command: { power: 'on', brightness: 10 } },
        { targetType: 'light', targetId: b, command: { power: 'off' } },
      ],
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scenes/${scene.id}/activate`,
    });

    expect(response.statusCode).toBe(200);
    const parsed = activationSchema.parse(response.json());
    expect(parsed.appliedSteps).toBe(2);
    expect(parsed.failed).toEqual([]);
    expect(ctx.fakeHub?.commands.map((call) => [call.address.deviceId, call.body])).toEqual([
      ['0x0001', { status: 'ON', level: 10 }],
      ['0x0002', { status: 'OFF' }],
    ]);
  });

  it('reports a failing step without failing the request', async () => {
    const good = await addLight('0x0001');
    const bad = await addLight('0x0002');
    const scene = await addScene({
      name: 'Filmavond',
      steps: [
        { targetType: 'light', targetId: good, command: { power: 'on' } },
        { targetType: 'light', targetId: bad, command: { power: 'on' } },
      ],
    });

    ctx.fakeHub!.failWith = new MilightHubUnreachableError('down');
    ctx.fakeHub!.failWhen = (address?: HubAddress) => address?.deviceId === '0x0002';

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scenes/${scene.id}/activate`,
    });

    expect(response.statusCode).toBe(200);
    const parsed = activationSchema.parse(response.json());
    expect(parsed.appliedSteps).toBe(1);
    expect(parsed.failed).toEqual([
      { targetType: 'light', targetId: bad, code: 'hub_unreachable', message: expect.any(String) },
    ]);
  });

  it('answers 404 for an unknown scene', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scenes/${MISSING_ID}/activate`,
    });
    expect(response.statusCode).toBe(404);
  });
});
