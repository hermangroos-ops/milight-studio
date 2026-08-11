import { bridgeStatusSchema, healthSchema, REMOTE_TYPE_PROFILE_LIST } from '@milight-studio/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { BridgeRegistry } from '../../bridges/registry.js';
import type { Services } from '../../container.js';
import { APP_VERSION } from '../../version.js';
import { errorResponses, toJsonSchema } from '../schema.js';

const remoteTypeProfileSchema = z
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
  .strict();

const remoteTypesSchema = z.object({ remoteTypes: z.array(remoteTypeProfileSchema) }).strict();
const bridgesSchema = z.object({ bridges: z.array(bridgeStatusSchema) }).strict();

export function registerSystemRoutes(
  app: FastifyInstance,
  services: Services,
  bridges: BridgeRegistry,
  startedAt: number = Date.now(),
): void {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Liveness and hub reachability',
        tags: ['system'],
        response: { 200: toJsonSchema(healthSchema, 'output'), ...errorResponses },
      },
    },
    () => {
      const status = services.hubMonitor.status;
      return {
        status: status.reachable ? ('ok' as const) : ('degraded' as const),
        version: APP_VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        hub: {
          reachable: status.reachable,
          url: services.hub.baseUrl,
          version: status.version,
          checkedAt: status.checkedAt,
        },
      };
    },
  );

  app.get(
    '/remote-types',
    {
      schema: {
        summary: 'Supported bulb protocols and what each of them can do',
        tags: ['system'],
        response: { 200: toJsonSchema(remoteTypesSchema, 'output'), ...errorResponses },
      },
    },
    () => ({ remoteTypes: REMOTE_TYPE_PROFILE_LIST }),
  );

  app.get(
    '/bridges',
    {
      schema: {
        summary: 'Status of the voice-assistant bridges',
        tags: ['system'],
        response: { 200: toJsonSchema(bridgesSchema, 'output'), ...errorResponses },
      },
    },
    () => ({ bridges: bridges.statuses() }),
  );
}
