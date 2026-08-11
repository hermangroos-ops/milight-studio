import {
  createLightSchema,
  lightCommandSchema,
  lightWithStateSchema,
  updateLightSchema,
} from '@milight-studio/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Services } from '../../container.js';
import { parseWith } from '../parse.js';
import { errorResponses, idParamsSchema, toJsonSchema } from '../schema.js';

const lightListSchema = z.object({ lights: z.array(lightWithStateSchema) }).strict();

const lightResponse = toJsonSchema(lightWithStateSchema, 'output');
const listResponse = toJsonSchema(lightListSchema, 'output');

export function registerLightRoutes(app: FastifyInstance, services: Services): void {
  const { lights } = services;

  app.get(
    '/lights',
    {
      schema: {
        summary: 'List every configured light with its last known state',
        tags: ['lights'],
        response: { 200: listResponse, ...errorResponses },
      },
    },
    () => ({ lights: lights.list() }),
  );

  app.post(
    '/lights',
    {
      schema: {
        summary: 'Add a light by its radio address',
        tags: ['lights'],
        body: toJsonSchema(createLightSchema),
        response: { 201: lightResponse, ...errorResponses },
      },
    },
    (request, reply) => {
      const input = parseWith(createLightSchema, request.body);
      const light = lights.create(input);
      return reply.code(201).send(light);
    },
  );

  app.get(
    '/lights/:id',
    {
      schema: {
        summary: 'Fetch a single light',
        tags: ['lights'],
        params: idParamsSchema,
        response: { 200: lightResponse, ...errorResponses },
      },
    },
    (request) => lights.get((request.params as { id: string }).id),
  );

  app.patch(
    '/lights/:id',
    {
      schema: {
        summary: 'Rename a light or change its radio address',
        tags: ['lights'],
        params: idParamsSchema,
        body: toJsonSchema(updateLightSchema),
        response: { 200: lightResponse, ...errorResponses },
      },
    },
    (request) => {
      const input = parseWith(updateLightSchema, request.body);
      return lights.update((request.params as { id: string }).id, input);
    },
  );

  app.delete(
    '/lights/:id',
    {
      schema: {
        summary: 'Remove a light and detach it from groups and scenes',
        tags: ['lights'],
        params: idParamsSchema,
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    (request, reply) => {
      lights.remove((request.params as { id: string }).id);
      return reply.code(204).send();
    },
  );

  app.put(
    '/lights/:id/state',
    {
      schema: {
        summary: 'Control a light: power, brightness, colour, colour temperature, effects',
        tags: ['lights'],
        params: idParamsSchema,
        body: toJsonSchema(lightCommandSchema),
        response: { 200: lightResponse, ...errorResponses },
      },
    },
    async (request) => {
      const command = parseWith(lightCommandSchema, request.body);
      return lights.command((request.params as { id: string }).id, command);
    },
  );

  app.post(
    '/lights/:id/refresh',
    {
      schema: {
        summary: 'Re-read the state the hub holds for this light',
        tags: ['lights'],
        params: idParamsSchema,
        response: { 200: lightResponse, ...errorResponses },
      },
    },
    async (request) => lights.refresh((request.params as { id: string }).id),
  );

  app.post(
    '/lights/:id/pair',
    {
      schema: {
        summary: 'Send the pairing command; power-cycle the bulb first',
        tags: ['lights'],
        params: idParamsSchema,
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    async (request, reply) => {
      await lights.pair((request.params as { id: string }).id);
      return reply.code(204).send();
    },
  );

  app.post(
    '/lights/:id/unpair',
    {
      schema: {
        summary: 'Unbind the bulb from this address',
        tags: ['lights'],
        params: idParamsSchema,
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    async (request, reply) => {
      await lights.unpair((request.params as { id: string }).id);
      return reply.code(204).send();
    },
  );
}
