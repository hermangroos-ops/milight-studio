import type { LightCommand, LightState, PowerState } from '@milight-studio/shared';

import type { Services } from '../../container.js';
import type { BridgeLogger } from '../types.js';
import {
  aggregateLightStates,
  levelToBrightness,
  matterHueToDegrees,
  matterSaturationToPercent,
  miredsToKelvin,
  transitionTimeToMs,
} from './attribute-mapping.js';
import {
  brightnessCommand,
  colorCommand,
  colorTemperatureCommand,
  powerCommand,
  withTransition,
  type BridgedEntityKind,
  type MatterDeviceProfile,
} from './device-mapping.js';

export interface BridgedTarget {
  readonly endpointId: string;
  /** Stable BridgedDeviceBasicInformation.uniqueId, derived from `entityId`. */
  readonly uniqueId: string;
  readonly kind: BridgedEntityKind;
  readonly entityId: string;
  readonly name: string;
  readonly profile: MatterDeviceProfile;
}

/**
 * Translates Matter cluster commands into hub commands.
 *
 * Two rules shape this class:
 *
 * 1. It never throws and never returns a rejected promise to matter.js. An unreachable
 *    hub must show up as a log line, not as a crashed Matter node — the bridge is
 *    strictly optional infrastructure.
 * 2. Work is queued per endpoint and dispatched in the background. Awaiting the hub
 *    inside a cluster command would hold the Matter transaction open for as long as the
 *    hub takes to answer (retries included), which makes Alexa report a timeout even
 *    though the light did turn on.
 *
 * It deliberately knows nothing about `@matter/main` so it can be exercised directly.
 */
export class MatterCommandRouter {
  readonly #services: Services;
  readonly #logger: BridgeLogger;
  readonly #targets = new Map<string, BridgedTarget>();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(services: Services, logger: BridgeLogger) {
    this.#services = services;
    this.#logger = logger;
  }

  register(target: BridgedTarget): void {
    this.#targets.set(target.endpointId, target);
  }

  unregister(endpointId: string): void {
    this.#targets.delete(endpointId);
    this.#queues.delete(endpointId);
  }

  target(endpointId: string): BridgedTarget | undefined {
    return this.#targets.get(endpointId);
  }

  /** Resolve the state Alexa should see for a bridged endpoint, if we know it. */
  currentState(endpointId: string): LightState | null {
    const target = this.#targets.get(endpointId);
    if (target === undefined) return null;
    return this.stateOf(target);
  }

  stateOf(target: BridgedTarget): LightState | null {
    if (target.kind === 'light') {
      return this.#services.lights.find(target.entityId)?.state ?? null;
    }
    if (target.kind === 'group') {
      const group = this.#services.groups.list().find((entry) => entry.id === target.entityId);
      if (group === undefined) return null;
      const states = group.lightIds
        .map((lightId) => this.#services.lights.find(lightId)?.state)
        .filter((state): state is LightState => state !== undefined);
      return aggregateLightStates(states);
    }
    return null;
  }

  setPower(endpointId: string, desired: PowerState): void {
    const target = this.#targets.get(endpointId);
    if (target === undefined) return;

    if (target.kind === 'scene') {
      // A scene has no "off": switching it off is how the endpoint arms itself again.
      if (desired === 'on') this.#run(target, () => this.#services.scenes.activate(target.entityId));
      return;
    }

    const current = this.stateOf(target)?.power ?? 'off';
    this.#send(target, powerCommand(target.profile, desired, current));
  }

  setLevel(endpointId: string, level: number, transitionTime: number | null | undefined): void {
    const target = this.#targets.get(endpointId);
    if (target === undefined) return;

    const current = this.stateOf(target)?.brightness ?? 0;
    const command = brightnessCommand(target.profile, levelToBrightness(level), current);
    this.#send(target, command, transitionTime);
  }

  setHueSaturation(
    endpointId: string,
    hue: number | null,
    saturation: number | null,
    transitionTime: number | null | undefined,
  ): void {
    const target = this.#targets.get(endpointId);
    if (target === undefined) return;

    const command = colorCommand(
      target.profile,
      hue === null ? null : matterHueToDegrees(hue),
      saturation === null ? null : matterSaturationToPercent(saturation),
    );
    this.#send(target, command, transitionTime);
  }

  /** Hue and saturation already in domain units, used by the x/y command path. */
  setHueSaturationDegrees(
    endpointId: string,
    hue: number,
    saturationPercent: number,
    transitionTime: number | null | undefined,
  ): void {
    const target = this.#targets.get(endpointId);
    if (target === undefined) return;

    this.#send(target, colorCommand(target.profile, hue, saturationPercent), transitionTime);
  }

  setColorTemperature(endpointId: string, mireds: number, transitionTime: number | null | undefined): void {
    const target = this.#targets.get(endpointId);
    if (target === undefined) return;

    const command = colorTemperatureCommand(target.profile, miredsToKelvin(mireds));
    this.#send(target, command, transitionTime);
  }

  /** Resolves once every queued hub call has settled; used for an orderly shutdown. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#queues.values()]);
  }

  #send(target: BridgedTarget, command: LightCommand | null, transitionTime?: number | null): void {
    if (command === null) {
      this.#logger.info(`Matter: '${target.name}' cannot perform this command, ignoring it`, {
        endpointId: target.endpointId,
      });
      return;
    }

    const full = withTransition(command, transitionTimeToMs(transitionTime));
    this.#run(target, () =>
      target.kind === 'group'
        ? this.#services.groups.command(target.entityId, full)
        : this.#services.lights.command(target.entityId, full),
    );
  }

  /**
   * Serialise per endpoint: two `moveToHue`/`moveToSaturation` commands arriving back to
   * back must reach the hub in that order, and the hub itself dislikes overlapping
   * requests to the same address.
   */
  #run(target: BridgedTarget, action: () => Promise<unknown>): void {
    const previous = this.#queues.get(target.endpointId) ?? Promise.resolve();
    const next = previous.then(action).then(
      () => undefined,
      (error: unknown) => {
        this.#logger.warn(`Matter: command for '${target.name}' failed`, {
          endpointId: target.endpointId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    this.#queues.set(target.endpointId, next);
  }
}
