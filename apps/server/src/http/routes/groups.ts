import {
  createGroupSchema,
  groupSchema,
  lightCommandSchema,
  lightWithStateSchema,
  updateGroupSchema,
} from '@milight-studio/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Services } from '../../container.js';
import { parseWith } from '../parse.js';
import { errorResponses, idParamsSchema, toJsonSchema } from '../schema.js';

const groupListSchema = z.object({ groups: z.array(groupSchema) }).strict();

const groupCommandResultSchema = z
  .object({
    group: groupSchema,
    lights: z.array(lightWithStateSchema),
    failed: z.array(z.object({ lightId: z.string(), code: z.string(), message: z.string() }).strict()),
  })
  .strict();

const groupResponse = toJsonSchema(groupSchema, 'output');

export function registerGroupRoutes(app: FastifyInstance, services: Services): void {
  const { groups } = services;

  app.get(
    '/groups',
    {
      schema: {
        summary: 'List every group',
        tags: ['groups'],
        response: { 200: toJsonSchema(groupListSchema, 'output'), ...errorResponses },
      },
    },
    () => ({ groups: groups.list() }),
  );

  app.post(
    '/groups',
    {
      schema: {
        summary: 'Create a group of lights that can be controlled together',
        tags: ['groups'],
        body: toJsonSchema(createGroupSchema),
        response: { 201: groupResponse, ...errorResponses },
      },
    },
    (request, reply) => {
      const input = parseWith(createGroupSchema, request.body);
      return reply.code(201).send(groups.create(input));
    },
  );

  app.get(
    '/groups/:id',
    {
      schema: {
        summary: 'Fetch a single group',
        tags: ['groups'],
        params: idParamsSchema,
        response: { 200: groupResponse, ...errorResponses },
      },
    },
    (request) => groups.get((request.params as { id: string }).id),
  );

  app.get(
    '/groups/:id/lights',
    {
      schema: {
        summary: 'List the member lights of a group with their state',
        tags: ['groups'],
        params: idParamsSchema,
        response: {
          200: toJsonSchema(z.object({ lights: z.array(lightWithStateSchema) }).strict(), 'output'),
          ...errorResponses,
        },
      },
    },
    (request) => ({ lights: groups.members((request.params as { id: string }).id) }),
  );

  app.patch(
    '/groups/:id',
    {
      schema: {
        summary: 'Rename a group or change its members',
        tags: ['groups'],
        params: idParamsSchema,
        body: toJsonSchema(updateGroupSchema),
        response: { 200: groupResponse, ...errorResponses },
      },
    },
    (request) => {
      const input = parseWith(updateGroupSchema, request.body);
      return groups.update((request.params as { id: string }).id, input);
    },
  );

  app.delete(
    '/groups/:id',
    {
      schema: {
        summary: 'Delete a group; member lights are left untouched',
        tags: ['groups'],
        params: idParamsSchema,
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    (request, reply) => {
      groups.remove((request.params as { id: string }).id);
      return reply.code(204).send();
    },
  );

  app.put(
    '/groups/:id/state',
    {
      schema: {
        summary: 'Apply one command to every light in the group',
        description:
          'Members are addressed one after another. Lights that fail are listed in `failed`; ' +
          'the request only fails outright when no member could be reached.',
        tags: ['groups'],
        params: idParamsSchema,
        body: toJsonSchema(lightCommandSchema),
        response: { 200: toJsonSchema(groupCommandResultSchema, 'output'), ...errorResponses },
      },
    },
    async (request) => {
      const command = parseWith(lightCommandSchema, request.body);
      return groups.command((request.params as { id: string }).id, command);
    },
  );
}
