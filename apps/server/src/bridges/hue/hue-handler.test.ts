import {
  createDefaultLightState,
  type Group,
  type LightCommand,
  type LightWithState,
  type Scene,
} from '@milight-studio/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { createHueHandler, describeBridge, type HueHandler, type HueResponse } from './hue-handler.js';
import { buildHueTargets } from './hue-model.js';

const NOW = new Date('2024-01-01T00:00:00.000Z');
const BRIDGE_ID = '001788FFFE123456';
const ADDRESS = '192.168.1.42';
const PORT = 8080;

let counter = 0;
const uuid = (): string => {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
};

function makeLight(patch: Partial<LightWithState> = {}): LightWithState {
  return {
    id: uuid(),
    name: 'Bureau',
    room: null,
    deviceId: '0x0001',
    remoteType: 'rgb_cct',
    groupId: 1,
    exposeToVoice: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    state: createDefaultLightState(NOW),
    ...patch,
  };
}

interface Applied {
  kind: 'light' | 'group' | 'scene';
  id: string;
  command?: LightCommand;
}

interface Setup {
  handle: HueHandler;
  applied: Applied[];
  lights: LightWithState[];
  groups: Group[];
  scenes: Scene[];
  hueIdOf: (id: string) => string;
  failWith: (error: Error | null) => void;
}

function setup(): Setup {
  const applied: Applied[] = [];
  const lights: LightWithState[] = [];
  const groups: Group[] = [];
  const scenes: Scene[] = [];
  let failure: Error | null = null;

  const snapshot = (): {
    lights: LightWithState[];
    groups: Group[];
    scenes: Scene[];
    membersOf: (groupId: string) => LightWithState[];
  } => ({
    lights,
    groups,
    scenes,
    membersOf: (groupId) => {
      const group = groups.find((entry) => entry.id === groupId);
      return (group?.lightIds ?? [])
        .map((lightId) => lights.find((light) => light.id === lightId))
        .filter((light): light is LightWithState => light !== undefined);
    },
  });

  const record = (kind: Applied['kind']) => (id: string, command?: LightCommand) => {
    if (failure !== null) return Promise.reject(failure);
    applied.push({ kind, id, ...(command === undefined ? {} : { command }) });
    return Promise.resolve();
  };

  const handle = createHueHandler({
    bridgeId: BRIDGE_ID,
    address: ADDRESS,
    port: PORT,
    snapshot,
    applyToLight: record('light'),
    applyToGroup: record('group'),
    activateScene: (id) => record('scene')(id),
  });

  return {
    handle,
    applied,
    lights,
    groups,
    scenes,
    hueIdOf: (id) => buildHueTargets(snapshot()).find((target) => target.id === id)?.hueId ?? '',
    failWith: (error) => {
      failure = error;
    },
  };
}

const body = (response: HueResponse): unknown => JSON.parse(response.body);

let ctx: Setup;

beforeEach(() => {
  ctx = setup();
});

describe('describeBridge', () => {
  const xml = describeBridge(BRIDGE_ID, ADDRESS, PORT);

  it('is a well formed UPnP device document', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" ?>')).toBe(true);
    expect(xml).toContain('<root xmlns="urn:schemas-upnp-org:device-1-0">');
    expect(xml.trimEnd().endsWith('</root>')).toBe(true);
  });

  it('claims to be a 2015 Philips bridge', () => {
    expect(xml).toContain('<modelName>Philips hue bridge 2015</modelName>');
    expect(xml).toContain('<modelNumber>BSB002</modelNumber>');
    expect(xml).toContain('<manufacturer>Royal Philips Electronics</manufacturer>');
    expect(xml).toContain('<deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>');
  });

  it('advertises the address it was given', () => {
    expect(xml).toContain(`<URLBase>http://${ADDRESS}:${PORT}/</URLBase>`);
    expect(xml).toContain(`<friendlyName>Milight Studio (${ADDRESS})</friendlyName>`);
  });

  it('derives the serial number and UDN from the bridge id', () => {
    expect(xml).toContain('<serialNumber>001788fffe123456</serialNumber>');
    expect(xml).toContain('<UDN>uuid:2f402f80-da50-11e1-9b23-001788fffe12</UDN>');
  });
});

