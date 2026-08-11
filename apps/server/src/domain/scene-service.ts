import type { CreateSceneInput, Scene, UpdateSceneInput } from '@milight-studio/shared';

import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { EventBus } from './event-bus.js';
import type { GroupService } from './group-service.js';
import type { Clock, LightService } from './light-service.js';
import { systemClock } from './light-service.js';
import type { Store } from './store.js';

export interface SceneServiceDeps {
  store: Store;
  lights: LightService;
  groups: GroupService;
  events: EventBus;
  clock?: Clock;
  generateId?: () => string;
}

export interface SceneActivationFailure {
  targetType: 'light' | 'group';
  targetId: string;
  code: string;
  message: string;
}

export interface SceneActivationResult {
  scene: Scene;
  appliedSteps: number;
  failed: SceneActivationFailure[];
}

/** Named collections of commands: "Filmavond", "Ochtend", "Alles uit". */
export class SceneService {
  readonly #store: Store;
  readonly #lights: LightService;
  readonly #groups: GroupService;
  readonly #events: EventBus;
  readonly #clock: Clock;
  readonly #generateId: () => string;

  constructor(deps: SceneServiceDeps) {
    this.#store = deps.store;
    this.#lights = deps.lights;
    this.#groups = deps.groups;
    this.#events = deps.events;
    this.#clock = deps.clock ?? systemClock;
    this.#generateId = deps.generateId ?? (() => crypto.randomUUID());
  }

  list(): Scene[] {
    return [...this.#store.data.scenes];
  }

  get(id: string): Scene {
    const scene = this.#store.data.scenes.find((entry) => entry.id === id);
    if (scene === undefined) throw new NotFoundError('Scene', id);
    return scene;
  }

  create(input: CreateSceneInput): Scene {
    this.#assertNameFree(input.name, null);
    this.#assertTargetsExist(input.steps);

    const now = this.#clock.now().toISOString();
    const scene: Scene = {
      id: this.#generateId(),
      name: input.name.trim(),
      room: input.room?.trim() ?? null,
      steps: input.steps,
      exposeToVoice: input.exposeToVoice,
      createdAt: now,
      updatedAt: now,
    };

    this.#store.mutate((data) => {
      data.scenes.push(scene);
    });
    this.#events.emit({ type: 'scene.created', scene });
    return scene;
  }

  update(id: string, input: UpdateSceneInput): Scene {
    const existing = this.get(id);
    if (input.name !== undefined) this.#assertNameFree(input.name, id);
    if (input.steps !== undefined) this.#assertTargetsExist(input.steps);

    const updated: Scene = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.room === undefined ? {} : { room: input.room?.trim() ?? null }),
      ...(input.steps === undefined ? {} : { steps: input.steps }),
      ...(input.exposeToVoice === undefined ? {} : { exposeToVoice: input.exposeToVoice }),
      updatedAt: this.#clock.now().toISOString(),
    };

    this.#store.mutate((data) => {
      const index = data.scenes.findIndex((entry) => entry.id === id);
      if (index >= 0) data.scenes[index] = updated;
    });
    this.#events.emit({ type: 'scene.updated', scene: updated });
    return updated;
  }

  remove(id: string): void {
    this.get(id);
    this.#store.mutate((data) => {
      data.scenes = data.scenes.filter((entry) => entry.id !== id);
    });
    this.#events.emit({ type: 'scene.deleted', sceneId: id });
  }

  /** Run every step in order. Failing steps are reported but do not abort the scene. */
  async activate(id: string): Promise<SceneActivationResult> {
    const scene = this.get(id);
    const failed: SceneActivationFailure[] = [];
    let appliedSteps = 0;

    for (const step of scene.steps) {
      try {
        if (step.targetType === 'light') await this.#lights.command(step.targetId, step.command);
        else await this.#groups.command(step.targetId, step.command);
        appliedSteps += 1;
      } catch (error) {
        failed.push({
          targetType: step.targetType,
          targetId: step.targetId,
          code: error instanceof AppError ? error.code : 'internal_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.#events.emit({ type: 'scene.activated', sceneId: scene.id });
    return { scene, appliedSteps, failed };
  }

  #assertNameFree(name: string, ignoreId: string | null): void {
    const trimmed = name.trim().toLowerCase();
    const clash = this.#store.data.scenes.find(
      (entry) => entry.id !== ignoreId && entry.name.toLowerCase() === trimmed,
    );
    if (clash !== undefined) throw new ConflictError(`A scene named '${clash.name}' already exists`);
  }

  #assertTargetsExist(steps: Scene['steps']): void {
    const missing = steps.filter((step) =>
      step.targetType === 'light'
        ? this.#lights.find(step.targetId) === undefined
        : !this.#store.data.groups.some((group) => group.id === step.targetId),
    );
    if (missing.length > 0) {
      throw new ValidationError('Scene references targets that do not exist', [
        {
          path: 'steps',
          message: `Unknown targets: ${missing.map((s) => `${s.targetType}:${s.targetId}`).join(', ')}`,
        },
      ]);
    }
  }
}
