import { API_BASE_PATH } from '@milight-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../helpers/app.js';

interface OperationObject {
  summary?: string;
  description?: string;
  tags?: string[];
  responses?: Record<string, unknown>;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  tags?: { name: string }[];
  paths: Record<string, Record<string, OperationObject>>;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/** Routes that are deliberately absent from the document, with the reason. */
const UNDOCUMENTED = new Map<string, string>([['GET /api/v1/events', 'WebSocket stream, hidden on purpose']]);

/**
 * Reconstruct every registered route from Fastify's own route tree, so the guard below
 * cannot go stale when somebody adds a route: the list is derived, never hand-written.
 */
function registeredRoutes(tree: string): { method: string; url: string }[] {
  const stack: string[] = [];
  const routes: { method: string; url: string }[] = [];

  for (const line of tree.split('\n')) {
    const marker = line.search(/[├└]/);
    if (marker < 0) continue;

    const depth = Math.floor(marker / 4);
    const text = line.slice(marker + 4);
    const match = /^(.*?)(?: \(([^)]*)\))?$/.exec(text);
    if (match === null) continue;

    const segment = match[1] ?? '';
    stack.length = depth;
    stack[depth] = segment;

    const methods = match[2];
    if (methods === undefined) continue;

    const url = stack.slice(0, depth + 1).join('');
    for (const method of methods.split(',').map((entry) => entry.trim())) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      routes.push({ method, url });
    }
  }

  return routes;
}

/** `/api/v1/lights/:id/state` → `/lights/{id}/state`, matching the OpenAPI document. */
function toDocumentPath(url: string): string {
  return url.slice(API_BASE_PATH.length).replace(/:([^/]+)/g, '{$1}');
}

let ctx: TestApp;
let document: OpenApiDocument;

beforeEach(async () => {
  ctx = await buildTestApp();
  document = ctx.app.swagger() as unknown as OpenApiDocument;
});

afterEach(async () => {
  await ctx.close();
});

describe('the generated OpenAPI document', () => {
  it('describes the API itself', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('Milight Studio API');
    expect(document.info.version.length).toBeGreaterThan(0);
    expect(document.info.description?.length).toBeGreaterThan(0);
    expect(document.servers).toEqual([{ url: API_BASE_PATH }]);
    expect(document.tags?.map((tag) => tag.name)).toEqual(['system', 'lights', 'groups', 'scenes']);
  });

  it('is also served over HTTP', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    expect(response.json<OpenApiDocument>().paths).toEqual(document.paths);
  });

  it('documents every registered API route', () => {
    const routes = registeredRoutes(ctx.app.printRoutes({ commonPrefix: false })).filter((route) =>
      route.url.startsWith(`${API_BASE_PATH}/`),
    );

    expect(routes.length).toBeGreaterThan(10);

    const missing = routes.filter((route) => {
      if (UNDOCUMENTED.has(`${route.method} ${route.url}`)) return false;
      return document.paths[toDocumentPath(route.url)]?.[route.method.toLowerCase()] === undefined;
    });

    expect(missing.map((route) => `${route.method} ${route.url}`)).toEqual([]);
  });

  it('does not document routes that are not registered', () => {
    const registered = new Set(
      registeredRoutes(ctx.app.printRoutes({ commonPrefix: false })).map(
        (route) => `${route.method} ${toDocumentPath(route.url)}`,
      ),
    );

    const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
      HTTP_METHODS.filter((method) => operations[method] !== undefined).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    );

    expect(documented.filter((entry) => !registered.has(entry))).toEqual([]);
  });

  it('gives every documented operation a summary and a tag', () => {
    const operations = Object.entries(document.paths).flatMap(([path, byMethod]) =>
      HTTP_METHODS.filter((method) => byMethod[method] !== undefined).map((method) => ({
        id: `${method.toUpperCase()} ${path}`,
        operation: byMethod[method]!,
      })),
    );

    expect(operations.length).toBeGreaterThan(10);

    for (const { id, operation } of operations) {
      expect(operation.summary, `${id} has no summary`).toBeDefined();
      expect((operation.summary ?? '').length, `${id} has an empty summary`).toBeGreaterThan(0);
      expect(operation.tags?.length, `${id} has no tag`).toBeGreaterThan(0);
    }
  });

  it('documents a success response for every operation', () => {
    const failures: string[] = [];

    for (const [path, byMethod] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = byMethod[method];
        if (operation === undefined) continue;
        const codes = Object.keys(operation.responses ?? {});
        if (!codes.some((code) => ['200', '201', '204'].includes(code))) {
          failures.push(`${method.toUpperCase()} ${path} documents no 200/201/204`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('documents the shared error envelope on every operation', () => {
    const failures: string[] = [];

    for (const [path, byMethod] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = byMethod[method];
        if (operation === undefined) continue;
        const codes = Object.keys(operation.responses ?? {});
        for (const expected of ['400', '404', '500']) {
          if (!codes.includes(expected)) failures.push(`${method.toUpperCase()} ${path} lacks ${expected}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it.each([
    { path: '/lights', method: 'post', status: '201' },
    { path: '/lights/{id}', method: 'delete', status: '204' },
    { path: '/lights/{id}/state', method: 'put', status: '200' },
    { path: '/groups/{id}/state', method: 'put', status: '200' },
    { path: '/scenes/{id}/activate', method: 'post', status: '200' },
    { path: '/health', method: 'get', status: '200' },
  ])('documents $method $path with a $status response', ({ path, method, status }) => {
    const operation = document.paths[path]?.[method];
    expect(operation, `${method} ${path} is missing`).toBeDefined();
    expect(Object.keys(operation?.responses ?? {})).toContain(status);
  });

  it('keeps the hidden WebSocket route out of the document', () => {
    expect(document.paths['/events']).toBeUndefined();
    expect(UNDOCUMENTED.has('GET /api/v1/events')).toBe(true);
  });

  it('serves the interactive docs', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/docs/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('swagger');
  });
});
