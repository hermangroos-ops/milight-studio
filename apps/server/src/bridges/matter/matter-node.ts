import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Environment, ServerNode, VendorId, type EndpointType } from '@matter/main';
import { AggregatorEndpoint } from '@matter/main/endpoints';
import type {
  Group,
  LightState,
  LightWithState,
  RemoteType,
  Scene,
  ServerEvent,
} from '@milight-studio/shared';

import type { Services } from '../../container.js';
import { APP_VERSION } from '../../version.js';
import type { BridgeLogger } from '../types.js';
import {
  aggregateLightStates,
  lightStateToMatterAttributes,
  type MatterLightAttributes,
} from './attribute-mapping.js';
import {
  bridgedEndpointOptions,
  bridgedStatePatch,
  createBridgedDeviceTypes,
  type AggregatorHandle,
  type BridgedDeviceTypes,
  type BridgedEndpointHandle,
} from './bridged-endpoints.js';
import { MatterCommandRouter, type BridgedTarget } from './command-router.js';
import {
  SCENE_PROFILE,
  deviceProfileForGroup,
  deviceProfileForRemoteType,
  endpointIdFor,
  uniqueIdFor,
} from './device-mapping.js';
import type { MatterRuntime, MatterRuntimeDeps } from './matter-runtime.js';

/**
 * Test vendor/product ids from the CSA's development range. A certified product would
 * need real ones; for a self-hosted bridge these are what every uncertified matter.js
 * device uses and Alexa accepts them.
 */
const VENDOR_ID = 0xfff1;
const PRODUCT_ID = 0x8001;
const VENDOR_NAME = 'Milight Studio';
const PRODUCT_NAME = 'Milight Studio Bridge';

/** Fixed, so the commissioned fabric survives restarts and configuration changes. */
const BRIDGE_UNIQUE_ID = 'milightstudiobridge';

/** Alexa stops enumerating a bridge somewhere around this many bridged endpoints. */
const ALEXA_ENDPOINT_LIMIT = 50;

/** How long a scene endpoint reports "on" before arming itself again. */
const SCENE_RESET_MS = 1_500;

export async function buildMatterNode(deps: MatterRuntimeDeps): Promise<MatterRuntime> {
  const { config, services, logger } = deps;

  const storageDir = resolve(config.MATTER_STORAGE_DIR);
  await mkdir(storageDir, { recursive: true });

  const environment = Environment.default;
  environment.vars.set('storage.path', storageDir);
  // The API server owns the process lifecycle: matter.js must not install its own
  // SIGINT/SIGTERM handlers or set the process exit code out from under us.
  environment.vars.set('runtime.signals', false);
  environment.vars.set('runtime.exitcode', false);

  const node = await ServerNode.create({
    id: 'milight-studio',
    network: { port: config.MATTER_BRIDGE_PORT },
    commissioning: {
      passcode: config.MATTER_BRIDGE_PASSCODE,
      discriminator: config.MATTER_BRIDGE_DISCRIMINATOR,
    },
    productDescription: { name: PRODUCT_NAME, deviceType: AggregatorEndpoint.deviceType },
    basicInformation: {
      vendorName: VENDOR_NAME,
      vendorId: VendorId(VENDOR_ID),
      productName: PRODUCT_NAME,
      productLabel: PRODUCT_NAME,
      productId: PRODUCT_ID,
      nodeLabel: PRODUCT_NAME,
      // Matter requires serialNumber and uniqueId to differ.
      serialNumber: `${BRIDGE_UNIQUE_ID}-1`,
      uniqueId: BRIDGE_UNIQUE_ID,
      hardwareVersion: 1,
      hardwareVersionString: '1',
      softwareVersion: 1,
      softwareVersionString: APP_VERSION.slice(0, 64),
    },
  });

  const router = new MatterCommandRouter(services, logger);
  const mirror = new BridgedEndpoints({
    aggregator: await node.add(AggregatorEndpoint, { id: 'aggregator' }),
    deviceTypes: createBridgedDeviceTypes(router),
    router,
    services,
    logger,
  });

  try {
    await mirror.syncAll();

    if (mirror.size > ALEXA_ENDPOINT_LIMIT) {
      logger.warn(
        `Matter bridge exposes ${mirror.size} endpoints; Alexa only discovers about ` +
          `${ALEXA_ENDPOINT_LIMIT} per bridge. Hide the least useful ones with exposeToVoice=false.`,
      );
    }

    await node.start();
  } catch (error) {
    // A half-started node keeps its UDP sockets and storage open, and the registry will
    // happily retry later, so tear it down before reporting the failure upwards.
    await node.close().catch(() => undefined);
    throw error;
  }

  const sceneTimers = new Set<NodeJS.Timeout>();
  const unsubscribe = services.events.subscribe((event) => {
    void handleEvent(event, { mirror, services, sceneTimers }).catch((error: unknown) => {
      logger.warn('Matter bridge failed to apply an event', {
        eventType: event.type,
        error: describeError(error),
      });
    });
  });

  const detail = describeCommissioning(node, config.MATTER_BRIDGE_PORT, mirror.size);
  logger.info(detail);

  return {
    detail,
    stop: async () => {
      unsubscribe();
      for (const timer of sceneTimers) clearTimeout(timer);
      sceneTimers.clear();
      await router.drain();
      await node.close();
    },
  };
}

