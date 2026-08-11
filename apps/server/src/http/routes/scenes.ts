import { createSceneSchema, sceneSchema, updateSceneSchema } from '@milight-studio/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Services } from '../../container.js';
import { parseWith } from '../parse.js';
import { errorResponses, idParamsSchema, toJsonSchema } from '../schema.js';

const sceneListSchema = z.object({ scenes: z.array(sceneSchema) }).strict();

const activationResultSchema = z
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

const sceneResponse = toJsonSchema(sceneSchema, 'output');

export function registerSceneRoutes(app: FastifyInstance, services: Services): void {
  const { scenes } = services;

  app.get(
    '/scenes',
    {
      schema: {
        summary: 'List every scene',
        tags: ['scenes'],
        response: { 200: toJsonSchema(sceneListSchema, 'output'), ...errorResponses },
      },
    },
    () => ({ scenes: scenes.list() }),
  );

  app.post(
    '/scenes',
    {
      schema: {
        summary: 'Create a scene from a list of commands',
        tags: ['scenes'],
        body: toJsonSchema(createSceneSchema),
        response: { 201: sceneResponse, ...errorResponses },
      },
    },
    (request, reply) => {
      const input = parseWith(createSceneSchema, request.body);
      return reply.code(201).send(scenes.create(input));
    },
  );

  app.get(
    '/scenes/:id',
    {
      schema: {
        summary: 'Fetch a single scene',
        tags: ['scenes'],
        params: idParamsSchema,
        response: { 200: sceneResponse, ...errorResponses },
      },
    },
    (request) => scenes.get((request.params as { id: string }).id),
  );

  app.patch(
    '/scenes/:id',
    {
      schema: {
        summary: 'Update a scene',
        tags: ['scenes'],
        params: idParamsSchema,
        body: toJsonSchema(updateSceneSchema),
        response: { 200: sceneResponse, ...errorResponses },
      },
    },
    (request) => {
      const input = parseWith(updateSceneSchema, request.body);
      return scenes.update((request.params as { id: string }).id, input);
    },
  );

  app.delete(
    '/scenes/:id',
    {
      schema: {
        summary: 'Delete a scene',
        tags: ['scenes'],
        params: idParamsSchema,
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    (request, reply) => {
      scenes.remove((request.params as { id: string }).id);
      return reply.code(204).send();
    },
  );

  app.post(
    '/scenes/:id/activate',
    {
      schema: {
        summary: 'Run every step of a scene in order',
        tags: ['scenes'],
        params: idParamsSchema,
        response: { 200: toJsonSchema(activationResultSchema, 'output'), ...errorResponses },
      },
    },
    async (request) => scenes.activate((request.params as { id: string }).id),
  );
}
