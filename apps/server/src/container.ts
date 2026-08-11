import { MilightHubClient } from '@milight-studio/milight-client';

import type { AppConfig } from './config.js';
import { EventBus } from './domain/event-bus.js';
import { GroupService } from './domain/group-service.js';
import { HubMonitor } from './domain/hub-monitor.js';
import { LightService, systemClock, type Clock } from './domain/light-service.js';
import { SceneService } from './domain/scene-service.js';
import { FilePersistence, Store, type Persistence } from './domain/store.js';

export interface Services {
  config: AppConfig;
  store: Store;
  hub: MilightHubClient;
  events: EventBus;
  lights: LightService;
  groups: GroupService;
  scenes: SceneService;
  hubMonitor: HubMonitor;
}

export interface ContainerOverrides {
  persistence?: Persistence;
  hub?: MilightHubClient;
  clock?: Clock;
  generateId?: () => string;
  onError?: (error: unknown) => void;
}

/**
 * Compose the object graph. Everything the server needs is constructed here and
 * injected, so tests can swap the hub for a fake and persistence for memory without
 * touching any production code path.
 */
export async function createServices(
  config: AppConfig,
  overrides: ContainerOverrides = {},
): Promise<Services> {
  const onError = overrides.onError ?? (() => undefined);
  const clock = overrides.clock ?? systemClock;

  const persistence = overrides.persistence ?? new FilePersistence(config.DATA_DIR);
  const store = new Store(persistence, { onError, debounceMs: config.isTest ? 0 : 250 });
  await store.load();

  const hub =
    overrides.hub ??
    new MilightHubClient({
      baseUrl: config.MILIGHT_HUB_URL,
      timeoutMs: config.MILIGHT_HUB_TIMEOUT_MS,
      retries: config.MILIGHT_HUB_RETRIES,
      minRequestGapMs: config.MILIGHT_HUB_MIN_GAP_MS,
    });

  const events = new EventBus(onError);

  const shared = {
    store,
    events,
    clock,
    ...(overrides.generateId ? { generateId: overrides.generateId } : {}),
  };

  const lights = new LightService({ ...shared, hub });
  const groups = new GroupService({ ...shared, lights });
  const scenes = new SceneService({ ...shared, lights, groups });
  const hubMonitor = new HubMonitor({
    hub,
    events,
    intervalMs: config.MILIGHT_HUB_POLL_MS,
    clock,
  });

  return { config, store, hub, events, lights, groups, scenes, hubMonitor };
}
