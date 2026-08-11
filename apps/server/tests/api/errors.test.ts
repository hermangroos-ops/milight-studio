import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiErrorSchema, lightWithStateSchema } from '@milight-studio/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../helpers/app.js';
import { MISSING_ID } from '../helpers/support.js';

const contexts: TestApp[] = [];
const directories: string[] = [];

async function build(...args: Parameters<typeof buildTestApp>): Promise<TestApp> {
  const ctx = await buildTestApp(...args);
  contexts.push(ctx);
  return ctx;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const validLight = { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 };

describe('validation failures', () => {
  it.each([
    {
      why: 'a malformed uuid in the path',
      request: { method: 'GET' as const, url: '/api/v1/lights/not-a-uuid' },
      path: 'id',
    },
    {
      why: 'an unknown body field',
      request: { method: 'POST' as const, url: '/api/v1/lights', payload: { ...validLight, warp: 9 } },
      path: '(root)',
    },
    {
      why: 'a malformed device id',
      request: {
        method: 'POST' as const,
        url: '/api/v1/lights',
        payload: { ...validLight, deviceId: 'nonsense' },
      },
      path: 'deviceId',
    },
    {
      why: 'a missing required field',
      request: { method: 'POST' as const, url: '/api/v1/lights', payload: { name: 'Bureau' } },
      path: '(root)',
    },
    {
      why: 'a group id out of range',
      request: {
        method: 'POST' as const,
        url: '/api/v1/lights',
        payload: { ...validLight, groupId: 42 },
      },
      path: 'groupId',
    },
    {
      why: 'an empty name',
      request: { method: 'POST' as const, url: '/api/v1/lights', payload: { ...validLight, name: '' } },
      path: 'name',
    },
  ])('answers the validation envelope for $why', async ({ request, path }) => {
    const ctx = await build();
    const response = await ctx.app.inject(request);

    expect(response.statusCode).toBe(400);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(parsed.error.details?.map((detail) => detail.path)).toContain(path);
    expect(parsed.error.details?.every((detail) => detail.message.length > 0)).toBe(true);
  });

  it.each([
    { payload: { brightness: 101 }, path: 'brightness' },
    { payload: { brightness: -1 }, path: 'brightness' },
    { payload: { hue: 360 }, path: 'hue' },
    { payload: { colorTemperature: 9000 }, path: 'colorTemperature' },
    { payload: { effect: 42 }, path: 'effect' },
    { payload: { hex: 'nope' }, path: 'hex' },
    { payload: { transitionMs: 900_000 }, path: 'transitionMs' },
  ])('rejects the out-of-range command $payload with a pointer to $path', async ({ payload, path }) => {
    const ctx = await build();
    const created = await ctx.app.inject({ method: 'POST', url: '/api/v1/lights', payload: validLight });
    const id = lightWithStateSchema.parse(created.json()).id;

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload,
    });

    expect(response.statusCode).toBe(400);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details?.map((detail) => detail.path)).toContain(path);
  });

  it('rejects an empty command', async () => {
    const ctx = await build();
    const created = await ctx.app.inject({ method: 'POST', url: '/api/v1/lights', payload: validLight });
    const id = lightWithStateSchema.parse(created.json()).id;

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('validation_failed');
  });

  it('rejects a body that is not JSON', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      headers: { 'content-type': 'application/json' },
      payload: 'this is not json',
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('validation_failed');
  });

  it('rejects an unsupported content type inside the envelope', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      headers: { 'content-type': 'text/plain' },
      payload: 'nope',
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('validation_failed');
  });
});