describe('createHueHandler: discovery', () => {
  it('serves the description document as XML', async () => {
    const response = await ctx.handle('GET', '/description.xml');
    expect(response.status).toBe(200);
    expect(response.headers).toEqual({ 'content-type': 'application/xml' });
    expect(response.body).toBe(describeBridge(BRIDGE_ID, ADDRESS, PORT));
  });

  it('serves the description document regardless of the query string', async () => {
    const response = await ctx.handle('GET', '/description.xml');
    expect(response.body).toContain('<modelNumber>BSB002</modelNumber>');
  });

  it('pairs anyone who asks, because Alexa never presses a link button', async () => {
    const response = await ctx.handle('POST', '/api', { devicetype: 'Echo' });
    expect(response.status).toBe(200);
    expect(body(response)).toEqual([{ success: { username: 'milight-studio-user' } }]);
  });

  it('answers GET /api/config without a username', async () => {
    const response = await ctx.handle('GET', '/api/config');
    expect(response.status).toBe(200);
    expect(body(response)).toMatchObject({
      name: 'Milight Studio',
      bridgeid: BRIDGE_ID,
      mac: '00:17:88:ff:fe:12',
      modelid: 'BSB002',
      ipaddress: ADDRESS,
      linkbutton: true,
      factorynew: false,
    });
  });

  it('answers the authenticated config the same way', async () => {
    const anonymous = await ctx.handle('GET', '/api/config');
    const authenticated = await ctx.handle('GET', '/api/some-username/config');
    expect(body(authenticated)).toEqual(body(anonymous));
  });
});

