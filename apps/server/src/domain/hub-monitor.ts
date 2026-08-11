import type { MilightHubClient } from '@milight-studio/milight-client';

import type { EventBus } from './event-bus.js';
import type { Clock } from './light-service.js';
import { systemClock } from './light-service.js';

export interface HubStatus {
  reachable: boolean;
  version: string | null;
  checkedAt: string | null;
}

export interface HubMonitorDeps {
  hub: MilightHubClient;
  events: EventBus;
  intervalMs?: number;
  clock?: Clock;
}

/**
 * Background reachability probe.
 *
 * Runs on an unref'd timer so it never keeps the process alive, and only emits an
 * event when the reachability actually flips — a poll every 30s should not produce
 * a WebSocket message every 30s.
 */
export class HubMonitor {
  readonly #hub: MilightHubClient;
  readonly #events: EventBus;
  readonly #intervalMs: number;
  readonly #clock: Clock;
  #timer: ReturnType<typeof setInterval> | null = null;
  #status: HubStatus = { reachable: false, version: null, checkedAt: null };

  constructor(deps: HubMonitorDeps) {
    this.#hub = deps.hub;
    this.#events = deps.events;
    this.#intervalMs = deps.intervalMs ?? 30_000;
    this.#clock = deps.clock ?? systemClock;
  }

  get status(): HubStatus {
    return this.#status;
  }

  async check(): Promise<HubStatus> {
    const checkedAt = this.#clock.now().toISOString();
    let reachable = false;
    let version: string | null = null;

    try {
      const about = await this.#hub.about();
      reachable = true;
      version = about.firmware ?? about.version ?? null;
    } catch {
      reachable = false;
    }

    const changed = this.#status.reachable !== reachable || this.#status.version !== version;
    this.#status = { reachable, version, checkedAt };
    if (changed) this.#events.emit({ type: 'hub.status', reachable, version, checkedAt });
    return this.#status;
  }

  start(): void {
    if (this.#timer !== null || this.#intervalMs <= 0) return;
    void this.check();
    this.#timer = setInterval(() => {
      void this.check();
    }, this.#intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }
}