describe('not found', () => {
  it.each(['/api/v1/lights', '/api/v1/groups', '/api/v1/scenes'])(
    'answers the envelope for an unknown id under %s',
    async (collection) => {
      const ctx = await build();
      const response = await ctx.app.inject({ method: 'GET', url: `${collection}/${MISSING_ID}` });

      expect(response.statusCode).toBe(404);
      const parsed = apiErrorSchema.parse(response.json());
      expect(parsed.error.code).toBe('not_found');
      expect(parsed.error.message).toContain(MISSING_ID);
    },
  );

  it.each([
    { method: 'GET' as const, url: '/api/v1/nope' },
    { method: 'POST' as const, url: '/api/v1/lights/nope/nope' },
    { method: 'GET' as const, url: '/api/v2/lights' },
  ])('answers the envelope for the unknown route $method $url', async ({ method, url }) => {
    const ctx = await build();
    const response = await ctx.app.inject({ method, url });

    expect(response.statusCode).toBe(404);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('not_found');
    expect(parsed.error.message).toContain(url);
  });

  it('answers the envelope for a non-API path when the web UI is not built', async () => {
    const ctx = await build({ env: { SERVE_WEB: '1', WEB_ROOT: './definitely-not-here' } });
    const response = await ctx.app.inject({ method: 'GET', url: '/settings' });

    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('falls back to index.html for a non-API path when the web UI is built', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'milight-web-'));
    directories.push(directory);
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Milight</title>', 'utf8');

    const ctx = await build({ env: { SERVE_WEB: '1', WEB_ROOT: directory } });

    const spa = await ctx.app.inject({ method: 'GET', url: '/settings' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('<title>Milight</title>');

    const asset = await ctx.app.inject({ method: 'GET', url: '/index.html' });
    expect(asset.statusCode).toBe(200);

    // API paths keep answering with the envelope rather than the single page app.
    const api = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(api.statusCode).toBe(404);
    expect(apiErrorSchema.parse(api.json()).error.code).toBe('not_found');

    // Only GET falls through to the app shell.
    const post = await ctx.app.inject({ method: 'POST', url: '/settings' });
    expect(post.statusCode).toBe(404);
    expect(apiErrorSchema.parse(post.json()).error.code).toBe('not_found');
  });
});

describe('unexpected failures', () => {
  it('answers a 500 envelope without leaking the message', async () => {
    const ctx = await build();
    ctx.services.lights.list = () => {
      throw new Error('secret internal detail');
    };

    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });

    expect(response.statusCode).toBe(500);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('internal_error');
    expect(parsed.error.message).not.toContain('secret internal detail');
  });
});

describe('CORS', () => {
  it('answers a preflight for an API route', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/lights',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('reflects the allowed origin on a normal request', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/lights',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('honours an explicit origin allow list', async () => {
    const ctx = await build({ env: { CORS_ORIGINS: 'https://studio.example' } });

    const allowed = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/lights',
      headers: { origin: 'https://studio.example' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://studio.example');

    const rejected = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/lights',
      headers: { origin: 'https://evil.example' },
    });
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('hardened mode', () => {
  it('adds the helmet security headers', async () => {
    const ctx = await build({ hardened: true });
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('advertises the rate limit and eventually answers 429 in the envelope', async () => {
    const ctx = await build({ hardened: true, env: { RATE_LIMIT_MAX: '10' } });
    const remoteAddress = '10.20.30.40';

    const first = await ctx.app.inject({ method: 'GET', url: '/api/v1/health', remoteAddress });
    expect(Number(first.headers['x-ratelimit-limit'])).toBe(10);

    let limited: Awaited<ReturnType<typeof ctx.app.inject>> | null = null;
    for (let attempt = 0; attempt < 30 && limited === null; attempt += 1) {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/health', remoteAddress });
      if (response.statusCode === 429) limited = response;
    }

    expect(limited).not.toBeNull();
    expect(apiErrorSchema.parse(limited!.json()).error.code).toBe('rate_limited');
  });

  // The UI, the voice bridges and the health probe all talk to the API over loopback and
  // legitimately burst; throttling them would break the product, not protect it.
  it('never rate limits a loopback client', async () => {
    const ctx = await build({ hardened: true, env: { RATE_LIMIT_MAX: '10' } });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/health',
        remoteAddress: '127.0.0.1',
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('leaves the security headers off outside hardened mode', async () => {
    const ctx = await build();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights' });
    expect(response.headers['x-content-type-options']).toBeUndefined();
  });
});
