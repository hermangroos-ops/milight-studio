import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, parseErrorEnvelope, request, requestVoid } from './client.js';

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('returns the parsed body on success and prefixes the base path', async () => {
    const fetchMock = stubFetch(jsonResponse({ lights: [] }));

    await expect(request<{ lights: unknown[] }>('/lights')).resolves.toEqual({ lights: [] });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/lights', expect.objectContaining({ method: 'GET' }));
  });

  it('serialises the body and sets the JSON content type', async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true }, 201));

    await request('/lights', { method: 'POST', body: { name: 'Bank' } });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"name":"Bank"}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('resolves to undefined for 204 responses', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(requestVoid('/lights/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws a typed ApiError parsed from the error envelope', async () => {
    stubFetch(
      jsonResponse(
        {
          error: {
            code: 'validation_failed',
            message: 'Ongeldige invoer',
            details: [{ path: 'deviceId', message: 'Moet hex zijn' }],
          },
        },
        422,
      ),
    );

    const error = await request('/lights', { method: 'POST', body: {} }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('validation_failed');
    expect(apiError.details).toEqual([{ path: 'deviceId', message: 'Moet hex zijn' }]);
    expect(apiError.fullMessage).toBe('Ongeldige invoer (deviceId: Moet hex zijn)');
  });

  it('falls back to invalid_response when an error body is not the envelope', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));

    const error = (await request('/health').catch((cause: unknown) => cause)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('invalid_response');
    expect(error.status).toBe(502);
  });

  it('rejects a 200 response that is not JSON', async () => {
    stubFetch(new Response('not json', { status: 200 }));

    const error = (await request('/health').catch((cause: unknown) => cause)) as ApiError;

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('geen geldige JSON');
  });

  it('reports network failures as a network_error', async () => {
    stubFetch(new TypeError('Failed to fetch'));

    const error = (await request('/health').catch((cause: unknown) => cause)) as ApiError;

    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.fullMessage).toContain('Failed to fetch');
  });

  it('passes an abort signal through', async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    const controller = new AbortController();

    await request('/health', { signal: controller.signal });

    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBe(controller.signal);
  });
});

describe('parseErrorEnvelope', () => {
  it('tolerates malformed envelopes', () => {
    expect(parseErrorEnvelope(500, { error: {} }).code).toBe('unknown_error');
    expect(parseErrorEnvelope(500, { error: {} }).message).toBe('Onbekende serverfout.');
    expect(parseErrorEnvelope(500, null).code).toBe('invalid_response');
    expect(parseErrorEnvelope(500, { error: { code: 'x', message: 'y', details: 'nope' } }).details).toEqual(
      [],
    );
    expect(
      parseErrorEnvelope(500, { error: { code: 'x', message: 'y', details: [{ path: 1 }] } }).details,
    ).toEqual([]);
  });
});
