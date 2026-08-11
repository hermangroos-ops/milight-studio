import type {
  HubAbout,
  HubAddress,
  HubAliasList,
  HubCommandBody,
  HubGroupState,
  MilightHubClient,
} from '@milight-studio/milight-client';

import type { Clock } from '../../src/domain/light-service.js';

/** A clock that only moves when a test tells it to. */
export class FakeClock implements Clock {
  #current: number;

  constructor(start: string | number | Date = '2024-01-01T00:00:00.000Z') {
    this.#current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.#current);
  }

  iso(): string {
    return this.now().toISOString();
  }

  advance(ms: number): void {
    this.#current += ms;
  }
}

/**
 * Deterministic, schema-valid uuids. The shared schemas insist on a real uuid, so the
 * counter is padded into the node field of an otherwise fixed v4 layout.
 */
export function sequentialIds(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
  };
}

export function idAt(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

/** A uuid that is well formed but will never be handed out by `sequentialIds`. */
export const MISSING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

export type HubCallKind = 'about' | 'getState' | 'sendCommand' | 'pair' | 'unpair' | 'forgetState';

export interface HubCall {
  kind: HubCallKind;
  address?: HubAddress;
  body?: HubCommandBody;
}

/**
 * An in-process stand-in for `MilightHubClient`.
 *
 * Only the surface the domain services actually touch is implemented; everything else
 * would be dead weight. Failures are injected per call kind so a test can make exactly
 * one operation fail.
 */
export class FakeHub {
  readonly calls: HubCall[] = [];
  readonly baseUrl = 'http://fake-hub.local';

  /** When set, every call rejects with this error. */
  failWith: Error | null = null;
  /** When set, only calls of these kinds reject. */
  failKinds: HubCallKind[] | null = null;
  /** Reject only when the address matches this predicate. */
  failWhen: ((address: HubAddress | undefined) => boolean) | null = null;

  aboutPayload: HubAbout = { firmware: '1.11.0' };
  state: HubGroupState = { state: 'ON', level: 50, bulb_mode: 'white' };
  aliases: HubAliasList = { aliases: [] };

  get client(): MilightHubClient {
    return this as unknown as MilightHubClient;
  }

  get commands(): { address: HubAddress; body: HubCommandBody }[] {
    return this.calls
      .filter((call) => call.kind === 'sendCommand')
      .map((call) => ({ address: call.address!, body: call.body! }));
  }

  reset(): void {
    this.calls.length = 0;
    this.failWith = null;
    this.failKinds = null;
    this.failWhen = null;
  }

  #record<T>(kind: HubCallKind, value: T, address?: HubAddress, body?: HubCommandBody): Promise<T> {
    this.calls.push({ kind, ...(address ? { address } : {}), ...(body ? { body } : {}) });
    const kindMatches = this.failKinds === null || this.failKinds.includes(kind);
    const addressMatches = this.failWhen === null || this.failWhen(address);
    if (this.failWith !== null && kindMatches && addressMatches) {
      // Tests deliberately inject non-Error rejections too; the cast keeps the lint rule
      // honest without changing what actually travels down the promise.
      return Promise.reject(this.failWith);
    }
    return Promise.resolve(value);
  }

  about(): Promise<HubAbout> {
    return this.#record('about', this.aboutPayload);
  }

  getState(address: HubAddress): Promise<HubGroupState> {
    return this.#record('getState', this.state, address);
  }

  sendCommand(address: HubAddress, body: HubCommandBody): Promise<void> {
    return this.#record('sendCommand', undefined, address, body);
  }

  pair(address: HubAddress): Promise<void> {
    return this.#record('pair', undefined, address);
  }

  unpair(address: HubAddress): Promise<void> {
    return this.#record('unpair', undefined, address);
  }

  forgetState(address: HubAddress): Promise<void> {
    return this.#record('forgetState', undefined, address);
  }

  listAliases(): Promise<HubAliasList> {
    return this.#record('about', this.aliases);
  }

  ping(): Promise<boolean> {
    return this.about().then(
      () => true,
      () => false,
    );
  }

  drain(): Promise<void> {
    return Promise.resolve();
  }
}

/** Some code paths only trigger on a rejection that is not an Error at all. */
export const notAnError = (value: unknown): Error => value as Error;

/** Collect every event a bus emits, for order-sensitive assertions. */
export function recordEvents<T>(subscribe: (listener: (event: T) => void) => () => void): {
  events: T[];
  stop: () => void;
} {
  const events: T[] = [];
  const stop = subscribe((event) => events.push(event));
  return { events, stop };
}
