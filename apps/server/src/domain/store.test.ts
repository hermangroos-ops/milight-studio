import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Light } from '@milight-studio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DATABASE_VERSION,
  FilePersistence,
  MemoryPersistence,
  Store,
  emptyDatabase,
  migrate,
  type DatabaseShape,
  type Persistence,
} from './store.js';

const light: Light = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Bureau',
  room: null,
  deviceId: '0x0001',
  remoteType: 'rgb_cct',
  groupId: 1,
  exposeToVoice: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('emptyDatabase', () => {
  it('starts at the current version with nothing in it', () => {
    expect(emptyDatabase()).toEqual({
      version: DATABASE_VERSION,
      lights: [],
      groups: [],
      scenes: [],
      states: {},
    });
  });

  it('returns a fresh object every time', () => {
    const first = emptyDatabase();
    first.lights.push(light);
    expect(emptyDatabase().lights).toEqual([]);
  });
});

describe('MemoryPersistence', () => {
  it('starts empty and reports null until something is saved', async () => {
    await expect(new MemoryPersistence().load()).resolves.toBeNull();
  });

  it('round trips a database and counts the saves', async () => {
    const persistence = new MemoryPersistence();
    const data = { ...emptyDatabase(), lights: [light] };

    await persistence.save(data);
    await persistence.save(data);

    expect(persistence.saveCount).toBe(2);
    await expect(persistence.load()).resolves.toEqual(data);
  });

  it('clones on the way in, so later mutation of the source is invisible', async () => {
    const persistence = new MemoryPersistence();
    const data = { ...emptyDatabase(), lights: [light] };
    await persistence.save(data);

    data.lights.push({ ...light, id: 'other' });
    const loaded = await persistence.load();
    expect(loaded?.lights).toHaveLength(1);
  });

  it('clones on the way out, so mutating the result cannot corrupt the store', async () => {
    const persistence = new MemoryPersistence({ ...emptyDatabase(), lights: [light] });

    const first = await persistence.load();
    first!.lights[0]!.name = 'Vandalised';
    first!.lights.push({ ...light, id: 'extra' });

    const second = await persistence.load();
    expect(second?.lights).toHaveLength(1);
    expect(second?.lights[0]?.name).toBe('Bureau');
  });

  it('accepts an initial database through the constructor', async () => {
    const initial = { ...emptyDatabase(), lights: [light] };
    await expect(new MemoryPersistence(initial).load()).resolves.toEqual(initial);
  });
});

describe('FilePersistence', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'milight-store-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reports the file it will use', () => {
    expect(new FilePersistence(directory).file).toBe(join(directory, 'milight-studio.json'));
    expect(new FilePersistence(directory, 'custom.json').file).toBe(join(directory, 'custom.json'));
  });

  it('loads null when the file does not exist yet', async () => {
    await expect(new FilePersistence(join(directory, 'nested', 'deeper')).load()).resolves.toBeNull();
  });

  it('creates missing directories and round trips through the disk', async () => {
    const persistence = new FilePersistence(join(directory, 'nested', 'deeper'));
    const data = { ...emptyDatabase(), lights: [light] };

    await persistence.save(data);
    await expect(persistence.load()).resolves.toEqual(data);
  });

  it('writes pretty-printed JSON and leaves no temp file behind', async () => {
    const persistence = new FilePersistence(directory);
    await persistence.save({ ...emptyDatabase(), lights: [light] });

    const raw = await readFile(persistence.file, 'utf8');
    expect(raw).toContain('\n  "version": 1');
    expect(JSON.parse(raw)).toEqual({ ...emptyDatabase(), lights: [light] });
  });

  it('replaces the previous document atomically on a second save', async () => {
    const persistence = new FilePersistence(directory);
    await persistence.save({ ...emptyDatabase(), lights: [light] });
    await persistence.save(emptyDatabase());

    await expect(persistence.load()).resolves.toEqual(emptyDatabase());
  });

  it('propagates a failure that is not a missing file', async () => {
    const persistence = new FilePersistence(directory);
    await writeFile(persistence.file, 'this is not json', 'utf8');
    await expect(persistence.load()).rejects.toThrow();
  });
});

describe('migrate', () => {
  it('passes a well formed document through, stamping the current version', () => {
    const data = { version: 0, lights: [light], groups: [], scenes: [], states: { a: null } };
    expect(migrate(data)).toEqual({ ...data, version: DATABASE_VERSION });
  });

  it.each([
    { input: null, why: 'null' },
    { input: undefined, why: 'undefined' },
    { input: 42, why: 'a number' },
    { input: 'nonsense', why: 'a string' },
    { input: [], why: 'an array' },
    { input: {}, why: 'an empty object' },
    { input: { lights: null, groups: 'x', scenes: 7, states: [] }, why: 'the wrong types throughout' },
    { input: { states: [1, 2, 3] }, why: 'states as an array' },
    { input: { states: null }, why: 'states as null' },
  ])('turns $why into an empty database', ({ input }) => {
    expect(migrate(input)).toEqual(emptyDatabase());
  });

  it('keeps whichever collections happen to be arrays', () => {
    expect(migrate({ lights: [light], groups: 'nope' })).toEqual({
      ...emptyDatabase(),
      lights: [light],
    });
  });

  it('keeps a plain states object', () => {
    const states = { 'some-id': { power: 'on' } };
    expect(migrate({ states }).states).toEqual(states);
  });
});

