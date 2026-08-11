import { apiErrorSchema } from '@milight-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../helpers/app.js';

const TOKEN = 'a-very-secret-token';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await buildTestApp({ env: { API_TOKEN: TOKEN } });
});

afterEach(async () => {
  await ctx.close();
});

describe('bearer authentication', () => {
  it.each([
    { why: 'no Authorization header at all', headers: {} },
    { why: 'an empty Authorization header', headers: { authorization: '' } },
    { why: 'the wrong token', headers: { authorization: 'Bearer wrong-token' } },
    { why: 'the right token without the scheme', headers: { authorization: TOKEN } },
    { why: 'the wrong scheme', headers: { authorization: `Basic ${TOKEN}` } },
    { why: 'a lowercase scheme', headers: { authorization: `bearer ${TOKEN}` } },
    { why: 'extra whitespace', headers: { authorization: `Bearer  ${TOKEN}` } },
  ])('answers 401 in the envelope for a request with $why', async ({ headers }) => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/lights', headers });

    expect(response.statusCode).toBe(401);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe('unauthorised');
    expect(parsed.error.message).toContain('token');
  });

  it('lets a correct token through', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/lights',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ lights: [] });
  });

  it.each([
    { method: 'GET' as const, url: '/api/v1/health' },
    { method: 'GET' as const, url: '/api/v1/remote-types' },
    { method: 'GET' as const, url: '/api/v1/bridges' },
    { method: 'GET' as const, url: '/api/v1/groups' },
    { method: 'GET' as const, url: '/api/v1/scenes' },
    { method: 'POST' as const, url: '/api/v1/lights' },
  ])('guards $method $url as well', async ({ method, url }) => {
    expect((await ctx.app.inject({ method, url })).statusCode).toBe(401);
  });

  it('rejects before validating the body, so an invalid payload still gets 401', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { nonsense: true },
    });
    expect(response.statusCode).toBe(401);
  });

  // The guard sits on the root instance and matches on the URL prefix, so unmatched API
  // paths are rejected too. Otherwise 404-vs-401 would tell an anonymous caller exactly
  // which routes exist.
  it('guards a path under the API prefix that matches no route', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('unauthorised');
  });

  it('still returns a not-found envelope for an unknown API path when authorised', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('leaves paths outside the API prefix unguarded', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
  });
});

describe('without an API token configured', () => {
  it('lets every request through', async () => {
    const open = await buildTestApp();
    try {
      const anonymous = await open.app.inject({ method: 'GET', url: '/api/v1/lights' });
      expect(anonymous.statusCode).toBe(200);

      const withHeader = await open.app.inject({
        method: 'GET',
        url: '/api/v1/lights',
        headers: { authorization: 'Bearer whatever' },
      });
      expect(withHeader.statusCode).toBe(200);
    } finally {
      await open.close();
    }
  });
});
