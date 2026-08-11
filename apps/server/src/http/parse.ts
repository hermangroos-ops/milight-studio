import type { z } from 'zod';

import { ValidationError } from '../errors.js';

/**
 * Parse a payload with Zod, converting failures into the API's validation error.
 *
 * Fastify's AJV already rejected structurally invalid bodies; this second pass adds the
 * cross-field rules AJV cannot express and hands the handler a fully typed value.
 */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new ValidationError(
    'Request body failed validation',
    result.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
      message: issue.message,
    })),
  );
}
