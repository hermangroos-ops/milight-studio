import {
  createDefaultLightState,
  type Group,
  type LightWithState,
  type Scene,
  type ServerEvent,
} from '@milight-studio/shared';

export interface HubSnapshot {
  reachable: boolean;
  version: string | null;
  checkedAt: string | null;
}

/** Everything the WebSocket stream can touch, in one plain object so the patch is pure. */
export interface CacheSnapshot {
  lights: LightWithState[];
  groups: Group[];
  scenes: Scene[];
  hub: HubSnapshot | null;
  lastSceneActivatedId: string | null;
}

export function emptySnapshot(): CacheSnapshot {
  return { lights: [], groups: [], scenes: [], hub: null, lastSceneActivatedId: null };
}

function upsertById<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

/**
 * Applies one `ServerEvent` to a cache snapshot and returns a new snapshot.
 *
 * Kept free of React Query so it can be unit tested directly; `useServerEvents`
 * is a thin adapter that reads and writes the query cache around this function.
 */
export function applyServerEvent(snapshot: CacheSnapshot, event: ServerEvent): CacheSnapshot {
  switch (event.type) {
    case 'hello':
      return snapshot;

    case 'light.created': {
      const existing = snapshot.lights.find((light) => light.id === event.light.id);
      const state = existing?.state ?? createDefaultLightState();
      return { ...snapshot, lights: upsertById(snapshot.lights, { ...event.light, state }) };
    }

    case 'light.updated': {
      const existing = snapshot.lights.find((light) => light.id === event.light.id);
      if (!existing) return snapshot;
      return { ...snapshot, lights: upsertById(snapshot.lights, { ...event.light, state: existing.state }) };
    }

    case 'light.deleted':
      return { ...snapshot, lights: snapshot.lights.filter((light) => light.id !== event.lightId) };

    case 'light.state': {
      if (!snapshot.lights.some((light) => light.id === event.lightId)) return snapshot;
      const lights = snapshot.lights.map((light) =>
        light.id === event.lightId ? { ...light, state: event.state } : light,
      );
      return { ...snapshot, lights };
    }

    case 'group.created':
    case 'group.updated':
      return { ...snapshot, groups: upsertById(snapshot.groups, event.group) };

    case 'group.deleted':
      return { ...snapshot, groups: snapshot.groups.filter((group) => group.id !== event.groupId) };

    case 'scene.created':
    case 'scene.updated':
      return { ...snapshot, scenes: upsertById(snapshot.scenes, event.scene) };

    case 'scene.deleted':
      return { ...snapshot, scenes: snapshot.scenes.filter((scene) => scene.id !== event.sceneId) };

    case 'scene.activated':
      return { ...snapshot, lastSceneActivatedId: event.sceneId };

    case 'hub.status':
      return {
        ...snapshot,
        hub: { reachable: event.reachable, version: event.version, checkedAt: event.checkedAt },
      };
  }
}

/** Parses a raw WebSocket payload, returning `null` for anything unrecognised. */
export function parseServerEvent(raw: unknown): ServerEvent | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== 'string') return null;
    return parsed as ServerEvent;
  } catch {
    return null;
  }
}
