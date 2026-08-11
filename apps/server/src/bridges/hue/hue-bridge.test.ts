/**
 * Everything in this file binds real sockets, including UDP 1900 for SSDP. Keeping all
 * of it in a single file means these tests never race each other for that port.
 */
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '../../config.js';
import type { Services } from '../../container.js';
import { createDomain, type DomainHarness } from '../../../tests/helpers/domain.js';
import { HueBridge, createHueBridge } from './hue-bridge.js';
import { SSDP_PORT, SsdpResponder } from './ssdp.js';
import type { BridgeLogger } from '../types.js';

const BRIDGE_ID = '001788FFFE123456';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

function recordingLogger(): { logger: BridgeLogger; messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    logger: {
      info: (message) => messages.push(`info:${message}`),
      warn: (message) => messages.push(`warn:${message}`),
      error: (message) => messages.push(`error:${message}`),
    },
  };
}

function bridgeConfig(port: number, enabled = true): AppConfig {
  return {
    ...loadConfig({ NODE_ENV: 'test' }),
    HUE_BRIDGE_ENABLED: enabled,
    HUE_BRIDGE_PORT: port,
    HUE_BRIDGE_ADDRESS: '127.0.0.1',
  };
}

interface BridgeContext {
  bridge: HueBridge;
  harness: DomainHarness;
  port: number;
  messages: string[];
  request: (method: string, path: string, body?: unknown) => Promise<Response>;
}

const started: { stop: () => Promise<void> }[] = [];

async function startBridge(options: { enabled?: boolean } = {}): Promise<BridgeContext> {
  const harness = await createDomain();
  const port = await freePort();
  const { logger, messages } = recordingLogger();

  const bridge = new HueBridge({
    config: bridgeConfig(port, options.enabled ?? true),
    services: harness as unknown as Services,
    logger,
  });

  await bridge.start();
  started.push(bridge);

  return {
    bridge,
    harness,
    port,
    messages,
    request: (method, path, body) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: typeof body === 'string' ? body : JSON.stringify(body),
            }),
      }),
  };
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((bridge) => bridge.stop()));
});

describe('HueBridge lifecycle', () => {
  it('reports itself as not running before start', async () => {
    const harness = await createDomain();
    const bridge = new HueBridge({
      config: bridgeConfig(await freePort()),
      services: harness as unknown as Services,
    });

    expect(bridge.name).toBe('hue-emulation');
    expect(bridge.enabled).toBe(true);
    expect(bridge.status()).toEqual({
      name: 'hue-emulation',
      enabled: true,
      running: false,
      detail: null,
    });
  });

  it('mirrors the enabled flag from the configuration', async () => {
    const harness = await createDomain();
    const bridge = new HueBridge({
      config: bridgeConfig(await freePort(), false),
      services: harness as unknown as Services,
    });

    expect(bridge.enabled).toBe(false);
    expect(bridge.status().enabled).toBe(false);
  });

  it('starts listening and reports where it can be found', async () => {
    const ctx = await startBridge();

    expect(ctx.bridge.status()).toMatchObject({ running: true });
    expect(ctx.bridge.status().detail).toContain(`127.0.0.1:${ctx.port}`);
    expect(ctx.messages.some((message) => message.startsWith('info:Discoverable'))).toBe(true);
  });

  it('is idempotent about starting and stopping', async () => {
    const ctx = await startBridge();

    await expect(ctx.bridge.start()).resolves.toBeUndefined();
    expect(ctx.bridge.status().running).toBe(true);

    await ctx.bridge.stop();
    expect(ctx.bridge.status()).toMatchObject({ running: false, detail: null });
    await expect(ctx.bridge.stop()).resolves.toBeUndefined();
  });

  it('can be restarted on the same port', async () => {
    const ctx = await startBridge();
    await ctx.bridge.stop();
    await ctx.bridge.start();

    expect((await ctx.request('GET', '/description.xml')).status).toBe(200);
  });

  it('is built by the createHueBridge factory', async () => {
    const harness = await createDomain();
    const bridge = createHueBridge({
      config: bridgeConfig(await freePort(), false),
      services: harness as unknown as Services,
    });

    expect(bridge.name).toBe('hue-emulation');
    expect(bridge.enabled).toBe(false);
  });

  it('falls back to the detected LAN address when none is configured', async () => {
    const harness = await createDomain();
    const config = { ...bridgeConfig(await freePort()), HUE_BRIDGE_ADDRESS: '' };
    const bridge = new HueBridge({ config, services: harness as unknown as Services });

    await bridge.start();
    started.push(bridge);

    const detail = bridge.status().detail ?? '';
    expect(detail).toMatch(/Discoverable as a Hue bridge on \d+\.\d+\.\d+\.\d+:\d+/);
  });
});

