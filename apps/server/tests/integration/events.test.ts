import type { AddressInfo } from 'node:net';

import { lightWithStateSchema, serverEventSchema, type ServerEvent } from '@milight-studio/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, clientFor, type TestApp } from '../helpers/app.js';
import { FakeMilightHubServer } from '../helpers/fake-hub-server.js';

const hub = new FakeMilightHubServer();
let ctx: TestApp;
let baseUrl: string;
const sockets: WebSocket[] = [];

/** A live WebSocket client that buffers every validated event it receives. */
interface EventClient {
  socket: WebSocket;
  events: ServerEvent[];
  next: (type: ServerEvent['type']) => Promise<ServerEvent>;
  close: () => Promise<void>;
}

async function connect(): Promise<EventClient> {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/api/v1/events`);
  sockets.push(socket);

  const events: ServerEvent[] = [];
  const waiters: { type: ServerEvent['type']; resolve: (event: ServerEvent) => void }[] = [];

  socket.addEventListener('message', (message: MessageEvent) => {
    const event = serverEventSchema.parse(JSON.parse(String(message.data)));
    events.push(event);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index]!.type === event.type) {
        waiters.splice(index, 1)[0]!.resolve(event);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener(
      'open',
      () => {
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        reject(new Error('WebSocket failed to open'));
      },
      { once: true },
    );
  });

  return {
    socket,
    events,
    next: (type) =>
      new Promise<ServerEvent>((resolve, reject) => {
        const existing = events.find((event) => event.type === type);
        if (existing !== undefined) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${type}`));
        }, 5000);
        waiters.push({
          type,
          resolve: (event) => {
            clearTimeout(timer);
            resolve(event);
          },
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === socket.CLOSED) {
          resolve();
          return;
        }
        socket.addEventListener(
          'close',
          () => {
            resolve();
          },
          { once: true },
        );
        socket.close();
      }),
  };
}

beforeAll(async () => {
  await hub.start();
});

afterAll(async () => {
  await hub.stop();
});

beforeEach(async () => {
  hub.reset();
  ctx = await buildTestApp({ hub: clientFor(hub.baseUrl) });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const address = ctx.app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await ctx.close();
});

describe('the /api/v1/events WebSocket', () => {
  it('greets a new client with hello', async () => {
    const client = await connect();
    const hello = await client.next('hello');

    expect(hello).toMatchObject({ type: 'hello' });
    expect(client.events[0]?.type).toBe('hello');
    if (hello.type === 'hello') {
      expect(Number.isNaN(Date.parse(hello.serverTime))).toBe(false);
      expect(hello.version.length).toBeGreaterThan(0);
    }

    await client.close();
  });

  it('pushes the light.state event caused by a REST command', async () => {
    const client = await connect();
    await client.next('hello');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 },
    });
    const id = lightWithStateSchema.parse(created.json()).id;
    await client.next('light.created');

    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/lights/${id}/state`,
      payload: { power: 'on', brightness: 55 },
    });

    const event = await client.next('light.state');
    expect(event).toMatchObject({ type: 'light.state', lightId: id });
    if (event.type === 'light.state') {
      expect(event.state).toMatchObject({ power: 'on', brightness: 55, reachable: true });
    }

    expect(client.events.map((entry) => entry.type)).toEqual(['hello', 'light.created', 'light.state']);

    await client.close();
  });

  it('broadcasts to every connected client', async () => {
    const first = await connect();
    const second = await connect();
    await Promise.all([first.next('hello'), second.next('hello')]);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      payload: { name: 'Woonkamer' },
    });

    await Promise.all([first.next('group.created'), second.next('group.created')]);
    expect(first.events.map((event) => event.type)).toEqual(second.events.map((event) => event.type));

    await Promise.all([first.close(), second.close()]);
  });

  it('unsubscribes a client that disconnects', async () => {
    const client = await connect();
    await client.next('hello');
    expect(ctx.services.events.listenerCount).toBeGreaterThanOrEqual(1);

    const before = ctx.services.events.listenerCount;
    await client.close();

    const deadline = Date.now() + 5000;
    while (ctx.services.events.listenerCount >= before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(ctx.services.events.listenerCount).toBeLessThan(before);
  });

  it('streams the whole lifecycle of a light', async () => {
    const client = await connect();
    await client.next('hello');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 },
    });
    const id = lightWithStateSchema.parse(created.json()).id;

    await ctx.app.inject({ method: 'PATCH', url: `/api/v1/lights/${id}`, payload: { name: 'Nieuw' } });
    await ctx.app.inject({ method: 'DELETE', url: `/api/v1/lights/${id}` });

    await client.next('light.deleted');
    expect(client.events.map((event) => event.type)).toEqual([
      'hello',
      'light.created',
      'light.updated',
      'light.deleted',
    ]);

    await client.close();
  });
});
