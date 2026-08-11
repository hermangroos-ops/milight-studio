import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface HubRequestRecord {
  method: string;
  /** Path without the query string. */
  path: string;
  query: string;
  /** Parsed JSON body, or the raw string when it was not JSON, or undefined. */
  body: unknown;
  /** Monotonic sequence number, so tests can assert ordering without clocks. */
  sequence: number;
}

export interface HubReply {
  status?: number;
  /** Serialised as JSON unless it is already a string. */
  body?: unknown;
  /** Number of event-loop turns to wait before answering. Keeps tests time-free. */
  yields?: number;
}

export type HubResponder = (request: HubRequestRecord) => HubReply | Promise<HubReply>;

/** Yield the event loop `count` times without touching the clock. */
export async function tick(count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const defaultReply = (request: HubRequestRecord): HubReply => {
  if (request.path === '/about') return { body: { firmware: '1.11.0', version: '1.11.0' } };
  if (request.path === '/aliases') return { body: { aliases: [], count: 0 } };
  if (request.path === '/remote_configs') return { body: { rgb_cct: { num_groups: 4 } } };
  if (request.path.startsWith('/gateways/')) {
    if (request.method === 'GET') return { body: { state: 'ON', level: 50, bulb_mode: 'white' } };
    return { body: { success: true } };
  }
  return { status: 404, body: { error: 'not found' } };
};

/**
 * A real HTTP server that behaves like an `esp8266_milight_hub`.
 *
 * Every request is recorded, in-flight requests are counted so a test can prove the
 * client never overlaps them, and a test can script per-request replies and failures.
 */
export class FakeMilightHubServer {
  readonly requests: HubRequestRecord[] = [];
  /** Highest number of requests that were ever in flight at the same time. */
  maxInFlight = 0;

  #server: Server | null = null;
  #port = 0;
  #inFlight = 0;
  #sequence = 0;
  #responder: HubResponder = defaultReply;
  /** Number of yields every response waits before being written. */
  responseYields = 0;

  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  get running(): boolean {
    return this.#server !== null;
  }

  /** Requests filtered down to the gateway PUTs a command produces. */
  get commands(): { path: string; body: unknown }[] {
    return this.requests
      .filter((request) => request.method === 'PUT' && request.path.startsWith('/gateways/'))
      .map((request) => ({ path: request.path, body: request.body }));
  }

  respondWith(responder: HubResponder): void {
    this.#responder = responder;
  }

  /** Fail the next `count` requests with `status`, then fall back to the default. */
  failTimes(count: number, status = 500): void {
    let remaining = count;
    this.#responder = (request) => {
      if (remaining > 0) {
        remaining -= 1;
        return { status, body: { error: 'temporarily broken' } };
      }
      return defaultReply(request);
    };
  }

  reset(): void {
    this.requests.length = 0;
    this.maxInFlight = 0;
    this.#responder = defaultReply;
    this.responseYields = 0;
  }

  async start(): Promise<string> {
    if (this.#server !== null) return this.baseUrl;

    const server = createServer((request, response) => {
      this.#handle(request, response).catch(() => {
        response.writeHead(500).end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.#server = server;
    this.#port = (server.address() as AddressInfo).port;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server === null) return;
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);

    const raw = Buffer.concat(chunks).toString('utf8');
    const [path = '/', query = ''] = (request.url ?? '/').split('?');
    this.#sequence += 1;

    let parsed: unknown;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    const record: HubRequestRecord = {
      method: request.method ?? 'GET',
      path,
      query,
      body: parsed,
      sequence: this.#sequence,
    };
    this.requests.push(record);

    this.#inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.#inFlight);
    try {
      const reply = await this.#responder(record);
      await tick(reply.yields ?? this.responseYields);
      const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
      response.writeHead(reply.status ?? 200, { 'content-type': 'application/json' }).end(payload);
    } finally {
      this.#inFlight -= 1;
    }
  }
}