/**
 * matter.js reports endpoint construction failures as an `AggregateError` whose real
 * cause ("string length 36 exceeds the constraint") sits two levels down, so a plain
 * `error.message` would only ever say "Behaviors have errors".
 */
function describeError(error: unknown, depth = 0): string {
  if (!(error instanceof Error) || depth > 4) return String(error);

  const nested: string[] = [];
  if (error instanceof AggregateError) {
    nested.push(...error.errors.map((inner: unknown) => describeError(inner, depth + 1)));
  }
  if (error.cause !== undefined) nested.push(describeError(error.cause, depth + 1));

  return nested.length === 0 ? error.message : `${error.message}: ${nested.join('; ')}`;
}

interface CommissioningView {
  readonly state: {
    readonly commissioning: {
      readonly commissioned: boolean;
      readonly pairingCodes: { readonly manualPairingCode: string; readonly qrPairingCode: string };
    };
  };
}

/**
 * The commissioning info is the one thing an operator really needs from this bridge, so
 * it is both logged and surfaced through `GET /api/v1/bridges`.
 */
function describeCommissioning(node: CommissioningView, port: number, endpoints: number): string {
  const { commissioned, pairingCodes } = node.state.commissioning;
  const summary = `Matter bridge listening on port ${port} with ${endpoints} bridged device(s)`;
  if (commissioned) {
    return `${summary}; already commissioned. Manual pairing code: ${pairingCodes.manualPairingCode}`;
  }
  return (
    `${summary}. Add it in the Alexa app with manual pairing code ` +
    `${pairingCodes.manualPairingCode} (QR payload: ${pairingCodes.qrPairingCode})`
  );
}

interface EventContext {
  mirror: BridgedEndpoints;
  services: Services;
  sceneTimers: Set<NodeJS.Timeout>;
}

/**
 * Keep the Matter view in sync with ours.
 *
 * matter.js supports adding and removing endpoints on a running node, so lights that
 * appear or disappear are reflected immediately and no restart is needed. Alexa still
 * has to be asked to "discover devices" before a new endpoint shows up in the app.
 */
async function handleEvent(event: ServerEvent, ctx: EventContext): Promise<void> {
  const { mirror, services } = ctx;

  switch (event.type) {
    case 'light.state':
      await mirror.pushLight(event.lightId);
      // A light is usually part of a group whose aggregate state changed with it.
      await mirror.pushGroupsContaining(event.lightId);
      return;

    case 'light.created':
    case 'light.updated': {
      const light = services.lights.find(event.light.id);
      if (light === undefined) return;
      if (light.exposeToVoice) await mirror.addLight(light);
      else await mirror.remove(endpointIdFor('light', light.id));
      return;
    }

    case 'light.deleted':
      await mirror.remove(endpointIdFor('light', event.lightId));
      // Groups may have lost a member, which can change their capabilities.
      await mirror.syncGroups();
      return;

    case 'group.created':
    case 'group.updated':
      if (event.group.exposeToVoice) await mirror.addGroup(event.group);
      else await mirror.remove(endpointIdFor('group', event.group.id));
      return;

    case 'group.deleted':
      await mirror.remove(endpointIdFor('group', event.groupId));
      return;

    case 'scene.created':
    case 'scene.updated':
      if (event.scene.exposeToVoice) await mirror.addScene(event.scene);
      else await mirror.remove(endpointIdFor('scene', event.scene.id));
      return;

    case 'scene.activated': {
      // A scene has no lasting "on" state, so its endpoint falls back to off and can be
      // triggered again straight away.
      const endpointId = endpointIdFor('scene', event.sceneId);
      const timer = setTimeout(() => {
        ctx.sceneTimers.delete(timer);
        void mirror.setOff(endpointId);
      }, SCENE_RESET_MS);
      ctx.sceneTimers.add(timer);
      return;
    }

    case 'scene.deleted':
      await mirror.remove(endpointIdFor('scene', event.sceneId));
      return;

    case 'hello':
    case 'hub.status':
      return;
  }
}

