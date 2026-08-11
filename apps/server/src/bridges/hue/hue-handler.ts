import type { LightCommand } from '@milight-studio/shared';

import {
  buildHueTargets,
  hueStateToCommand,
  hueSuccessResponse,
  toHueLight,
  type BuildTargetsInput,
  type HueTarget,
} from './hue-model.js';

export interface HueHandlerDeps {
  bridgeId: string;
  /** LAN address Alexa should talk to, e.g. `192.168.1.10`. */
  address: string;
  port: number;
  snapshot: () => BuildTargetsInput;
  applyToLight: (id: string, command: LightCommand) => Promise<void>;
  applyToGroup: (id: string, command: LightCommand) => Promise<void>;
  activateScene: (id: string) => Promise<void>;
  now?: () => Date;
}

export interface HueResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const json = (status: number, payload: unknown): HueResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const xml = (body: string): HueResponse => ({
  status: 200,
  headers: { 'content-type': 'application/xml' },
  body,
});

/** The UPnP document that makes Alexa believe we are a 2015 Hue bridge. */
export function describeBridge(bridgeId: string, address: string, port: number): string {
  const uuid = `2f402f80-da50-11e1-9b23-${bridgeId.slice(0, 12).toLowerCase()}`;
  return `<?xml version="1.0" encoding="UTF-8" ?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <URLBase>http://${address}:${port}/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>
    <friendlyName>Milight Studio (${address})</friendlyName>
    <manufacturer>Royal Philips Electronics</manufacturer>
    <manufacturerURL>http://www.philips.com</manufacturerURL>
    <modelDescription>Philips hue Personal Wireless Lighting</modelDescription>
    <modelName>Philips hue bridge 2015</modelName>
    <modelNumber>BSB002</modelNumber>
    <modelURL>http://www.meethue.com</modelURL>
    <serialNumber>${bridgeId.toLowerCase()}</serialNumber>
    <UDN>uuid:${uuid}</UDN>
    <presentationURL>index.html</presentationURL>
  </device>
</root>`;
}

function bridgeConfig(bridgeId: string, address: string): Record<string, unknown> {
  const mac = bridgeId
    .slice(0, 12)
    .replace(/(..)(?=.)/g, '$1:')
    .toLowerCase();
  return {
    name: 'Milight Studio',
    datastoreversion: '104',
    swversion: '1948086000',
    apiversion: '1.48.0',
    mac,
    bridgeid: bridgeId,
    factorynew: false,
    replacesbridgeid: null,
    modelid: 'BSB002',
    starterkitid: '',
    ipaddress: address,
    linkbutton: true,
    dhcp: true,
  };
}

/**
 * Pure request handler for the emulated Hue API.
 *
 * Keeping it free of sockets means the whole Alexa-facing contract can be unit tested:
 * `handle('GET', '/api/anything/lights')` in, JSON out.
 */
export function createHueHandler(deps: HueHandlerDeps) {
  const findTarget = (targets: HueTarget[], hueId: string): HueTarget | undefined =>
    targets.find((target) => target.hueId === hueId);

  const lightsPayload = (targets: HueTarget[]): Record<string, unknown> =>
    Object.fromEntries(targets.map((target) => [target.hueId, toHueLight(target, deps.bridgeId)]));

  async function apply(target: HueTarget, body: Record<string, unknown>): Promise<HueResponse> {
    if (target.kind === 'scene') {
      // A scene has no "off"; turning it on runs it.
      if (body.on === true) await deps.activateScene(target.id);
      return json(200, hueSuccessResponse(target.hueId, body));
    }

    const command: LightCommand | null = hueStateToCommand(body, target.state ?? undefined);
    if (command === null) return json(200, []);

    if (target.kind === 'light') await deps.applyToLight(target.id, command);
    else await deps.applyToGroup(target.id, command);

    return json(200, hueSuccessResponse(target.hueId, body));
  }

  return async function handle(method: string, rawUrl: string, body?: unknown): Promise<HueResponse> {
    const url = rawUrl.split('?')[0] ?? '/';
    const segments = url.split('/').filter((segment) => segment.length > 0);

    if (url === '/description.xml') {
      return xml(describeBridge(deps.bridgeId, deps.address, deps.port));
    }

    if (segments[0] !== 'api') {
      return json(404, [{ error: { type: 3, address: url, description: 'resource not available' } }]);
    }

    // `POST /api` — Alexa never presses a link button, so pairing always succeeds.
    if (method === 'POST' && segments.length === 1) {
      return json(200, [{ success: { username: 'milight-studio-user' } }]);
    }

    // `GET /api/config` is fetched unauthenticated during discovery.
    if (segments.length === 2 && segments[1] === 'config') {
      return json(200, bridgeConfig(deps.bridgeId, deps.address));
    }

    const targets = buildHueTargets(deps.snapshot());
    const resource = segments[2];

    if (segments.length === 2) {
      return json(200, {
        lights: lightsPayload(targets),
        groups: {},
        config: bridgeConfig(deps.bridgeId, deps.address),
        schedules: {},
        scenes: {},
        rules: {},
        sensors: {},
      });
    }

    if (resource === 'config') {
      return json(200, bridgeConfig(deps.bridgeId, deps.address));
    }

    if (resource === 'lights') {
      if (segments.length === 3) return json(200, lightsPayload(targets));

      const hueId = segments[3] ?? '';
      const target = findTarget(targets, hueId);
      if (target === undefined) {
        return json(404, [
          {
            error: { type: 3, address: `/lights/${hueId}`, description: 'resource, /lights, not available' },
          },
        ]);
      }

      if (segments.length === 4 && method === 'GET') {
        return json(200, toHueLight(target, deps.bridgeId));
      }

      if (segments[4] === 'state' && (method === 'PUT' || method === 'POST')) {
        const payload = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
        return apply(target, payload);
      }
    }

    if (resource === 'groups') {
      // Alexa does not discover Hue groups; publishing only group 0 keeps apps happy.
      if (segments.length === 3) return json(200, {});
      if (segments[3] === '0') {
        return json(200, {
          name: 'Group 0',
          lights: targets.map((target) => target.hueId),
          type: 'LightGroup',
          action: { on: false },
        });
      }
    }

    if (resource === 'scenes' || resource === 'schedules' || resource === 'rules' || resource === 'sensors') {
      return json(200, {});
    }

    return json(404, [{ error: { type: 3, address: url, description: 'resource not available' } }]);
  };
}

export type HueHandler = ReturnType<typeof createHueHandler>;