describe('createHueHandler: datastore', () => {
  it('returns the full datastore for GET /api/{username}', async () => {
    ctx.lights.push(makeLight({ name: 'Bureau' }));
    const response = await ctx.handle('GET', '/api/some-username');

    expect(response.status).toBe(200);
    const datastore = body(response) as Record<string, unknown>;
    expect(Object.keys(datastore).sort()).toEqual([
      'config',
      'groups',
      'lights',
      'rules',
      'scenes',
      'schedules',
      'sensors',
    ]);
    expect(Object.values(datastore.lights as Record<string, { name: string }>)[0]?.name).toBe('Bureau');
  });

  it('lists the lights for GET /api/{username}/lights', async () => {
    ctx.lights.push(makeLight({ name: 'Bureau' }), makeLight({ name: 'Bank' }));
    const response = await ctx.handle('GET', '/api/x/lights');

    const payload = body(response) as Record<string, { name: string }>;
    expect(
      Object.values(payload)
        .map((light) => light.name)
        .sort(),
    ).toEqual(['Bank', 'Bureau']);
  });

  it('publishes groups and scenes as extra lights', async () => {
    const light = makeLight({ name: 'Bureau' });
    ctx.lights.push(light);
    ctx.groups.push({
      id: uuid(),
      name: 'Woonkamer',
      room: null,
      lightIds: [light.id],
      exposeToVoice: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    ctx.scenes.push({
      id: uuid(),
      name: 'Filmavond',
      room: null,
      steps: [],
      exposeToVoice: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const payload = body(await ctx.handle('GET', '/api/x/lights')) as Record<string, { name: string }>;
    expect(
      Object.values(payload)
        .map((light) => light.name)
        .sort(),
    ).toEqual(['Bureau', 'Filmavond', 'Woonkamer']);
  });

  it('serves a single light', async () => {
    const light = makeLight({ name: 'Bureau' });
    ctx.lights.push(light);

    const response = await ctx.handle('GET', `/api/x/lights/${ctx.hueIdOf(light.id)}`);
    expect(response.status).toBe(200);
    expect(body(response)).toMatchObject({ name: 'Bureau', type: 'Extended color light' });
  });

  it('answers a Hue-style error array for an unknown light', async () => {
    const response = await ctx.handle('GET', '/api/x/lights/9999');
    expect(response.status).toBe(404);
    expect(body(response)).toEqual([
      { error: { type: 3, address: '/lights/9999', description: 'resource, /lights, not available' } },
    ]);
  });

  it('answers an empty object for the group collection and a stub for group 0', async () => {
    const light = makeLight();
    ctx.lights.push(light);

    expect(body(await ctx.handle('GET', '/api/x/groups'))).toEqual({});
    expect(body(await ctx.handle('GET', '/api/x/groups/0'))).toEqual({
      name: 'Group 0',
      lights: [ctx.hueIdOf(light.id)],
      type: 'LightGroup',
      action: { on: false },
    });
  });

  it.each(['scenes', 'schedules', 'rules', 'sensors'])('answers an empty %s collection', async (resource) => {
    expect(body(await ctx.handle('GET', `/api/x/${resource}`))).toEqual({});
  });

  it('ignores the query string when routing', async () => {
    const response = await ctx.handle('GET', '/api/x/lights?foo=bar');
    expect(response.status).toBe(200);
  });
});

describe('createHueHandler: state changes', () => {
  it('translates a light state PUT and dispatches it to the light', async () => {
    const light = makeLight();
    ctx.lights.push(light);
    const hueId = ctx.hueIdOf(light.id);

    const response = await ctx.handle('PUT', `/api/x/lights/${hueId}/state`, { on: true, bri: 254 });

    expect(response.status).toBe(200);
    expect(ctx.applied).toEqual([{ kind: 'light', id: light.id, command: { power: 'on', brightness: 100 } }]);
    expect(body(response)).toEqual([
      { success: { [`/lights/${hueId}/state/on`]: true } },
      { success: { [`/lights/${hueId}/state/bri`]: 254 } },
    ]);
  });

  it('accepts a POST to the state endpoint as well', async () => {
    const light = makeLight();
    ctx.lights.push(light);

    await ctx.handle('POST', `/api/x/lights/${ctx.hueIdOf(light.id)}/state`, { on: false });
    expect(ctx.applied).toEqual([{ kind: 'light', id: light.id, command: { power: 'off' } }]);
  });

  it('dispatches to the group service for a group target', async () => {
    const light = makeLight();
    ctx.lights.push(light);
    const group: Group = {
      id: uuid(),
      name: 'Woonkamer',
      room: null,
      lightIds: [light.id],
      exposeToVoice: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    ctx.groups.push(group);

    await ctx.handle('PUT', `/api/x/lights/${ctx.hueIdOf(group.id)}/state`, { on: true });
    expect(ctx.applied).toEqual([{ kind: 'group', id: group.id, command: { power: 'on' } }]);
  });

  it('runs a scene when it is switched on', async () => {
    const scene: Scene = {
      id: uuid(),
      name: 'Filmavond',
      room: null,
      steps: [],
      exposeToVoice: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    ctx.scenes.push(scene);
    const hueId = ctx.hueIdOf(scene.id);

    const response = await ctx.handle('PUT', `/api/x/lights/${hueId}/state`, { on: true });

    expect(ctx.applied).toEqual([{ kind: 'scene', id: scene.id }]);
    expect(body(response)).toEqual([{ success: { [`/lights/${hueId}/state/on`]: true } }]);
  });

  it('does nothing when a scene is switched off, but still answers success', async () => {
    const scene: Scene = {
      id: uuid(),
      name: 'Filmavond',
      room: null,
      steps: [],
      exposeToVoice: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    ctx.scenes.push(scene);

    const response = await ctx.handle('PUT', `/api/x/lights/${ctx.hueIdOf(scene.id)}/state`, {
      on: false,
    });

    expect(ctx.applied).toEqual([]);
    expect(response.status).toBe(200);
  });

  it.each([
    { payload: {}, why: 'an empty body' },
    { payload: undefined, why: 'no body at all' },
    { payload: 'not an object', why: 'a non-object body' },
    { payload: null, why: 'a null body' },
    { payload: { alert: 'select' }, why: 'a body with nothing actionable in it' },
  ])('answers an empty list and dispatches nothing for $why', async ({ payload }) => {
    const light = makeLight();
    ctx.lights.push(light);

    const response = await ctx.handle('PUT', `/api/x/lights/${ctx.hueIdOf(light.id)}/state`, payload);

    expect(response.status).toBe(200);
    expect(body(response)).toEqual([]);
    expect(ctx.applied).toEqual([]);
  });

  it('answers a Hue-style 404 for a state PUT to an unknown light', async () => {
    const response = await ctx.handle('PUT', '/api/x/lights/9999/state', { on: true });
    expect(response.status).toBe(404);
    expect(ctx.applied).toEqual([]);
  });

  it('lets a failure from the service layer surface to the caller', async () => {
    const light = makeLight();
    ctx.lights.push(light);
    ctx.failWith(new Error('hub unreachable'));

    await expect(
      ctx.handle('PUT', `/api/x/lights/${ctx.hueIdOf(light.id)}/state`, { on: true }),
    ).rejects.toThrow('hub unreachable');
  });

  it('ignores lights that are hidden from voice control', async () => {
    ctx.lights.push(makeLight({ exposeToVoice: false }));
    expect(body(await ctx.handle('GET', '/api/x/lights'))).toEqual({});
  });
});

describe('createHueHandler: unknown routes', () => {
  it.each([
    { method: 'GET', url: '/' },
    { method: 'GET', url: '/index.html' },
    { method: 'GET', url: '/upnp/setup.xml' },
    { method: 'POST', url: '/notapi' },
  ])('answers a Hue-style 404 for $method $url', async ({ method, url }) => {
    const response = await ctx.handle(method, url);
    expect(response.status).toBe(404);
    expect(body(response)).toEqual([
      { error: { type: 3, address: url, description: 'resource not available' } },
    ]);
  });

  it.each(['/api/x/capabilities', '/api/x/lights/1/unknown', '/api/x/groups/1', '/api/x/resourcelinks'])(
    'answers a Hue-style 404 for the unsupported resource %s',
    async (url) => {
      const light = makeLight();
      ctx.lights.push(light);
      const response = await ctx.handle('GET', url);
      expect(response.status).toBe(404);
    },
  );

  it('answers a 404 for a DELETE against a known light', async () => {
    const light = makeLight();
    ctx.lights.push(light);
    const response = await ctx.handle('DELETE', `/api/x/lights/${ctx.hueIdOf(light.id)}`);
    expect(response.status).toBe(404);
  });

  it('always answers with a JSON content type outside the description document', async () => {
    for (const url of ['/api/config', '/api/x/lights', '/nope']) {
      expect((await ctx.handle('GET', url)).headers).toEqual({ 'content-type': 'application/json' });
    }
  });
});