interface BridgedEndpointsDeps {
  aggregator: AggregatorHandle;
  deviceTypes: BridgedDeviceTypes;
  router: MatterCommandRouter;
  services: Services;
  logger: BridgeLogger;
}

/** Neutral attributes for an endpoint we know nothing about yet, e.g. an empty group. */
const NEUTRAL_ATTRIBUTES: MatterLightAttributes = Object.freeze(
  lightStateToMatterAttributes({
    power: 'off',
    brightness: 100,
    colorMode: 'white',
    hue: 0,
    saturation: 0,
    colorTemperature: 4000,
    effect: null,
    nightMode: false,
    reachable: true,
    updatedAt: new Date(0).toISOString(),
  }),
);

/** Owns the live set of bridged endpoints and the mapping back to our entities. */
class BridgedEndpoints {
  readonly #deps: BridgedEndpointsDeps;
  readonly #endpoints = new Map<string, BridgedEndpointHandle>();
  readonly #groupMembers = new Map<string, readonly string[]>();

  constructor(deps: BridgedEndpointsDeps) {
    this.#deps = deps;
  }

  get size(): number {
    return this.#endpoints.size;
  }

  async syncAll(): Promise<void> {
    for (const light of this.#deps.services.lights.list()) {
      if (light.exposeToVoice) await this.addLight(light);
    }
    await this.syncGroups();
    for (const scene of this.#deps.services.scenes.list()) {
      if (scene.exposeToVoice) await this.addScene(scene);
    }
  }

  async syncGroups(): Promise<void> {
    for (const group of this.#deps.services.groups.list()) {
      if (group.exposeToVoice) await this.addGroup(group);
    }
  }

  async addLight(light: LightWithState): Promise<void> {
    const target: BridgedTarget = {
      endpointId: endpointIdFor('light', light.id),
      uniqueId: uniqueIdFor(light.id),
      kind: 'light',
      entityId: light.id,
      name: light.name,
      profile: deviceProfileForRemoteType(light.remoteType),
    };
    await this.#upsert(target, light.state.reachable, lightStateToMatterAttributes(light.state));
  }

  async addGroup(group: Group): Promise<void> {
    const members = group.lightIds
      .map((lightId) => this.#deps.services.lights.find(lightId))
      .filter((light) => light !== undefined);
    const remoteTypes: RemoteType[] = members.map((light) => light.remoteType);
    const states: LightState[] = members.map((light) => light.state);
    const state = aggregateLightStates(states);

    const target: BridgedTarget = {
      endpointId: endpointIdFor('group', group.id),
      uniqueId: uniqueIdFor(group.id),
      kind: 'group',
      entityId: group.id,
      name: group.name,
      profile: deviceProfileForGroup(remoteTypes),
    };

    await this.#upsert(
      target,
      state?.reachable ?? true,
      state === null ? NEUTRAL_ATTRIBUTES : lightStateToMatterAttributes(state),
    );
    // Recorded after the upsert: replacing an endpoint removes the old membership.
    this.#groupMembers.set(group.id, [...group.lightIds]);
  }

  async addScene(scene: Scene): Promise<void> {
    const target: BridgedTarget = {
      endpointId: endpointIdFor('scene', scene.id),
      uniqueId: uniqueIdFor(scene.id),
      kind: 'scene',
      entityId: scene.id,
      name: scene.name,
      profile: SCENE_PROFILE,
    };
    await this.#upsert(target, true, null);
  }

