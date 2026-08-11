import { createServer, type Server } from 'node:http';

import type { BridgeStatus } from '@milight-studio/shared';

import type { AppConfig } from '../../config.js';
import type { Services } from '../../container.js';
import { noopLogger, type BridgeLogger, type VoiceBridge } from '../types.js';
import { createHueHandler, type HueHandler } from './hue-handler.js';
import { SsdpResponder, deriveBridgeId, detectLanAddress } from './ssdp.js';

export interface HueBridgeDeps {
  config: AppConfig;
  services: Services;
  logger?: BridgeLogger;
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Emulated Philips Hue bridge.
 *
 * Alexa's built-in Hue support only ever sends on/off and brightness — no colour — and
 * newer Echo models are dropping V1 bridge support altogether. This bridge therefore
 * exists as a zero-configuration fallback, not as the recommended route; use the Matter
 * bridge when you have a Matter-capable Echo. See docs/alexa.md.
 *
 * Requires port 80, which on Linux means either running as root, granting the process
 * `CAP_NET_BIND_SERVICE`, or publishing container port 80.
 */
export class HueBridge implements VoiceBridge {
  readonly name = 'hue-emulation';
  readonly #config: AppConfig;
  readonly #services: Services;
  readonly #logger: BridgeLogger;
  readonly #address: string;
  readonly #bridgeId: string;
  readonly #handler: HueHandler;
  readonly #ssdp: SsdpResponder;
  #server: Server | null = null;
  #detail: string | null = null;

  constructor(deps: HueBridgeDeps) {
    this.#config = deps.config;
    this.#services = deps.services;
    this.#logger = deps.logger ?? noopLogger;
    this.#address =
      this.#config.HUE_BRIDGE_ADDRESS.length > 0 ? this.#config.HUE_BRIDGE_ADDRESS : detectLanAddress();
    this.#bridgeId = deriveBridgeId();

    this.#handler = createHueHandler({
      bridgeId: this.#bridgeId,
      address: this.#address,
      port: this.#config.HUE_BRIDGE_PORT,
      snapshot: () => ({
        lights: this.#services.lights.list(),
        groups: this.#services.groups.list(),
        scenes: this.#services.scenes.list(),
        membersOf: (groupId) => this.#services.groups.members(groupId),
      }),
      applyToLight: async (id, command) => {
        await this.#services.lights.command(id, command);
      },
      applyToGroup: async (id, command) => {
        await this.#services.groups.command(id, command);
      },
      activateScene: async (id) => {
        await this.#services.scenes.activate(id);
      },
    });

    this.#ssdp = new SsdpResponder({
      address: this.#address,
      port: this.#config.HUE_BRIDGE_PORT,
      bridgeId: this.#bridgeId,
      logger: this.#logger,
    });
  }

  get enabled(): boolean {
    return this.#config.HUE_BRIDGE_ENABLED;
  }

  async start(): Promise<void> {
    if (this.#server !== null) return;

    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      let size = 0;

      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          response.writeHead(413).end();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });

      request.on('end', () => {
        void (async () => {
          let parsed: unknown;
          if (chunks.length > 0) {
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              parsed = undefined;
            }
          }

          try {
            const result = await this.#handler(request.method ?? 'GET', request.url ?? '/', parsed);
            response.writeHead(result.status, result.headers).end(result.body);
          } catch (error) {
            this.#logger.error('Hue bridge request failed', {
              url: request.url,
              error: error instanceof Error ? error.message : String(error),
            });
            response.writeHead(500, { 'content-type': 'application/json' }).end('[]');
          }
        })();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#config.HUE_BRIDGE_PORT, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.#server = server;
    await this.#ssdp.start();
    this.#detail = `Discoverable as a Hue bridge on ${this.#address}:${this.#config.HUE_BRIDGE_PORT}`;
    this.#logger.info(this.#detail);
  }

  async stop(): Promise<void> {
    await this.#ssdp.stop();
    const server = this.#server;
    this.#server = null;
    this.#detail = null;
    if (server === null) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  status(): BridgeStatus {
    return {
      name: this.name,
      enabled: this.enabled,
      running: this.#server !== null,
      detail: this.#detail,
    };
  }
}

export function createHueBridge(deps: HueBridgeDeps): VoiceBridge {
  return new HueBridge(deps);
}
