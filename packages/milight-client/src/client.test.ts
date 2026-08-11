import { describe, expect, it } from 'vitest';

import { MilightHubClient, type MilightHubClientOptions } from './client.js';
import {
  MilightHubResponseError,
  MilightHubUnreachableError,
  isMilightHubError,
  type MilightHubError,
} from './errors.js';
import type { HubAddress } from './types.js';

type FetchFn = typeof globalThis.fetch;
type Responder = () => Response | Promise<Response>;

interface FetchCall {
  url: string;
  method: string | undefined;
  body: string | undefined;
  headers: Record<string, string> | undefined;
  signal: AbortSignal | undefined;
}

interface Harness {
  fetch: FetchFn;
  calls: FetchCall[];
  sleeps: number[];
}

const ADDRESS: HubAddress = { deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 };

const ok =
  (body = ''): Responder =>
  () =>
    new Response(body, { status: 200 });
const status =
  (code: number, body = ''): Responder =>
  () =>
    new Response(body, { status: code });
const networkError =
  (message = 'ECONNREFUSED'): Responder =>
  () => {
    throw new TypeError(message);
  };

function harness(responders: Responder[]): Harness {
  const calls: FetchCall[] = [];
  const sleeps: number[] = [];
  let index = 0;

  const fetch = ((input: unknown, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers,
      signal: init?.signal ?? undefined,
    });
    const responder = responders[Math.min(index, responders.length - 1)] ?? ok();
    index += 1;
    try {
      return Promise.resolve(responder());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }) as FetchFn;

  return { fetch, calls, sleeps };
}

function makeClient(
  responders: Responder[],
  options: Partial<MilightHubClientOptions> = {},
): { client: MilightHubClient; calls: FetchCall[]; sleeps: number[] } {
  const stub = harness(responders);
  const client = new MilightHubClient({
    baseUrl: 'http://hub.local',
    minRequestGapMs: 0,
    retryDelayMs: 150,
    fetch: stub.fetch,
    sleep: (ms) => {
      stub.sleeps.push(ms);
      return Promise.resolve();
    },
    ...options,
  });
  return { client, calls: stub.calls, sleeps: stub.sleeps };
}

describe('MilightHubClient: url construction', () => {
  it('strips trailing slashes from the base url', () => {
    const { client } = makeClient([ok()], { baseUrl: 'http://hub.local///' });
    expect(client.baseUrl).toBe('http://hub.local');
  });

  it('builds the /about url', async () => {
    const { client, calls } = makeClient([ok('{}')]);
    await client.about();
    expect(calls[0]?.url).toBe('http://hub.local/about');
  });

  it.each([
    { address: ADDRESS, path: '/gateways/0x0001/rgb_cct/1' },
    {
      address: { deviceId: '0xffff', remoteType: 'fut089' as const, groupId: 8 },
      path: '/gateways/0xffff/fut089/8',
    },
    { address: { deviceId: '0x0', remoteType: 'rgb' as const, groupId: 0 }, path: '/gateways/0x0/rgb/0' },
  ])('builds the gateway path $path', async ({ address, path }) => {
    const { client, calls } = makeClient([ok('{}')]);
    await client.getState(address);
    expect(calls[0]?.url).toBe(`http://hub.local${path}`);
  });

  it('percent-encodes an alias used in place of a device id', async () => {
    const { client, calls } = makeClient([ok('{}')]);
    await client.getState({ deviceId: 'living room/lamp', remoteType: 'rgb_cct', groupId: 2 });
    expect(calls[0]?.url).toBe('http://hub.local/gateways/living%20room%2Flamp/rgb_cct/2');
  });
});

describe('MilightHubClient: request shape', () => {
  it('sends a JSON body with a content-type header on a PUT', async () => {
    const { client, calls } = makeClient([ok('')]);
    await client.sendCommand(ADDRESS, { status: 'ON', level: 40 });

    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.body).toBe('{"status":"ON","level":40}');
    expect(calls[0]?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('preserves key order when serialising the command body', async () => {
    const { client, calls } = makeClient([ok('')]);
    await client.sendCommand(ADDRESS, { status: 'ON', level: 10, hue: 5, saturation: 100 });
    expect(calls[0]?.body).toBe('{"status":"ON","level":10,"hue":5,"saturation":100}');
  });

  it('sends neither body nor content-type on a GET', async () => {
    const { client, calls } = makeClient([ok('{}')]);
    await client.getState(ADDRESS);

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers).toBeUndefined();
  });

  it('always attaches an abort signal derived from the timeout', async () => {
    const { client, calls } = makeClient([ok('{}')]);
    await client.getState(ADDRESS);

    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal?.aborted).toBe(false);
  });

  it('combines a caller supplied signal with the timeout signal', async () => {
    const { client, calls } = makeClient([ok('{}')]);
    const controller = new AbortController();
    await client.getState(ADDRESS, controller.signal);

    expect(calls[0]?.signal?.aborted).toBe(false);
    controller.abort(new Error('caller gave up'));
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('aborts the request once the timeout elapses', async () => {
    const { client, calls } = makeClient(
      [
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(new Response('{}'));
            }, 60);
          }),
      ],
      { timeoutMs: 200 },
    );
    await client.getState(ADDRESS);
    const signal = calls[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => {
        resolve();
      });
    });
    expect(signal?.aborted).toBe(true);
  }, 2000);
});

