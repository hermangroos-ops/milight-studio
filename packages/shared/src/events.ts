import { z } from 'zod';

import { groupSchema, lightSchema, sceneSchema } from './entities.js';
import { lightStateSchema } from './light-state.js';

/**
 * Messages pushed over the `/api/v1/events` WebSocket so every open browser tab and
 * every voice bridge sees the same state without polling.
 */
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), serverTime: z.string(), version: z.string() }).strict(),
  z.object({ type: z.literal('light.created'), light: lightSchema }).strict(),
  z.object({ type: z.literal('light.updated'), light: lightSchema }).strict(),
  z.object({ type: z.literal('light.deleted'), lightId: z.string() }).strict(),
  z.object({ type: z.literal('light.state'), lightId: z.string(), state: lightStateSchema }).strict(),
  z.object({ type: z.literal('group.created'), group: groupSchema }).strict(),
  z.object({ type: z.literal('group.updated'), group: groupSchema }).strict(),
  z.object({ type: z.literal('group.deleted'), groupId: z.string() }).strict(),
  z.object({ type: z.literal('scene.created'), scene: sceneSchema }).strict(),
  z.object({ type: z.literal('scene.updated'), scene: sceneSchema }).strict(),
  z.object({ type: z.literal('scene.deleted'), sceneId: z.string() }).strict(),
  z.object({ type: z.literal('scene.activated'), sceneId: z.string() }).strict(),
  z
    .object({
      type: z.literal('hub.status'),
      reachable: z.boolean(),
      version: z.string().nullable(),
      checkedAt: z.string(),
    })
    .strict(),
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent['type'];
