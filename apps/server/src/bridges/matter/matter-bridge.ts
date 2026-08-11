import type { BridgeStatus } from '@milight-studio/shared';

import type { AppConfig } from '../../config.js';
import type { Services } from '../../container.js';
import { noopLogger, type BridgeLogger, type VoiceBridge } from '../types.js';

export interface MatterBridgeDeps {
  config: AppConfig;
  services: Services;
  logger?: BridgeLogger;
}

/**
 * Matter bridge — the recommended way to reach Alexa.
 *
 * Every exposed light, group and scene is published as a bridged endpoint on a Matter
 * aggregator, which gives Alexa full colour and colour-temperature control with no
 * cloud account, no AWS Lambda and no subscription. Requires a Matter-capable Echo.
 *
 * The heavy `@matter/main` runtime is imported lazily so that neither the test suite nor
 * an installation that leaves the bridge disabled pays for loading it.
 */
export class MatterBridge implements VoiceBridge {
  readonly name = 'matter';
  readonly #config: AppConfig;
  readonly #services: Services;
  readonly #logger: BridgeLogger;
  #runtime: { stop: () => Promise<void>; detail: string } | null = null;
  #detail: string | null = null;

  constructor(deps: MatterBridgeDeps) {
    this.#config = deps.config;
    this.#services = deps.services;
    this.#logger = deps.logger ?? noopLogger;
  }

  get enabled(): boolean {
    return this.#config.MATTER_BRIDGE_ENABLED;
  }

  async start(): Promise<void> {
    if (this.#runtime !== null) return;
    const { startMatterRuntime } = await import('./matter-runtime.js');
    this.#runtime = await startMatterRuntime({
      config: this.#config,
      services: this.#services,
      logger: this.#logger,
    });
    this.#detail = this.#runtime.detail;
    this.#logger.info(this.#detail);
  }

  async stop(): Promise<void> {
    const runtime = this.#runtime;
    this.#runtime = null;
    this.#detail = null;
    if (runtime === null) return;
    await runtime.stop();
  }

  status(): BridgeStatus {
    return {
      name: this.name,
      enabled: this.enabled,
      running: this.#runtime !== null,
      detail: this.#detail,
    };
  }
}

export function createMatterBridge(deps: MatterBridgeDeps): VoiceBridge {
  return new MatterBridge(deps);
}
