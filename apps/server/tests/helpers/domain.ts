import type { CreateLightInput, ServerEvent } from '@milight-studio/shared';

import { EventBus } from '../../src/domain/event-bus.js';
import { GroupService } from '../../src/domain/group-service.js';
import { HubMonitor } from '../../src/domain/hub-monitor.js';
import { LightService } from '../../src/domain/light-service.js';
import { SceneService } from '../../src/domain/scene-service.js';
import { MemoryPersistence, Store } from '../../src/domain/store.js';
import { FakeClock, FakeHub, sequentialIds } from './support.js';

export interface DomainHarness {
  clock: FakeClock;
  hub: FakeHub;
  events: EventBus;
  emitted: ServerEvent[];
  persistence: MemoryPersistence;
  store: Store;
  lights: LightService;
  groups: GroupService;
  scenes: SceneService;
  monitor: HubMonitor;
  errors: unknown[];
  /** Create a light with sensible defaults; only the interesting bits need naming. */
  addLight: (patch?: Partial<CreateLightInput>) => ReturnType<LightService['create']>;
}

export interface DomainOptions {
  intervalMs?: number;
  persistence?: MemoryPersistence;
}

/**
 * The domain half of the application wired up with fakes: a memory store, a fake clock,
 * deterministic ids and an in-process hub. No sockets, no timers, no randomness.
 */
export async function createDomain(options: DomainOptions = {}): Promise<DomainHarness> {
  const clock = new FakeClock();
  const hub = new FakeHub();
  const errors: unknown[] = [];
  const events = new EventBus((error) => errors.push(error));
  const emitted: ServerEvent[] = [];
  events.subscribe((event) => emitted.push(event));

  const persistence = options.persistence ?? new MemoryPersistence();
  const store = new Store(persistence, { debounceMs: 0, onError: (error) => errors.push(error) });
  await store.load();

  const generateId = sequentialIds();
  const shared = { store, events, clock, generateId };

  const lights = new LightService({ ...shared, hub: hub.client });
  const groups = new GroupService({ ...shared, lights });
  const scenes = new SceneService({ ...shared, lights, groups });
  const monitor = new HubMonitor({
    hub: hub.client,
    events,
    clock,
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
  });

  let deviceCounter = 0;
  const addLight = (patch: Partial<CreateLightInput> = {}) => {
    deviceCounter += 1;
    return lights.create({
      name: `Light ${deviceCounter}`,
      deviceId: `0x${deviceCounter.toString(16).padStart(4, '0')}`,
      remoteType: 'rgb_cct',
      groupId: 1,
      exposeToVoice: true,
      ...patch,
    });
  };

  return {
    clock,
    hub,
    events,
    emitted,
    persistence,
    store,
    lights,
    groups,
    scenes,
    monitor,
    errors,
    addLight,
  };
}
