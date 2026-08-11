import { MilightHubResponseError, MilightHubUnreachableError } from './errors.js';
import { SerialQueue } from './queue.js';
import type { HubAbout, HubAddress, HubAliasList, HubCommandBody, HubGroupState } from './types.js';

export interface MilightHubClientOptions {
  /** Base URL of the hub, e.g. `http://192.168.1.42`. */
  baseUrl: string;
  /** Abort a single attempt after this many milliseconds. */
  timeoutMs?: number;
  /** Number of *extra* attempts after the first one fails retryably. */
  retries?: number;
  /** Base delay for exponential backoff between retries. */
  retryDelayMs?: number;
  /** Minimum gap between hub requests; the ESP8266 drops packets when hammered. */
  minRequestGapMs?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 5xx and 429 are worth retrying; 4xx means we sent something wrong. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

export interface HubRequestOptions {
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the serial queue — only for health probes that must not queue behind commands. */
  bypassQueue?: boolean;
}

/**
 * Typed client for the `esp8266_milight_hub` REST API.
 *
 * All calls are funnelled through a serial queue with a configurable minimum gap,
 * retried with exponential backoff on transient failures, and translated into
 * `MilightHubError`s so callers never see raw fetch failures.
 */
export class MilightHubClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #retryDelayMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #queue: SerialQueue;

  constructor(options: MilightHubClientOptions) {
    this.#baseUrl = stripTrailingSlash(options.baseUrl);
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#retries = options.retries ?? 2;
    this.#retryDelayMs = options.retryDelayMs ?? 150;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sleep = options.sleep ?? defaultSleep;
    this.#queue = new SerialQueue({
      minGapMs: options.minRequestGapMs ?? 40,
      sleep: this.#sleep,
    });
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  get pendingRequests(): number {
    return this.#queue.pending;
  }

  async request<T>(path: string, options: HubRequestOptions = {}): Promise<T> {
    const task = (): Promise<T> => this.#attempt<T>(path, options);
    return options.bypassQueue === true ? task() : this.#queue.run(task);
  }

  async #attempt<T>(path: string, options: HubRequestOptions): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const method = options.method ?? 'GET';
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      if (attempt > 0) await this.#sleep(this.#retryDelayMs * 2 ** (attempt - 1));

      const timeout = AbortSignal.timeout(this.#timeoutMs);
      const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);

      let response: Response;
      try {
        response = await this.#fetch(url, {
          method,
          signal,
          headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (cause) {
        lastError = new MilightHubUnreachableError(
          `Could not reach the Milight hub at ${url} (${method})`,
          cause,
        );
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new MilightHubResponseError(
          `Milight hub responded ${response.status} to ${method} ${path}`,
          response.status,
          text,
        );
        if (isRetryableStatus(response.status)) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const text = await response.text();
      if (text.length === 0) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        // Several hub endpoints answer with a bare "true"/"success" string.
        return text as unknown as T;
      }
    }

    throw lastError;
  }

  #addressPath({ deviceId, remoteType, groupId }: HubAddress): string {
    return `/gateways/${encodeURIComponent(deviceId)}/${encodeURIComponent(remoteType)}/${groupId}`;
  }

  /** `GET /about` — also doubles as the reachability probe. */
  async about(signal?: AbortSignal): Promise<HubAbout> {
    return this.request<HubAbout>('/about', { bypassQueue: true, ...(signal ? { signal } : {}) });
  }

  async ping(signal?: AbortSignal): Promise<boolean> {
    try {
      await this.about(signal);
      return true;
    } catch {
      return false;
    }
  }

  async getState(address: HubAddress, signal?: AbortSignal): Promise<HubGroupState> {
    return this.request<HubGroupState>(this.#addressPath(address), {
      ...(signal ? { signal } : {}),
    });
  }

  async sendCommand(address: HubAddress, body: HubCommandBody, signal?: AbortSignal): Promise<void> {
    await this.request<unknown>(this.#addressPath(address), {
      method: 'PUT',
      body,
      ...(signal ? { signal } : {}),
    });
  }

  async pair(address: HubAddress): Promise<void> {
    await this.sendCommand(address, { commands: ['pair'] });
  }

  async unpair(address: HubAddress): Promise<void> {
    await this.sendCommand(address, { commands: ['unpair'] });
  }

  /** `DELETE /gateways/...` clears the hub's cached state for an address. */
  async forgetState(address: HubAddress): Promise<void> {
    await this.request<unknown>(this.#addressPath(address), { method: 'DELETE' });
  }

  async listAliases(): Promise<HubAliasList> {
    return this.request<HubAliasList>('/aliases');
  }

  async remoteConfigs(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/remote_configs');
  }

  /** Wait until every queued command has been flushed to the hub. */
  async drain(): Promise<void> {
    await this.#queue.drain();
  }
}
