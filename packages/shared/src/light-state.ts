import { z } from 'zod';

import { MAX_KELVIN, MIN_KELVIN } from './color.js';

/** Highest built-in dynamic mode index across all supported protocols. */
export const MAX_EFFECT_INDEX = 8;

export const powerStateSchema = z.enum(['on', 'off']);
export type PowerState = z.infer<typeof powerStateSchema>;

export const colorModeSchema = z.enum(['color', 'white', 'off']);
export type ColorMode = z.infer<typeof colorModeSchema>;

export const brightnessSchema = z.number().int().min(0).max(100);
export const hueSchema = z.number().int().min(0).max(359);
export const saturationSchema = z.number().int().min(0).max(100);
export const kelvinSchema = z.number().int().min(MIN_KELVIN).max(MAX_KELVIN);
export const effectSchema = z.number().int().min(0).max(MAX_EFFECT_INDEX);

/**
 * The state we believe a light is in.
 *
 * MiLight radio is one-way: bulbs never report back. Everything here is therefore a
 * *shadow* state derived from the commands we (or a physical remote, when the hub is
 * sniffing) have sent. `reachable` describes the hub, not the bulb.
 */
export const lightStateSchema = z
  .object({
    power: powerStateSchema,
    brightness: brightnessSchema,
    colorMode: colorModeSchema,
    hue: hueSchema,
    saturation: saturationSchema,
    colorTemperature: kelvinSchema,
    effect: effectSchema.nullable(),
    nightMode: z.boolean(),
    /** False when the hub could not be reached the last time we tried. */
    reachable: z.boolean(),
    /** ISO 8601 timestamp of the last state change. */
    updatedAt: z.string(),
  })
  .strict();

export type LightState = z.infer<typeof lightStateSchema>;

export const DEFAULT_LIGHT_STATE: Omit<LightState, 'updatedAt'> = Object.freeze({
  power: 'off',
  brightness: 100,
  colorMode: 'white',
  hue: 0,
  saturation: 0,
  colorTemperature: 4000,
  effect: null,
  nightMode: false,
  reachable: true,
});

export function createDefaultLightState(now: Date = new Date()): LightState {
  return { ...DEFAULT_LIGHT_STATE, updatedAt: now.toISOString() };
}

/**
 * A command to send to a light or group. Every field is optional; the fields that are
 * present are applied in a deterministic order (see `applyCommand` in the server), so
 * `{ power: 'on', brightness: 40, hue: 30 }` reliably means "on, then dim, then colour".
 */
export const lightCommandSchema = z
  .object({
    power: z.enum(['on', 'off', 'toggle']).optional(),
    brightness: brightnessSchema.optional(),
    /** Relative brightness step, for protocols that cannot set an absolute level. */
    brightnessStep: z.number().int().min(-100).max(100).optional(),
    hue: hueSchema.optional(),
    saturation: saturationSchema.optional(),
    /** Convenience alternative to hue/saturation, e.g. "#ff8800". */
    hex: z
      .string()
      .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a 3 or 6 digit hex colour')
      .optional(),
    colorTemperature: kelvinSchema.optional(),
    /** Switch to plain white, dropping any colour. */
    whiteMode: z.literal(true).optional(),
    nightMode: z.literal(true).optional(),
    effect: z.union([effectSchema, z.literal('next')]).optional(),
    effectSpeed: z.enum(['up', 'down']).optional(),
    /** Fade duration in milliseconds, passed to the hub's transition engine. */
    transitionMs: z.number().int().min(0).max(600_000).optional(),
  })
  .strict()
  .refine((cmd) => Object.keys(cmd).length > 0, { message: 'Command must contain at least one field' });

export type LightCommand = z.infer<typeof lightCommandSchema>;