  async remove(endpointId: string): Promise<void> {
    const endpoint = this.#endpoints.get(endpointId);
    const target = this.#deps.router.target(endpointId);
    if (target?.kind === 'group') this.#groupMembers.delete(target.entityId);
    this.#endpoints.delete(endpointId);
    this.#deps.router.unregister(endpointId);
    if (endpoint === undefined) return;
    try {
      await endpoint.delete();
    } catch (error) {
      this.#deps.logger.warn('Matter bridge could not remove an endpoint', {
        endpointId,
        error: describeError(error),
      });
    }
  }

  async pushLight(lightId: string): Promise<void> {
    await this.#push(endpointIdFor('light', lightId));
  }

  async pushGroupsContaining(lightId: string): Promise<void> {
    for (const [groupId, members] of this.#groupMembers) {
      if (members.includes(lightId)) await this.#push(endpointIdFor('group', groupId));
    }
  }

  async setOff(endpointId: string): Promise<void> {
    const endpoint = this.#endpoints.get(endpointId);
    if (endpoint === undefined) return;
    await this.#write(endpoint, 'onOff', { onOff: false });
  }

  async #upsert(
    target: BridgedTarget,
    reachable: boolean,
    attributes: MatterLightAttributes | null,
  ): Promise<void> {
    const existing = this.#endpoints.get(target.endpointId);
    if (existing !== undefined) {
      const previous = this.#deps.router.target(target.endpointId);
      // The device type is baked into an endpoint at construction: a rename or a state
      // change is a patch, but a capability change means replacing the endpoint.
      if (previous?.profile.kind === target.profile.kind) {
        this.#deps.router.register(target);
        await this.#write(existing, 'bridgedDeviceBasicInformation', {
          nodeLabel: target.name,
          reachable,
        });
        if (attributes !== null) await this.#push(target.endpointId, attributes);
        return;
      }
      await this.remove(target.endpointId);
    }

    this.#deps.router.register(target);
    const options = bridgedEndpointOptions({
      target,
      nodeLabel: target.name,
      reachable,
      attributes,
    });

    try {
      const endpoint = await this.#deps.aggregator.add(this.#typeFor(target), options);
      this.#endpoints.set(target.endpointId, endpoint as BridgedEndpointHandle);
    } catch (error) {
      this.#deps.router.unregister(target.endpointId);
      this.#deps.logger.error('Matter bridge could not add an endpoint', {
        endpointId: target.endpointId,
        error: describeError(error),
      });
    }
  }

  #typeFor(target: BridgedTarget): EndpointType {
    switch (target.profile.kind) {
      case 'extendedColor':
        return this.#deps.deviceTypes.extendedColor;
      case 'colorTemperature':
        return this.#deps.deviceTypes.colorTemperature;
      case 'dimmable':
        return this.#deps.deviceTypes.dimmable;
      case 'onOff':
        return this.#deps.deviceTypes.onOff;
    }
  }

  async #push(endpointId: string, attributes?: MatterLightAttributes): Promise<void> {
    const endpoint = this.#endpoints.get(endpointId);
    const target = this.#deps.router.target(endpointId);
    if (endpoint === undefined || target === undefined || target.kind === 'scene') return;

    const state = this.#deps.router.stateOf(target);
    const next = attributes ?? (state === null ? null : lightStateToMatterAttributes(state));
    if (next === null) return;

    for (const patch of bridgedStatePatch(target, next)) {
      await this.#write(endpoint, patch.behavior, patch.values);
    }
    if (state !== null) {
      await this.#write(endpoint, 'bridgedDeviceBasicInformation', { reachable: state.reachable });
    }
  }

  /** A rejected attribute write must never escalate: the light itself still works. */
  async #write(
    endpoint: BridgedEndpointHandle,
    behavior: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    try {
      await endpoint.setStateOf(behavior, values);
    } catch (error) {
      this.#deps.logger.warn('Matter bridge could not update an attribute', {
        endpointId: endpoint.id,
        behavior,
        error: describeError(error),
      });
    }
  }
}
