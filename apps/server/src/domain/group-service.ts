import type {
  CreateGroupInput,
  Group,
  LightCommand,
  LightWithState,
  UpdateGroupInput,
} from '@milight-studio/shared';

import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { EventBus } from './event-bus.js';
import type { Clock, LightService } from './light-service.js';
import { systemClock } from './light-service.js';
import type { Store } from './store.js';

export interface GroupServiceDeps {
  store: Store;
  lights: LightService;
  events: EventBus;
  clock?: Clock;
  generateId?: () => string;
}

export interface GroupCommandFailure {
  lightId: string;
  code: string;
  message: string;
}

export interface GroupCommandResult {
  group: Group;
  lights: LightWithState[];
  failed: GroupCommandFailure[];
}

/**
 * User-defined groups. Unlike a MiLight radio zone these can span protocols and
 * device ids, so a command is fanned out to each member. The hub client serialises
 * the resulting requests, which is exactly what the ESP8266 needs.
 */
export class GroupService {
  readonly #store: Store;
  readonly #lights: LightService;
  readonly #events: EventBus;
  readonly #clock: Clock;
  readonly #generateId: () => string;

  constructor(deps: GroupServiceDeps) {
    this.#store = deps.store;
    this.#lights = deps.lights;
    this.#events = deps.events;
    this.#clock = deps.clock ?? systemClock;
    this.#generateId = deps.generateId ?? (() => crypto.randomUUID());
  }

  list(): Group[] {
    return [...this.#store.data.groups];
  }

  get(id: string): Group {
    const group = this.#store.data.groups.find((entry) => entry.id === id);
    if (group === undefined) throw new NotFoundError('Group', id);
    return group;
  }

  members(id: string): LightWithState[] {
    return this.get(id)
      .lightIds.map((lightId) => this.#lights.find(lightId))
      .filter((light): light is LightWithState => light !== undefined);
  }

  create(input: CreateGroupInput): Group {
    this.#assertNameFree(input.name, null);
    this.#assertLightsExist(input.lightIds);

    const now = this.#clock.now().toISOString();
    const group: Group = {
      id: this.#generateId(),
      name: input.name.trim(),
      room: input.room?.trim() ?? null,
      lightIds: [...new Set(input.lightIds)],
      exposeToVoice: input.exposeToVoice,
      createdAt: now,
      updatedAt: now,
    };

    this.#store.mutate((data) => {
      data.groups.push(group);
    });
    this.#events.emit({ type: 'group.created', group });
    return group;
  }

  update(id: string, input: UpdateGroupInput): Group {
    const existing = this.get(id);
    if (input.name !== undefined) this.#assertNameFree(input.name, id);
    if (input.lightIds !== undefined) this.#assertLightsExist(input.lightIds);

    const updated: Group = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.room === undefined ? {} : { room: input.room?.trim() ?? null }),
      ...(input.lightIds === undefined ? {} : { lightIds: [...new Set(input.lightIds)] }),
      ...(input.exposeToVoice === undefined ? {} : { exposeToVoice: input.exposeToVoice }),
      updatedAt: this.#clock.now().toISOString(),
    };

    this.#store.mutate((data) => {
      const index = data.groups.findIndex((entry) => entry.id === id);
      if (index >= 0) data.groups[index] = updated;
    });
    this.#events.emit({ type: 'group.updated', group: updated });
    return updated;
  }

  remove(id: string): void {
    this.get(id);
    this.#store.mutate((data) => {
      data.groups = data.groups.filter((entry) => entry.id !== id);
      data.scenes = data.scenes.map((scene) => ({
        ...scene,
        steps: scene.steps.filter((step) => !(step.targetType === 'group' && step.targetId === id)),
      }));
    });
    this.#events.emit({ type: 'group.deleted', groupId: id });
  }

  /**
   * Fan a command out to every member. Members are addressed one after another so a
   * single unreachable bulb cannot stall the rest, and partial failures are reported
   * rather than swallowed.
   */
  async command(id: string, command: LightCommand): Promise<GroupCommandResult> {
    const group = this.get(id);
    if (group.lightIds.length === 0) {
      throw new ValidationError('Group has no members', [
        { path: 'lightIds', message: 'Add at least one light before controlling this group' },
      ]);
    }

    const lights: LightWithState[] = [];
    const failed: GroupCommandFailure[] = [];
    let firstError: unknown;

    for (const lightId of group.lightIds) {
      try {
        lights.push(await this.#lights.command(lightId, command));
      } catch (error) {
        firstError ??= error;
        failed.push({
          lightId,
          code: error instanceof AppError ? error.code : 'internal_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Nothing worked at all: surface the underlying problem instead of a hollow 200.
    if (lights.length === 0 && firstError !== undefined) {
      throw firstError instanceof Error
        ? firstError
        : new Error('Every light in the group failed to respond');
    }

    return { group, lights, failed };
  }

  #assertNameFree(name: string, ignoreId: string | null): void {
    const trimmed = name.trim().toLowerCase();
    const clash = this.#store.data.groups.find(
      (entry) => entry.id !== ignoreId && entry.name.toLowerCase() === trimmed,
    );
    if (clash !== undefined) throw new ConflictError(`A group named '${clash.name}' already exists`);
  }

  #assertLightsExist(lightIds: string[]): void {
    const missing = lightIds.filter((lightId) => this.#lights.find(lightId) === undefined);
    if (missing.length > 0) {
      throw new ValidationError('Group references lights that do not exist', [
        { path: 'lightIds', message: `Unknown light ids: ${missing.join(', ')}` },
      ]);
    }
  }
}
