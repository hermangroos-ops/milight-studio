import { z } from 'zod';

/**
 * Every non-2xx response uses this envelope so the UI can render errors uniformly.
 * Modelled loosely on RFC 9457 (problem details) without dragging in the media type.
 */
export const apiErrorSchema = z
  .object({
    error: z
      .object({
        /** Stable machine-readable code, e.g. `light_not_found`. */
        code: z.string(),
        message: z.string(),
        /** Field-level validation problems, when applicable. */
        details: z.array(z.object({ path: z.string(), message: z.string() }).strict()).optional(),
      })
      .strict(),
  })
  .strict();

export type ApiError = z.infer<typeof apiErrorSchema>;

export const API_ERROR_CODES = [
  'validation_failed',
  'not_found',
  'conflict',
  'unsupported_capability',
  'hub_unreachable',
  'hub_error',
  'internal_error',
  'unauthorised',
  'rate_limited',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const healthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    uptimeSeconds: z.number(),
    hub: z
      .object({
        reachable: z.boolean(),
        url: z.string(),
        version: z.string().nullable(),
        checkedAt: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type Health = z.infer<typeof healthSchema>;

export const bridgeStatusSchema = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    running: z.boolean(),
    detail: z.string().nullable(),
  })
  .strict();

export type BridgeStatus = z.infer<typeof bridgeStatusSchema>;

export const API_BASE_PATH = '/api/v1';
