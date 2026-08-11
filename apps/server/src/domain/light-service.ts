import {
  MilightHubResponseError,
  MilightHubUnreachableError,
  applyCommandToState,
  buildHubCommandBody,
  mergeHubState,
  validateCommand,
  type HubAddress,
  type MilightHubClient,
} from '@milight-studio/milight-client';
import {
  createDefaultLightState,
  getRemoteTypeProfile,
  isValidGroupId,
  normaliseDeviceId,
  type CreateLightInput,
  type Light,
  type LightCommand,
  type LightState,
  type LightWithState,
  type UpdateLightInput,
} from '@milight-studio/shared';

import {
  ConflictError,
  HubFailureError,
  HubUnreachableError,
  NotFoundError,
  UnsupportedCapabilityError,
  ValidationError,
} from '../errors.js';
import type { EventBus } from './event-bus.js';
import type { Store } from './store.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface LightServiceDeps {
  store: Store;
  hub: MilightHubClient;
  events: EventBus;
  clock?: Clock;
  generateId?: () => string;
}

export function toHubAddress(light: Pick<Light, 'deviceId' | 'remoteType' | 'groupId'>): HubAddress {
  return { deviceId: light.deviceId, remoteType: light.remoteType, groupId: light.groupId };
}

/** Turn a client-layer failure into the API's error vocabulary. */
export function translateHubError(error: unknown): never {
  if (error instanceof MilightHubUnreachableError) {
    throw new HubUnreachableError('The Milight hub is not reachable', error);
  }
  if (error instanceof MilightHubResponseError) {
    throw new HubFailureError(`The Milight hub rejected the request: ${error.message}`, error);
  }
  throw error;
}

export class LightService {
  readonly #store: Store;
  readonly #hub: MilightHubClient;
  readonly #events: EventBus;
  readonly #clock: Clock;
  readonly #generateId: () => string;

  constructor(deps: LightServiceDeps) {
    this.#store = deps.store;
    this.#hub = deps.hub;
    this.#events = deps.events;
    this.#clock = deps.clock ?? systemClock;
    this.#generateId = deps.generateId ?? (() => crypto.randomUUID());
  }

  list(): LightWithState[] {
    return this.#store.data.lights.map((light) => this.#withState(light));
  }

  find(id: string): LightWithState | undefined {
    const light = this.#store.data.lights.find((entry) => entry.id === id);
    return light === undefined ? undefined : this.#withState(light);
  }

  get(id: string): LightWithState {
    const light = this.find(id);
    if (light === undefined) throw new NotFoundError('Light', id);
    return light;
  }

  getState(id: string): LightState {
    return this.get(id).state;
  }

  create(input: CreateLightInput): LightWithState {
    const deviceId = normaliseDeviceId(input.deviceId);
    this.#assertAddressValid(input.remoteType, input.groupId);
    this.#assertAddressFree(deviceId, input.remoteType, input.groupId, null);

    const now = this.#clock.now().toISOString();
    const light: Light = {
      id: this.#generateId(),
      name: input.name.trim(),
      room: input.room?.trim() ?? null,
      deviceId,
      remoteType: input.remoteType,
      groupId: input.groupId,
      exposeToVoice: input.exposeToVoice,
      createdAt: now,
      updatedAt: now,
    };

    this.#store.mutate((data) => {
      data.lights.push(light);
      data.states[light.id] = createDefaultLightState(this.#clock.now());
    });

