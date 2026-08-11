import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

import type { BridgeLogger } from '../types.js';

export const SSDP_PORT = 1900;
export const SSDP_MULTICAST = '239.255.255.250';

/** Pick the first non-internal IPv4 address; that is what Alexa must talk to. */
export function detectLanAddress(interfaces = networkInterfaces()): string {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

/**
 * Derive a Philips-looking bridge id from the MAC address.
 * Real bridges use `<first 6 MAC bytes>FFFE<last 6>`, uppercase.
 */
export function deriveBridgeId(interfaces = networkInterfaces()): string {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') {
        const mac = entry.mac.replaceAll(':', '').toUpperCase();
        return `${mac.slice(0, 6)}FFFE${mac.slice(6)}`;
      }
    }
  }
  return '001788FFFE000001';
}

/** The search targets an Echo uses when hunting for a Hue bridge. */
const MATCHING_TARGETS = [
  'ssdp:all',
  'upnp:rootdevice',
  'urn:schemas-upnp-org:device:basic:1',
  'urn:schemas-upnp-org:device:Basic:1',
  'libhue:idl',
];

export function shouldRespond(message: string): boolean {
  if (!message.startsWith('M-SEARCH')) return false;
  const target = /\bST:\s*(.+)\r?\n/i.exec(message)?.[1]?.trim();
  if (target === undefined) return false;
  return MATCHING_TARGETS.some((candidate) => candidate.toLowerCase() === target.toLowerCase());
}

export function buildSearchResponse(address: string, port: number, bridgeId: string): string {
  const uuid = `2f402f80-da50-11e1-9b23-${bridgeId.slice(0, 12).toLowerCase()}`;
  return [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=100',
    'EXT:',
    `LOCATION: http://${address}:${port}/description.xml`,
    'SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.48.0',
    `hue-bridgeid: ${bridgeId}`,
    'ST: urn:schemas-upnp-org:device:basic:1',
    `USN: uuid:${uuid}`,
    '',
    '',
  ].join('\r\n');
}

export interface SsdpResponderOptions {
  address: string;
  port: number;
  bridgeId: string;
  logger: BridgeLogger;
}

/**
 * Answers the multicast discovery packets Echo devices send. Deliberately answer-only:
 * we do not spam NOTIFY announcements, which keeps the LAN quiet and is enough for
 * Alexa's "discover devices" flow.
 */
export class SsdpResponder {
  readonly #options: SsdpResponderOptions;
  #socket: Socket | null = null;

  constructor(options: SsdpResponderOptions) {
    this.#options = options;
  }

  get running(): boolean {
    return this.#socket !== null;
  }

  start(): Promise<void> {
    if (this.#socket !== null) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (error) => {
        this.#options.logger.error('SSDP socket error', { error: error.message });
        socket.close();
        this.#socket = null;
        reject(error);
      });

      socket.on('message', (buffer, remote) => {
        const message = buffer.toString('utf8');
        if (!shouldRespond(message)) return;
        const response = Buffer.from(
          buildSearchResponse(this.#options.address, this.#options.port, this.#options.bridgeId),
        );
        socket.send(response, remote.port, remote.address, (error) => {
          if (error) this.#options.logger.warn('Failed to answer SSDP search', { error: error.message });
        });
      });

      socket.bind(SSDP_PORT, () => {
        try {
          socket.addMembership(SSDP_MULTICAST);
        } catch (error) {
          this.#options.logger.warn('Could not join the SSDP multicast group', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        socket.unref();
        this.#socket = socket;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    const socket = this.#socket;
    this.#socket = null;
    if (socket === null) return Promise.resolve();
    return new Promise((resolve) => {
      socket.close(() => {
        resolve();
      });
    });
  }
}
