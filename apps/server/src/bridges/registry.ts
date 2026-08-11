import type { BridgeStatus } from '@milight-studio/shared';

import { noopLogger, type BridgeLogger, type VoiceBridge } from './types.js';

/**
 * Owns the lifecycle of every bridge. Starting and stopping is best effort: one broken
 * bridge must not prevent the others — or the API itself — from coming up.
 */
export class BridgeRegistry {
  readonly #bridges: VoiceBridge[];
  readonly #logger: BridgeLogger;

  constructor(bridges: VoiceBridge[] = [], logger: BridgeLogger = noopLogger) {
    this.#bridges = bridges;
    this.#logger = logger;
  }

  get bridges(): readonly VoiceBridge[] {
    return this.#bridges;
  }

  add(bridge: VoiceBridge): void {
    this.#bridges.push(bridge);
  }

  async startAll(): Promise<void> {
    for (const bridge of this.#bridges) {
      if (!bridge.enabled) continue;
      try {
        await bridge.start();
        this.#logger.info(`Bridge '${bridge.name}' started`);
      } catch (error) {
        this.#logger.error(`Bridge '${bridge.name}' failed to start`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const bridge of this.#bridges) {
      try {
        await bridge.stop();
      } catch (error) {
        this.#logger.warn(`Bridge '${bridge.name}' failed to stop cleanly`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  statuses(): BridgeStatus[] {
    return this.#bridges.map((bridge) => bridge.status());
  }
}