describe('MilightHubClient: response handling', () => {
  it('parses a JSON body', async () => {
    const { client } = makeClient([ok('{"firmware":"1.11.0"}')]);
    await expect(client.about()).resolves.toEqual({ firmware: '1.11.0' });
  });

  it('returns undefined for an empty body', async () => {
    const { client } = makeClient([ok('')]);
    await expect(client.request('/anything')).resolves.toBeUndefined();
  });

  it.each(['success', 'true', 'not json at all'])(
    'returns the raw text for the non-JSON body %p',
    async (text) => {
      const { client } = makeClient([ok(text)]);
      await expect(client.request('/anything')).resolves.toBe(text === 'true' ? true : text);
    },
  );
});

describe('MilightHubClient: retries', () => {
  it('retries a network failure and succeeds on the third attempt', async () => {
    const responders = [networkError(), networkError(), ok('{"firmware":"1.11.0"}')];
    const { client, calls, sleeps } = makeClient(responders);

    await expect(client.about()).resolves.toEqual({ firmware: '1.11.0' });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([150, 300]);
  });

  it.each([500, 502, 503, 429, 408])('retries the retryable status %i', async (code) => {
    const { client, calls, sleeps } = makeClient([status(code, 'nope'), status(code, 'nope'), ok('{}')]);
    await expect(client.about()).resolves.toEqual({});
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([150, 300]);
  });

  it.each([400, 401, 403, 404, 409, 422])('never retries the client error %i', async (code) => {
    const { client, calls, sleeps } = makeClient([status(code, 'bad request')]);

    await expect(client.about()).rejects.toBeInstanceOf(MilightHubResponseError);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('honours a retries setting of zero', async () => {
    const { client, calls } = makeClient([networkError()], { retries: 0 });
    await expect(client.about()).rejects.toBeInstanceOf(MilightHubUnreachableError);
    expect(calls).toHaveLength(1);
  });

  it('backs off exponentially from the configured base delay', async () => {
    const { client, sleeps } = makeClient([networkError()], { retries: 4, retryDelayMs: 10 });
    await expect(client.about()).rejects.toBeInstanceOf(MilightHubUnreachableError);
    expect(sleeps).toEqual([10, 20, 40, 80]);
  });

  it('throws MilightHubUnreachableError once the retries are exhausted', async () => {
    const { client, calls } = makeClient([networkError('getaddrinfo ENOTFOUND')]);

    const error = await client.about().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MilightHubUnreachableError);
    expect(isMilightHubError(error)).toBe(true);
    expect((error as MilightHubError).code).toBe('hub_unreachable');
    expect((error as MilightHubError).status).toBeUndefined();
    expect((error as Error).message).toContain('http://hub.local/about');
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(3);
  });

  it('throws the last MilightHubResponseError once the retries are exhausted', async () => {
    const { client, calls } = makeClient([status(503, 'hub is busy')]);

    const error = await client.about().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MilightHubResponseError);
    expect((error as MilightHubResponseError).status).toBe(503);
    expect((error as MilightHubResponseError).body).toBe('hub is busy');
    expect((error as MilightHubResponseError).code).toBe('hub_error');
    expect(calls).toHaveLength(3);
  });

  it('carries the status and body of a non-retryable failure', async () => {
    const { client } = makeClient([status(404, 'no such gateway')]);

    const error = await client.getState(ADDRESS).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MilightHubResponseError);
    expect((error as MilightHubResponseError).status).toBe(404);
    expect((error as MilightHubResponseError).body).toBe('no such gateway');
    expect((error as Error).message).toContain('GET /gateways/0x0001/rgb_cct/1');
  });

  it('tolerates a failure body that cannot be read', async () => {
    const unreadable = (): Response =>
      ({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('stream broken')),
      }) as unknown as Response;

    const { client } = makeClient([unreadable, unreadable, unreadable]);
    const error = await client.about().catch((caught: unknown) => caught);
    expect((error as MilightHubResponseError).body).toBe('');
  });
});