describe('HueBridge over HTTP', () => {
  it('serves the UPnP description document', async () => {
    const ctx = await startBridge();
    const response = await ctx.request('GET', '/description.xml');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/xml');
    expect(await response.text()).toContain('<modelName>Philips hue bridge 2015</modelName>');
  });

  it('answers the pairing POST', async () => {
    const ctx = await startBridge();
    const response = await ctx.request('POST', '/api', { devicetype: 'Echo' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ success: { username: 'milight-studio-user' } }]);
  });

  it('lists the lights the services expose', async () => {
    const ctx = await startBridge();
    ctx.harness.addLight({ name: 'Bureau' });
    ctx.harness.addLight({ name: 'Verborgen', exposeToVoice: false });

    const payload = (await (await ctx.request('GET', '/api/x/lights')).json()) as Record<
      string,
      { name: string }
    >;

    expect(Object.values(payload).map((light) => light.name)).toEqual(['Bureau']);
  });

  it('applies a state PUT all the way down to the hub', async () => {
    const ctx = await startBridge();
    const light = ctx.harness.addLight({ name: 'Bureau', deviceId: '0x0001' });

    const listed = (await (await ctx.request('GET', '/api/x/lights')).json()) as Record<string, unknown>;
    const hueId = Object.keys(listed)[0]!;

    const response = await ctx.request('PUT', `/api/x/lights/${hueId}/state`, { on: true, bri: 254 });

    expect(response.status).toBe(200);
    expect(ctx.harness.hub.commands).toEqual([
      {
        address: { deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 },
        body: { status: 'ON', level: 100 },
      },
    ]);
    expect(ctx.harness.lights.getState(light.id)).toMatchObject({ power: 'on', brightness: 100 });
  });

  it('answers a Hue-style 404 for an unknown resource', async () => {
    const ctx = await startBridge();
    const response = await ctx.request('GET', '/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual([
      { error: { type: 3, address: '/nope', description: 'resource not available' } },
    ]);
  });

  it('treats a body that is not JSON as no body at all', async () => {
    const ctx = await startBridge();
    ctx.harness.addLight();
    const listed = (await (await ctx.request('GET', '/api/x/lights')).json()) as Record<string, unknown>;
    const hueId = Object.keys(listed)[0]!;

    const response = await ctx.request('PUT', `/api/x/lights/${hueId}/state`, 'not json at all');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(ctx.harness.hub.calls).toEqual([]);
  });

  it('answers 500 and logs when the service layer blows up', async () => {
    const ctx = await startBridge();
    const light = ctx.harness.addLight();
    const listed = (await (await ctx.request('GET', '/api/x/lights')).json()) as Record<string, unknown>;
    const hueId = Object.keys(listed)[0]!;

    ctx.harness.lights.command = () => Promise.reject(new Error('radio on fire'));

    const response = await ctx.request('PUT', `/api/x/lights/${hueId}/state`, { on: true });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('[]');
    expect(ctx.messages.some((message) => message.startsWith('error:Hue bridge request failed'))).toBe(true);
    expect(light.id.length).toBeGreaterThan(0);
  });

  it('refuses a body that is far too large', async () => {
    const ctx = await startBridge();
    const oversized = 'x'.repeat(70 * 1024);

    const outcome = await ctx
      .request('POST', '/api', oversized)
      .then((response) => response.status)
      .catch(() => 'network-error' as const);

    expect([413, 'network-error']).toContain(outcome);
  });

  it('stops answering once the bridge is stopped', async () => {
    const ctx = await startBridge();
    await ctx.bridge.stop();

    await expect(ctx.request('GET', '/description.xml')).rejects.toThrow();
  });
});

describe('SsdpResponder', () => {
  const responders: SsdpResponder[] = [];

  afterEach(async () => {
    await Promise.all(responders.splice(0).map((responder) => responder.stop()));
  });

  async function startResponder(): Promise<SsdpResponder> {
    const { logger } = recordingLogger();
    const responder = new SsdpResponder({
      address: '127.0.0.1',
      port: 8080,
      bridgeId: BRIDGE_ID,
      logger,
    });
    await responder.start();
    responders.push(responder);
    return responder;
  }

  it('reports whether it is running', async () => {
    const responder = await startResponder();
    expect(responder.running).toBe(true);

    await responder.stop();
    expect(responder.running).toBe(false);
  });

  it('is idempotent about starting and stopping', async () => {
    const responder = await startResponder();
    await expect(responder.start()).resolves.toBeUndefined();
    expect(responder.running).toBe(true);

    await responder.stop();
    await expect(responder.stop()).resolves.toBeUndefined();
  });

  it('answers an M-SEARCH aimed at a Hue bridge', async () => {
    await startResponder();

    const client = createSocket({ type: 'udp4' });
    try {
      const answer = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('no SSDP answer'));
        }, 5000);
        client.on('message', (buffer) => {
          clearTimeout(timer);
          resolve(buffer.toString('utf8'));
        });
      });

      await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));
      client.send(
        Buffer.from(
          ['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'ST: ssdp:all', '', ''].join('\r\n'),
        ),
        SSDP_PORT,
        '127.0.0.1',
      );

      const response = await answer;
      expect(response).toContain('HTTP/1.1 200 OK');
      expect(response).toContain(`hue-bridgeid: ${BRIDGE_ID}`);
      expect(response).toContain('LOCATION: http://127.0.0.1:8080/description.xml');
    } finally {
      await new Promise<void>((resolve) => {
        client.close(() => {
          resolve();
        });
      });
    }
  });

  it('stays silent for a datagram that is not a matching search', async () => {
    await startResponder();

    const client = createSocket({ type: 'udp4' });
    try {
      let answered = false;
      client.on('message', () => {
        answered = true;
      });
      await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));

      client.send(Buffer.from('NOTIFY * HTTP/1.1\r\nST: ssdp:all\r\n\r\n'), SSDP_PORT, '127.0.0.1');
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(answered).toBe(false);
    } finally {
      await new Promise<void>((resolve) => {
        client.close(() => {
          resolve();
        });
      });
    }
  });
});