    this.#events.emit({ type: 'light.created', light });
    return this.#withState(light);
  }

  update(id: string, input: UpdateLightInput): LightWithState {
    const existing = this.#store.data.lights.find((entry) => entry.id === id);
    if (existing === undefined) throw new NotFoundError('Light', id);

    const remoteType = input.remoteType ?? existing.remoteType;
    const groupId = input.groupId ?? existing.groupId;
    const deviceId = input.deviceId === undefined ? existing.deviceId : normaliseDeviceId(input.deviceId);

    this.#assertAddressValid(remoteType, groupId);
    this.#assertAddressFree(deviceId, remoteType, groupId, id);

    const updated: Light = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.room === undefined ? {} : { room: input.room?.trim() ?? null }),
      ...(input.exposeToVoice === undefined ? {} : { exposeToVoice: input.exposeToVoice }),
      deviceId,
      remoteType,
      groupId,
      updatedAt: this.#clock.now().toISOString(),
    };

    this.#store.mutate((data) => {
      const index = data.lights.findIndex((entry) => entry.id === id);
      if (index >= 0) data.lights[index] = updated;
    });

    this.#events.emit({ type: 'light.updated', light: updated });
    return this.#withState(updated);
  }

  remove(id: string): void {
    const exists = this.#store.data.lights.some((entry) => entry.id === id);
    if (!exists) throw new NotFoundError('Light', id);

    this.#store.mutate((data) => {
      data.lights = data.lights.filter((entry) => entry.id !== id);
      data.states = Object.fromEntries(Object.entries(data.states).filter(([lightId]) => lightId !== id));
      // A light that no longer exists must not linger in groups or scenes.
      data.groups = data.groups.map((group) =>
        group.lightIds.includes(id)
          ? { ...group, lightIds: group.lightIds.filter((lightId) => lightId !== id) }
          : group,
      );
      data.scenes = data.scenes.map((scene) => ({
        ...scene,
        steps: scene.steps.filter((step) => !(step.targetType === 'light' && step.targetId === id)),
      }));
    });

    this.#events.emit({ type: 'light.deleted', lightId: id });
  }

  /** Send a command to one light and update its shadow state. */
  async command(id: string, command: LightCommand): Promise<LightWithState> {
    const light = this.get(id);
    const issues = validateCommand(command);
    if (issues.length > 0) throw new ValidationError('Conflicting command fields', issues);

    const { body, unsupported } = buildHubCommandBody(command, light.remoteType);
    if (Object.keys(body).length === 0) {
      const profile = getRemoteTypeProfile(light.remoteType);
      throw new UnsupportedCapabilityError(
        `'${profile.label}' does not support any part of this command`,
        unsupported.map((capability) => ({
          path: capability,
          message: `Not supported by remote type '${light.remoteType}'`,
        })),
      );
    }

    try {
      await this.#hub.sendCommand(toHubAddress(light), body);
    } catch (error) {
      this.#markUnreachable(id);
      translateHubError(error);
    }

    const next = applyCommandToState(light.state, command, light.remoteType, this.#clock.now());
    return this.#commitState(light, { ...next, reachable: true });
  }

  /** Ask the hub what it thinks the current state is and fold it in. */
  async refresh(id: string): Promise<LightWithState> {
    const light = this.get(id);
    try {
      const hubState = await this.#hub.getState(toHubAddress(light));
      const next = mergeHubState(light.state, hubState, this.#clock.now());
      return this.#commitState(light, next);
    } catch (error) {
      this.#markUnreachable(id);
      translateHubError(error);
    }
  }

  async pair(id: string): Promise<void> {
    const light = this.get(id);
    try {
      await this.#hub.pair(toHubAddress(light));
    } catch (error) {
      translateHubError(error);
    }
  }

  async unpair(id: string): Promise<void> {
    const light = this.get(id);
    try {
      await this.#hub.unpair(toHubAddress(light));
    } catch (error) {
      translateHubError(error);
    }
  }

  #withState(light: Light): LightWithState {
    const state = this.#store.data.states[light.id] ?? createDefaultLightState(this.#clock.now());
    return { ...light, state };
  }

  #commitState(light: Light, state: LightState): LightWithState {
    this.#store.mutate((data) => {
      data.states[light.id] = state;
    });
    this.#events.emit({ type: 'light.state', lightId: light.id, state });
    return { ...light, state };
  }

  #markUnreachable(id: string): void {
    const current = this.#store.data.states[id];
    if (!current?.reachable) return;
    const next: LightState = { ...current, reachable: false, updatedAt: this.#clock.now().toISOString() };
    this.#store.mutate((data) => {
      data.states[id] = next;
    });
    this.#events.emit({ type: 'light.state', lightId: id, state: next });
  }

  #assertAddressValid(remoteType: Light['remoteType'], groupId: number): void {
    if (isValidGroupId(remoteType, groupId)) return;
    const profile = getRemoteTypeProfile(remoteType);
    throw new ValidationError('Invalid group for this remote type', [
      {
        path: 'groupId',
        message: `Remote type '${remoteType}' supports groups 0–${profile.maxGroupId}`,
      },
    ]);
  }

  #assertAddressFree(
    deviceId: string,
    remoteType: Light['remoteType'],
    groupId: number,
    ignoreId: string | null,
  ): void {
    const clash = this.#store.data.lights.find(
      (entry) =>
        entry.id !== ignoreId &&
        entry.deviceId === deviceId &&
        entry.remoteType === remoteType &&
        entry.groupId === groupId,
    );
    if (clash !== undefined) {
      throw new ConflictError(
        `Light '${clash.name}' already uses address ${deviceId}/${remoteType}/${groupId}`,
      );
    }
  }
}
