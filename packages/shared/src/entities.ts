import { z } from 'zod';

import { lightCommandSchema, lightStateSchema } from './light-state.js';
import { REMOTE_TYPES } from './remote-types.js';

/** Accepts either casing of the `0x` prefix; `normaliseDeviceId` canonicalises it. */
export const DEVICE_ID_PATTERN = /^0[xX][0-9a-fA-F]{1,4}$/;

export const deviceIdSchema = z
  .string()
  .regex(DEVICE_ID_PATTERN, 'Device id must look like 0x1F2A (1–4 hex digits)');

export const remoteTypeSchema = z.enum(REMOTE_TYPES);

export const idSchema = z.uuid();

export const nameSchema = z.string().trim().min(1).max(64);
export const roomSchema = z.string().trim().min(1).max(64);

/** Normalise `0x1` and `0X0001` to the canonical `0x0001`. */
export function normaliseDeviceId(deviceId: string): string {
  const digits = deviceId.replace(/^0[xX]/, '').toLowerCase();
  return `0x${digits.padStart(4, '0')}`;
}

export function parseDeviceId(deviceId: string): number {
  return Number.parseInt(deviceId.replace(/^0[xX]/, ''), 16);
}

export function formatDeviceId(value: number): string {
  return `0x${(value & 0xffff).toString(16).padStart(4, '0')}`;
}

/**
 * A single addressable light. The (deviceId, remoteType, groupId) triple is the
 * physical address on the 2.4 GHz radio; everything else is bookkeeping.
 */
export const lightSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    room: roomSchema.nullable(),
    deviceId: deviceIdSchema,
    remoteType: remoteTypeSchema,
    groupId: z.number().int().min(0).max(8),
    /** Hidden lights stay controllable through the API but are not exposed to Alexa. */
    exposeToVoice: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type Light = z.infer<typeof lightSchema>;

export const lightWithStateSchema = lightSchema.extend({ state: lightStateSchema });
export type LightWithState = z.infer<typeof lightWithStateSchema>;

/**
 * The writable fields of a light, without defaults.
 *
 * Defaults belong on the *create* schema only: `.partial()` does not strip them, so a
 * PATCH built from a defaulted schema would silently rewrite fields the caller never
 * mentioned (e.g. resetting `exposeToVoice` on a rename).
 */
const lightInputShape = {
  name: nameSchema,
  room: roomSchema.nullish(),
  deviceId: deviceIdSchema,
  remoteType: remoteTypeSchema,
  groupId: z.number().int().min(0).max(8),
  exposeToVoice: z.boolean(),
};

export const createLightSchema = z
  .object({ ...lightInputShape, exposeToVoice: z.boolean().default(true) })
  .strict();

export type CreateLightInput = z.infer<typeof createLightSchema>;

export const updateLightSchema = z.object(lightInputShape).partial().strict();
export type UpdateLightInput = z.infer<typeof updateLightSchema>;

/**
 * A user-defined group of lights. Deliberately *not* the same thing as a MiLight
 * radio zone: a group can mix protocols, rooms and individual bulbs, and commands
 * are fanned out to each member.
 */
export const groupSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    room: roomSchema.nullable(),
    lightIds: z.array(idSchema),
    exposeToVoice: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type Group = z.infer<typeof groupSchema>;

const groupInputShape = {
  name: nameSchema,
  room: roomSchema.nullish(),
  lightIds: z.array(idSchema),
  exposeToVoice: z.boolean(),
};

export const createGroupSchema = z
  .object({
    ...groupInputShape,
    lightIds: z.array(idSchema).default([]),
    exposeToVoice: z.boolean().default(true),
  })
  .strict();

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object(groupInputShape).partial().strict();
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const sceneStepSchema = z
  .object({
    targetType: z.enum(['light', 'group']),
    targetId: idSchema,
    command: lightCommandSchema,
  })
  .strict();

export type SceneStep = z.infer<typeof sceneStepSchema>;

/** A named list of commands, applied together. "Filmavond", "Ochtend", ... */
export const sceneSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    room: roomSchema.nullable(),
    steps: z.array(sceneStepSchema),
    exposeToVoice: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type Scene = z.infer<typeof sceneSchema>;

const sceneInputShape = {
  name: nameSchema,
  room: roomSchema.nullish(),
  steps: z.array(sceneStepSchema).min(1),
  exposeToVoice: z.boolean(),
};

export const createSceneSchema = z
  .object({ ...sceneInputShape, exposeToVoice: z.boolean().default(true) })
  .strict();

export type CreateSceneInput = z.infer<typeof createSceneSchema>;

export const updateSceneSchema = z.object(sceneInputShape).partial().strict();
export type UpdateSceneInput = z.infer<typeof updateSceneSchema>;
