import { MilightHubUnreachableError } from '@milight-studio/milight-client';
import { REMOTE_TYPES, bridgeStatusSchema, healthSchema, type BridgeStatus } from '@milight-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BridgeRegistry } from '../../src/bridges/registry.js';
import type { VoiceBridge } from '../../src/bridges/types.js';
import { buildTestApp, type TestApp } from '../helpers/app.js';

const remoteTypesSchema = z
  .object({
    remoteTypes: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          hint: z.string(),
          maxGroupId: z.number().int(),
          supportsBroadcast: z.boolean(),
          brightnessMode: z.enum(['absolute', 'relative', 'none']),
          capabilities: z.array(z.string()),
          effectCount: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();

const bridgesSchema = z.object({ bridges: z.array(bridgeStatusSchema) }).strict();

const contexts: TestApp[] = [];

async function build(...args: Parameters<typeof buildTestApp>): Promise<TestApp> {
  const ctx = await buildTestApp(...args);
  contexts.push(ctx);
  return ctx;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
});

function stubBridge(name: string, status: BridgeStatus): VoiceBridge {
  return {
    name,
    enabled: status.enabled,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    status: () => status,
  };
}

describe('GET /api/v1/health', () => {
  it('reports degraded before the hub has ever answered', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const parsed = healthSchema.parse(response.json());
    expect(parsed).toMatchObject({
      status: 'degraded',
      hub: { reachable: false, version: null, checkedAt: null },
    });
    expect(parsed.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('reports ok once the hub has answered', async () => {
    const ctx = await build();
    ctx.fakeHub!.aboutPayload = { firmware: '1.11.0' };
    await ctx.services.hubMonitor.check();

    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(healthSchema.parse(response.json())).toMatchObject({
      status: 'ok',
      hub: { reachable: true, version: '1.11.0', checkedAt: ctx.clock.iso() },
    });
  });

  it('flips back to degraded when the hub goes away', async () => {
    const ctx = await build();
    await ctx.services.hubMonitor.check();
    ctx.fakeHub!.failWith = new MilightHubUnreachableError('down');
    await ctx.services.hubMonitor.check();

    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(healthSchema.parse(response.json()).status).toBe('degraded');
  });

  it('reports the hub url the client is configured with', async () => {
    const ctx = await build();
    expect(healthSchema.parse((await ctx.app.inject('/api/v1/health')).json()).hub.url).toBe(
      ctx.services.hub.baseUrl,
    );
  });
});

describe('GET /api/v1/remote-types', () => {
  it('publishes a profile for every supported protocol', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/remote-types' });

    expect(response.statusCode).toBe(200);
    const parsed = remoteTypesSchema.parse(response.json());
    expect(parsed.remoteTypes.map((profile) => profile.id)).toEqual([...REMOTE_TYPES]);
  });

  it('describes what each protocol can do', async () => {
    const ctx = await build();
    const parsed = remoteTypesSchema.parse((await ctx.app.inject('/api/v1/remote-types')).json());
    const rgbCct = parsed.remoteTypes.find((profile) => profile.id === 'rgb_cct');

    expect(rgbCct).toMatchObject({ maxGroupId: 4, brightnessMode: 'absolute', effectCount: 9 });
    expect(rgbCct?.capabilities).toContain('color');
  });
});

describe('GET /api/v1/bridges', () => {
  it('answers an empty list when no bridges are registered', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/bridges' });

    expect(response.statusCode).toBe(200);
    expect(bridgesSchema.parse(response.json())).toEqual({ bridges: [] });
  });

  it('reports the status of every registered bridge', async () => {
    const bridges = new BridgeRegistry([
      stubBridge('hue-emulation', {
        name: 'hue-emulation',
        enabled: true,
        running: true,
        detail: 'Discoverable on 192.168.1.10:80',
      }),
      stubBridge('matter', { name: 'matter', enabled: false, running: false, detail: null }),
    ]);
    const ctx = await build({ bridges });

    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/bridges' });
    expect(bridgesSchema.parse(response.json()).bridges).toEqual([
      {
        name: 'hue-emulation',
        enabled: true,
        running: true,
        detail: 'Discoverable on 192.168.1.10:80',
      },
      { name: 'matter', enabled: false, running: false, detail: null },
    ]);
  });
});
