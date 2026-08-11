import { MilightHubClient } from '@milight-studio/milight-client';
import type { ServerEvent } from '@milight-studio/shared';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';
import type { BridgeRegistry } from '../../src/bridges/registry.js';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createServices, type Services } from '../../src/container.js';
import type { Clock } from '../../src/domain/light-service.js';
import { MemoryPersistence } from '../../src/domain/store.js';
import { FakeClock, FakeHub, sequentialIds } from './support.js';

export interface TestAppOptions {
  /** Extra environment on top of the test defaults. */
  env?: NodeJS.ProcessEnv;
  hub?: MilightHubClient;
  persistence?: MemoryPersistence;
  clock?: Clock;
  bridges?: BridgeRegistry;
  hardened?: boolean;
}

export interface TestApp {
  app: FastifyInstance;
  services: Services;
  config: AppConfig;
  persistence: MemoryPersistence;
  clock: FakeClock;
  /** Only set when no explicit hub was injected. */
  fakeHub: FakeHub | null;
  emitted: ServerEvent[];
  errors: unknown[];
  close: () => Promise<void>;
}

export function testConfig(env: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    SERVE_WEB: '0',
    MILIGHT_HUB_POLL_MS: '0',
    MILIGHT_HUB_URL: 'http://hub.test',
    ...env,
  });
}

/**
 * The whole server, wired the way production wires it, but with a memory store, a fake
 * clock, deterministic ids and either an in-process hub stub or a real client pointed at
 * the fake hub server.
 */
export async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = testConfig(options.env);
  const clock = options.clock instanceof FakeClock ? options.clock : new FakeClock();
  const persistence = options.persistence ?? new MemoryPersistence();
  const fakeHub = options.hub === undefined ? new FakeHub() : null;
  const errors: unknown[] = [];

  const services = await createServices(config, {
    persistence,
    hub: options.hub ?? fakeHub!.client,
    clock: options.clock ?? clock,
    generateId: sequentialIds(),
    onError: (error) => errors.push(error),
  });

  const emitted: ServerEvent[] = [];
  services.events.subscribe((event) => emitted.push(event));

  const app = await buildApp({
    services,
    ...(options.bridges === undefined ? {} : { bridges: options.bridges }),
    ...(options.hardened === undefined ? {} : { hardened: options.hardened }),
  });
  await app.ready();

  return {
    app,
    services,
    config,
    persistence,
    clock,
    fakeHub,
    emitted,
    errors,
    close: async () => {
      services.hubMonitor.stop();
      await app.close();
      await services.store.flush();
    },
  };
}

/** A `MilightHubClient` aimed at a fake hub server, tuned for fast, deterministic tests. */
export function clientFor(baseUrl: string, overrides: Partial<{ retries: number }> = {}): MilightHubClient {
  return new MilightHubClient({
    baseUrl,
    timeoutMs: 2000,
    retries: overrides.retries ?? 2,
    retryDelayMs: 1,
    minRequestGapMs: 0,
  });
}