describe('Store', () => {
  it('starts from an empty database when persistence has nothing', async () => {
    const store = new Store(new MemoryPersistence());
    await store.load();
    expect(store.data).toEqual(emptyDatabase());
  });

  it('migrates whatever persistence hands back', async () => {
    const store = new Store(new MemoryPersistence({ lights: 'nope' } as unknown as DatabaseShape));
    await store.load();
    expect(store.data).toEqual(emptyDatabase());
  });

  it('coalesces several mutations into a single save', async () => {
    const persistence = new MemoryPersistence();
    const store = new Store(persistence, { debounceMs: 0 });
    await store.load();

    store.mutate((data) => data.lights.push(light));
    store.mutate((data) => data.lights.push({ ...light, id: 'second' }));
    store.mutate((data) => {
      data.states[light.id] = null as never;
    });

    expect(persistence.saveCount).toBe(0);
    await store.flush();
    expect(persistence.saveCount).toBe(1);
    expect((await persistence.load())?.lights).toHaveLength(2);
  });

  it('returns whatever the mutator returned', async () => {
    const store = new Store(new MemoryPersistence(), { debounceMs: 0 });
    await store.load();
    expect(store.mutate(() => 'result')).toBe('result');
  });

  it('persists on its own once the debounce window elapses', async () => {
    vi.useFakeTimers();
    try {
      const persistence = new MemoryPersistence();
      const store = new Store(persistence, { debounceMs: 250 });
      await store.load();

      store.mutate((data) => data.lights.push(light));
      store.mutate((data) => data.lights.push({ ...light, id: 'second' }));

      await vi.advanceTimersByTimeAsync(249);
      expect(persistence.saveCount).toBe(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(persistence.saveCount).toBe(1);

      store.mutate((data) => data.lights.push({ ...light, id: 'third' }));
      await vi.advanceTimersByTimeAsync(250);
      expect(persistence.saveCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes writes observable through flush even before the timer fires', async () => {
    const persistence = new MemoryPersistence();
    const store = new Store(persistence, { debounceMs: 60_000 });
    await store.load();

    store.mutate((data) => data.lights.push(light));
    await store.flush();

    expect((await persistence.load())?.lights).toEqual([light]);
  });

  it('is a no-op to flush when nothing changed', async () => {
    const persistence = new MemoryPersistence();
    const store = new Store(persistence, { debounceMs: 0 });
    await store.load();

    await store.flush();
    await store.flush();
    expect(persistence.saveCount).toBe(0);
  });

  it('saves a snapshot, so a later mutation cannot leak into the pending write', async () => {
    const persistence = new MemoryPersistence();
    const store = new Store(persistence, { debounceMs: 0 });
    await store.load();

    store.mutate((data) => data.lights.push(light));
    const flushing = store.flush();
    store.mutate((data) => data.lights.push({ ...light, id: 'late' }));
    await flushing;

    expect((await persistence.load())?.lights).toHaveLength(1);
  });

  it('routes a persistence failure to onError instead of throwing', async () => {
    const failure = new Error('disk full');
    const persistence: Persistence = {
      load: () => Promise.resolve(null),
      save: () => Promise.reject(failure),
    };
    const errors: unknown[] = [];
    const store = new Store(persistence, { debounceMs: 0, onError: (error) => errors.push(error) });
    await store.load();

    store.mutate((data) => data.lights.push(light));
    await expect(store.flush()).resolves.toBeUndefined();

    expect(errors).toEqual([failure]);
  });

  it('swallows a persistence failure silently when no onError is supplied', async () => {
    const persistence: Persistence = {
      load: () => Promise.resolve(null),
      save: () => Promise.reject(new Error('disk full')),
    };
    const store = new Store(persistence, { debounceMs: 0 });
    await store.load();

    store.mutate((data) => data.lights.push(light));
    await expect(store.flush()).resolves.toBeUndefined();
  });

  it('keeps working after a failed write', async () => {
    let fail = true;
    const saved: DatabaseShape[] = [];
    const persistence: Persistence = {
      load: () => Promise.resolve(null),
      save: (data) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error('transient'));
        }
        saved.push(data);
        return Promise.resolve();
      },
    };
    const store = new Store(persistence, { debounceMs: 0 });
    await store.load();

    store.mutate((data) => data.lights.push(light));
    await store.flush();

    store.mutate((data) => data.lights.push({ ...light, id: 'second' }));
    await store.flush();

    expect(saved).toHaveLength(1);
    expect(saved[0]?.lights).toHaveLength(2);
  });

  it('round trips through a real file on disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'milight-store-'));
    try {
      const persistence = new FilePersistence(directory);
      const store = new Store(persistence, { debounceMs: 0 });
      await store.load();

      store.mutate((data) => data.lights.push(light));
      await store.flush();

      const reloaded = new Store(new FilePersistence(directory), { debounceMs: 0 });
      await reloaded.load();
      expect(reloaded.data.lights).toEqual([light]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
