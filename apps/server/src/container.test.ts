import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MilightHubClient } from '@milight-studio/milight-client';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeClock, FakeHub, sequentialIds } from '../tests/helpers/support.js';
import { loadConfig } from './config.js';
import { createServices } from './container.js';
import { MemoryPersistence, emptyDatabase } from './domain/store.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'milight-container-'));
  directories.push(directory);
  return directory;
}

describe('createServices', () => {
  it('wires the whole object graph from configuration alone', async () => {
    const DATA_DIR = await tempDir();
    const config = loadConfig({ NODE_ENV: 'test', DATA_DIR, MILIGHT_HUB_URL: 'http://hub.test' });

    const services = await createServices(config);

    expect(services.config).toBe(config);
    expect(services.hub).toBeInstanceOf(MilightHubClient);
    expect(services.hub.baseUrl).toBe('http://hub.test');
    expect(services.store.data).toEqual(emptyDatabase());
    expect(services.events.listenerCount).toBe(0);
    expect(services.lights.list()).toEqual([]);
    expect(services.groups.list()).toEqual([]);
    expect(services.scenes.list()).toEqual([]);
    expect(services.hubMonitor.status).toMatchObject({ reachable: false });
  });

  it('persists to a real file under DATA_DIR when nothing is injected', async () => {
    const DATA_DIR = await tempDir();
    const config = loadConfig({ NODE_ENV: 'test', DATA_DIR });

    const services = await createServices(config);
    services.lights.create({
      name: 'Bureau',
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 1,
      exposeToVoice: true,
    });
    await services.store.flush();

    expect(await readdir(DATA_DIR)).toContain('milight-studio.json');
  });

  it('generates real uuids when no generator is injected', async () => {
    const services = await createServices(loadConfig({ NODE_ENV: 'test' }), {
      persistence: new MemoryPersistence(),
    });

    const light = services.lights.create({
      name: 'Bureau',
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 1,
      exposeToVoice: true,
    });

    expect(light.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('honours every override', async () => {
    const persistence = new MemoryPersistence();
    const hub = new FakeHub();
    const clock = new FakeClock('2030-06-01T12:00:00.000Z');
    const generateId = sequentialIds();
    const errors: unknown[] = [];

    const services = await createServices(loadConfig({ NODE_ENV: 'test' }), {
      persistence,
      hub: hub.client,
      clock,
      generateId,
      onError: (error) => errors.push(error),
    });

    const light = services.lights.create({
      name: 'Bureau',
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 1,
      exposeToVoice: true,
    });

    expect(light.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(light.createdAt).toBe('2030-06-01T12:00:00.000Z');
    expect(services.hub).toBe(hub.client);

    await services.store.flush();
    expect((await persistence.load())?.lights).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('shares the same clock and id generator across every service', async () => {
    const clock = new FakeClock('2030-06-01T12:00:00.000Z');
    const services = await createServices(loadConfig({ NODE_ENV: 'test' }), {
      persistence: new MemoryPersistence(),
      hub: new FakeHub().client,
      clock,
      generateId: sequentialIds(),
    });

    const group = services.groups.create({ name: 'Woonkamer', lightIds: [], exposeToVoice: true });
    const scene = services.scenes.create({
      name: 'Filmavond',
      exposeToVoice: true,
      steps: [{ targetType: 'group', targetId: group.id, command: { power: 'on' } }],
    });

    expect(group.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(scene.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(group.createdAt).toBe(clock.iso());
    expect(scene.createdAt).toBe(clock.iso());
  });

  it('routes a persistence failure to the injected error handler', async () => {
    const errors: unknown[] = [];
    const failure = new Error('disk full');
    const services = await createServices(loadConfig({ NODE_ENV: 'test' }), {
      persistence: {
        load: () => Promise.resolve(null),
        save: () => Promise.reject(failure),
      },
      hub: new FakeHub().client,
      onError: (error) => errors.push(error),
    });

    services.lights.create({
      name: 'Bureau',
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 1,
      exposeToVoice: true,
    });
    await services.store.flush();

    expect(errors).toEqual([failure]);
  });

  it('routes a failing event listener to the injected error handler', async () => {
    const errors: unknown[] = [];
    const services = await createServices(loadConfig({ NODE_ENV: 'test' }), {
      persistence: new MemoryPersistence(),
      hub: new FakeHub().client,
      onError: (error) => errors.push(error),
    });

    services.events.subscribe(() => {
      throw new Error('listener exploded');
    });
    services.events.emit({ type: 'light.deleted', lightId: 'x' });

    expect(errors).toHaveLength(1);
  });

  it('loads whatever persistence already holds', async () => {
    const persistence = new MemoryPersistence({
      ...emptyDatabase(),
      groups: [
        {
          id: '11111111-2222-4333-8444-555555555555',
          name: 'Woonkamer',
          room: null,
          lightIds: [],
          exposeToVoice: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const services = await createServices(loadConfig({ NODE_ENV: 'test' }), {
      persistence,
      hub: new FakeHub().client,
    });

    expect(services.groups.list().map((group) => group.name)).toEqual(['Woonkamer']);
  });

  it('builds the hub client from the hub settings in the configuration', async () => {
    const services = await createServices(
      loadConfig({
        NODE_ENV: 'test',
        MILIGHT_HUB_URL: 'http://192.168.1.42/',
        MILIGHT_HUB_TIMEOUT_MS: '1500',
        MILIGHT_HUB_RETRIES: '0',
        MILIGHT_HUB_MIN_GAP_MS: '0',
      }),
      { persistence: new MemoryPersistence() },
    );

    expect(services.hub.baseUrl).toBe('http://192.168.1.42');
    expect(services.hub.pendingRequests).toBe(0);
  });
});
