import { z } from 'zod';

import { apiErrorSchema } from '@milight-studio/shared';

export type JsonSchema = Record<string, unknown>;

/**
 * Convert a Zod schema into a JSON Schema that Fastify (AJV draft-07) accepts.
 *
 * This keeps validation and the published OpenAPI document derived from one source.
 * Zod refinements cannot be expressed in JSON Schema, so anything cross-field is
 * re-checked in the service layer — see `validateCommand`.
 */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): JsonSchema {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-7',
    io,
    reused: 'inline',
    unrepresentable: 'any',
  }) as JsonSchema;
  // Fastify injects its own $schema handling; leaving ours in makes AJV noisy.
  delete generated.$schema;
  return generated;
}

const errorSchema = toJsonSchema(apiErrorSchema, 'output');

/** Standard error responses attached to every route so the OpenAPI doc is honest. */
export const errorResponses = {
  400: errorSchema,
  401: errorSchema,
  404: errorSchema,
  409: errorSchema,
  422: errorSchema,
  500: errorSchema,
  502: errorSchema,
  503: errorSchema,
} as const;

export const idParamsSchema = toJsonSchema(z.object({ id: z.uuid() }).strict());