describe('MilightHubClient: endpoints', () => {
  it('probes reachability with ping', async () => {
    const reachable = makeClient([ok('{}')]);
    await expect(reachable.client.ping()).resolves.toBe(true);

    const unreachable = makeClient([networkError()]);
    await expect(unreachable.client.ping()).resolves.toBe(false);

    const rejecting = makeClient([status(404)]);
    await expect(rejecting.client.ping()).resolves.toBe(false);
  });

  it('passes an abort signal through ping to about', async () => {
    const { client, calls } = makeClient([ok('{}')]);
    const controller = new AbortController();
    await client.ping(controller.signal);
    expect(calls[0]?.signal?.aborted).toBe(false);
    controller.abort(new Error('stop'));
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('reads a group state', async () => {
    const { client, calls } = makeClient([ok('{"state":"ON","level":50}')]);
    await expect(client.getState(ADDRESS)).resolves.toEqual({ state: 'ON', level: 50 });
    expect(calls[0]?.method).toBe('GET');
  });

  it.each([
    { name: 'pair', body: '{"commands":["pair"]}' },
    { name: 'unpair', body: '{"commands":["unpair"]}' },
  ] as const)('sends the $name command', async ({ name, body }) => {
    const { client, calls } = makeClient([ok('')]);
    await client[name](ADDRESS);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.body).toBe(body);
  });

  it('forgets the cached state with a DELETE', async () => {
    const { client, calls } = makeClient([ok('')]);
    await client.forgetState(ADDRESS);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('http://hub.local/gateways/0x0001/rgb_cct/1');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('lists aliases', async () => {
    const payload = {
      aliases: [{ id: 1, alias: 'bureau', device_id: 1, group_id: 1, device_type: 'rgb_cct' }],
      count: 1,
    };
    const { client, calls } = makeClient([ok(JSON.stringify(payload))]);
    await expect(client.listAliases()).resolves.toEqual(payload);
    expect(calls[0]?.url).toBe('http://hub.local/aliases');
  });

  it('reads the remote configs', async () => {
    const { client, calls } = makeClient([ok('{"rgb_cct":{"num_groups":4}}')]);
    await expect(client.remoteConfigs()).resolves.toEqual({ rgb_cct: { num_groups: 4 } });
    expect(calls[0]?.url).toBe('http://hub.local/remote_configs');
  });
});

describe('MilightHubClient: queueing', () => {
  it('serialises commands and reports how many are pending', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { client, calls } = makeClient([
      async () => {
        await gate;
        return new Response('', { status: 200 });
      },
      ok(''),
    ]);

    const first = client.sendCommand(ADDRESS, { status: 'ON' });
    const second = client.sendCommand(ADDRESS, { status: 'OFF' });

    await Promise.resolve();
    expect(client.pendingRequests).toBe(2);
    expect(calls).toHaveLength(1);

    release?.();
    await Promise.all([first, second]);

    expect(calls).toHaveLength(2);
    expect(client.pendingRequests).toBe(0);
  });

  it('lets the /about probe bypass a blocked queue', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { client, calls } = makeClient([
      async () => {
        await gate;
        return new Response('', { status: 200 });
      },
      ok('{"firmware":"1.11.0"}'),
    ]);

    const queued = client.sendCommand(ADDRESS, { status: 'ON' });
    await Promise.resolve();

    await expect(client.about()).resolves.toEqual({ firmware: '1.11.0' });
    expect(calls.map((call) => call.url)).toEqual([
      'http://hub.local/gateways/0x0001/rgb_cct/1',
      'http://hub.local/about',
    ]);

    release?.();
    await queued;
  });

  it('waits out the minimum request gap between queued calls', async () => {
    const { client, sleeps } = makeClient([ok(''), ok('')], { minRequestGapMs: 40 });

    await client.sendCommand(ADDRESS, { status: 'ON' });
    await client.sendCommand(ADDRESS, { status: 'OFF' });

    expect(sleeps.at(-1)).toBe(40);
  });

  it('drains once every queued command has been flushed', async () => {
    const { client, calls } = makeClient([ok(''), ok(''), ok('')]);

    void client.sendCommand(ADDRESS, { status: 'ON' });
    void client.sendCommand(ADDRESS, { status: 'OFF' });
    void client.sendCommand(ADDRESS, { level: 10 });

    await client.drain();
    expect(calls).toHaveLength(3);
    expect(client.pendingRequests).toBe(0);
  });
});
