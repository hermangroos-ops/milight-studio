import {
  createDefaultLightState,
  kelvinToMired,
  type Group,
  type LightState,
  type LightWithState,
  type RemoteType,
  type Scene,
} from '@milight-studio/shared';
import { describe, expect, it } from 'vitest';

import {
  aggregateState,
  assignHueIds,
  buildHueTargets,
  fnv1a,
  hueLightType,
  hueModelId,
  hueStateToCommand,
  hueSuccessResponse,
  toHueLight,
  toHueState,
  xyToHueSat,
  type HueTarget,
} from './hue-model.js';

const NOW = new Date('2024-01-01T00:00:00.000Z');
const BRIDGE_ID = '001788FFFE123456';

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

function makeGroup(patch: Partial<Group> = {}): Group {
  return {
    id: uuid(),
    name: 'Woonkamer',
    room: null,
    lightIds: [],
    exposeToVoice: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...patch,
  };
}

function makeScene(patch: Partial<Scene> = {}): Scene {
  return {
    id: uuid(),
    name: 'Filmavond',
    room: null,
    steps: [],
    exposeToVoice: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...patch,
  };
}

function makeTarget(patch: Partial<HueTarget> = {}): HueTarget {
  return {
    kind: 'light',
    id: uuid(),
    hueId: '1',
    name: 'Bureau',
    state: createDefaultLightState(NOW),
    supportsColor: true,
    supportsTemperature: true,
    supportsBrightness: true,
    ...patch,
  };
}

function state(patch: Partial<LightState> = {}): LightState {
  return { ...createDefaultLightState(NOW), ...patch };
}

describe('fnv1a', () => {
  it('is deterministic', () => {
    expect(fnv1a('light:abc')).toBe(fnv1a('light:abc'));
  });

  it.each([
    { input: '', expected: 2_166_136_261 },
    { input: 'abc', expected: 440_920_331 },
    { input: 'hello', expected: 1_335_831_723 },
  ])('hashes $input to $expected', ({ input, expected }) => {
    expect(fnv1a(input)).toBe(expected);
  });

  it('always yields an unsigned 32 bit integer', () => {
    for (const value of ['', 'a', 'light:00000000-0000-4000-8000-000000000001', '€ é 🎉']) {
      const hash = fnv1a(value);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffff_ffff);
    }
  });

  it('separates values that differ only in one character', () => {
    expect(fnv1a('light:a')).not.toBe(fnv1a('light:b'));
  });
});

describe('assignHueIds', () => {
  it('is stable across calls and independent of the input order', () => {
    const ids = ['light:a', 'group:b', 'scene:c'];
    const first = assignHueIds(ids);
    const second = assignHueIds([...ids].reverse());
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it('assigns an id inside the 1–9000 range to everything', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `light:${index}`);
    const assigned = assignHueIds(ids);

    expect(assigned.size).toBe(200);
    for (const value of assigned.values()) {
      const numeric = Number(value);
      expect(numeric).toBeGreaterThanOrEqual(1);
      expect(numeric).toBeLessThanOrEqual(9000);
    }
  });

  it('never hands out the same numeric id twice', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `light:${index}`);
    const assigned = assignHueIds(ids);
    expect(new Set(assigned.values()).size).toBe(ids.length);
  });

  it('resolves a genuine hash collision by probing upwards, deterministically', () => {
    // fnv1a('light:9') and fnv1a('light:32') both land on 3507.
    expect((fnv1a('light:9') % 9000) + 1).toBe((fnv1a('light:32') % 9000) + 1);

    const assigned = assignHueIds(['light:9', 'light:32']);
    // Sorted order puts 'light:32' first, so it keeps the natural slot.
    expect(assigned.get('light:32')).toBe('3507');
    expect(assigned.get('light:9')).toBe('3508');
    expect([...assignHueIds(['light:32', 'light:9']).entries()]).toEqual([...assigned.entries()]);
  });

  it('handles an empty list', () => {
    expect(assignHueIds([]).size).toBe(0);
  });
});

describe('buildHueTargets', () => {
  it('publishes only entries that opted in to voice control', () => {
    const visible = makeLight({ name: 'Zichtbaar' });
    const hidden = makeLight({ name: 'Verborgen', exposeToVoice: false });
    const visibleGroup = makeGroup({ name: 'Groep' });
    const hiddenGroup = makeGroup({ name: 'Stil', exposeToVoice: false });
    const visibleScene = makeScene({ name: 'Scene' });
    const hiddenScene = makeScene({ name: 'Geheim', exposeToVoice: false });

    const targets = buildHueTargets({
      lights: [visible, hidden],
      groups: [visibleGroup, hiddenGroup],
      scenes: [visibleScene, hiddenScene],
      membersOf: () => [],
    });

    expect(targets.map((target) => target.name)).toEqual(['Zichtbaar', 'Groep', 'Scene']);
    expect(targets.map((target) => target.kind)).toEqual(['light', 'group', 'scene']);
  });

  it('gives every target a distinct hue id', () => {
    const lights = Array.from({ length: 20 }, () => makeLight());
    const targets = buildHueTargets({ lights, groups: [], scenes: [], membersOf: () => [] });
    expect(new Set(targets.map((target) => target.hueId)).size).toBe(20);
  });

  const capabilities: Record<RemoteType, [boolean, boolean, boolean]> = {
    rgb_cct: [true, true, true],
    fut089: [true, true, true],
    rgbw: [true, false, true],
    cct: [false, true, true],
    fut091: [false, true, true],
    rgb: [true, false, true],
    fut020: [true, false, false],
  };

  it.each(Object.keys(capabilities) as RemoteType[])('derives the capability flags for %s', (remoteType) => {
    const [color, temperature, brightness] = capabilities[remoteType];
    const targets = buildHueTargets({
      lights: [makeLight({ remoteType })],
      groups: [],
      scenes: [],
      membersOf: () => [],
    });

    expect(targets[0]).toMatchObject({
      supportsColor: color,
      supportsTemperature: temperature,
      supportsBrightness: brightness,
    });
  });

  it('unions the capabilities of a group across its members', () => {
    const colourOnly = makeLight({ remoteType: 'rgb' });
    const whiteOnly = makeLight({ remoteType: 'cct' });
    const group = makeGroup({ lightIds: [colourOnly.id, whiteOnly.id] });

    const targets = buildHueTargets({
      lights: [],
      groups: [group],
      scenes: [],
      membersOf: () => [colourOnly, whiteOnly],
    });

    expect(targets[0]).toMatchObject({
      kind: 'group',
      supportsColor: true,
      supportsTemperature: true,
      supportsBrightness: true,
    });
  });

  it('gives an empty group no capabilities and no state', () => {
    const targets = buildHueTargets({
      lights: [],
      groups: [makeGroup()],
      scenes: [],
      membersOf: () => [],
    });

    expect(targets[0]).toMatchObject({
      supportsColor: false,
      supportsTemperature: false,
      supportsBrightness: false,
      state: null,
    });
  });

  it('derives group state from its members', () => {
    const on = makeLight({ state: state({ power: 'on', brightness: 80 }) });
    const off = makeLight({ state: state({ power: 'off', brightness: 10 }) });
    const group = makeGroup({ lightIds: [on.id, off.id] });

    const targets = buildHueTargets({
      lights: [],
      groups: [group],
      scenes: [],
      membersOf: () => [on, off],
    });

    expect(targets[0]?.state).toMatchObject({ power: 'on', brightness: 80 });
  });

  it('publishes a scene as a stateless, capability-free light', () => {
    const targets = buildHueTargets({
      lights: [],
      groups: [],
      scenes: [makeScene()],
      membersOf: () => [],
    });

    expect(targets[0]).toMatchObject({
      kind: 'scene',
      state: null,
      supportsColor: false,
      supportsTemperature: false,
      supportsBrightness: false,
    });
  });

  it('returns nothing when nothing is exposed', () => {
    expect(buildHueTargets({ lights: [], groups: [], scenes: [], membersOf: () => [] })).toEqual([]);
  });
});

describe('aggregateState', () => {
  it('returns null for an empty member list', () => {
    expect(aggregateState([])).toBeNull();
  });

  it('reports on when any member is on', () => {
    const result = aggregateState([state({ power: 'off' }), state({ power: 'on' })]);
    expect(result?.power).toBe('on');
  });

  it('reports off when every member is off, keeping the first brightness', () => {
    const result = aggregateState([
      state({ power: 'off', brightness: 30 }),
      state({ power: 'off', brightness: 70 }),
    ]);
    expect(result).toMatchObject({ power: 'off', brightness: 30 });
  });

  it('averages the brightness of the lit members only', () => {
    const result = aggregateState([
      state({ power: 'on', brightness: 80 }),
      state({ power: 'off', brightness: 0 }),
      state({ power: 'on', brightness: 20 }),
    ]);
    expect(result).toMatchObject({ power: 'on', brightness: 50 });
  });

  it('rounds a fractional mean', () => {
    const result = aggregateState([
      state({ power: 'on', brightness: 50 }),
      state({ power: 'on', brightness: 51 }),
    ]);
    expect(result?.brightness).toBe(51);
  });

  it('takes the other fields from the first lit member', () => {
    const result = aggregateState([
      state({ power: 'off', colorMode: 'white' }),
      state({ power: 'on', colorMode: 'color', hue: 200 }),
    ]);
    expect(result).toMatchObject({ colorMode: 'color', hue: 200 });
  });

  it('handles a single member', () => {
    expect(aggregateState([state({ power: 'on', brightness: 42 })])).toMatchObject({
      power: 'on',
      brightness: 42,
    });
  });
});

describe('hueLightType and hueModelId', () => {
  it.each([
    {
      flags: { supportsColor: true, supportsTemperature: true },
      type: 'Extended color light',
      model: 'LCT015',
    },
    { flags: { supportsColor: true, supportsTemperature: false }, type: 'Color light', model: 'LST002' },
    {
      flags: { supportsColor: false, supportsTemperature: true },
      type: 'Color temperature light',
      model: 'LTW012',
    },
    {
      flags: { supportsColor: false, supportsTemperature: false, supportsBrightness: true },
      type: 'Dimmable light',
      model: 'LWB010',
    },
    {
      flags: { supportsColor: false, supportsTemperature: false, supportsBrightness: false },
      type: 'On/Off plug-in unit',
      model: 'LWB010',
    },
  ])('reports $type / $model', ({ flags, type, model }) => {
    const target = makeTarget(flags);
    expect(hueLightType(target)).toBe(type);
    expect(hueModelId(target)).toBe(model);
  });
});

describe('toHueState', () => {
  it('publishes every field for a full colour bulb', () => {
    const target = makeTarget({
      state: state({
        power: 'on',
        brightness: 50,
        colorMode: 'color',
        hue: 180,
        saturation: 60,
        colorTemperature: 3000,
      }),
    });

    expect(toHueState(target)).toEqual({
      on: true,
      reachable: true,
      alert: 'none',
      mode: 'homeautomation',
      bri: 127,
      hue: Math.round((180 / 360) * 65_535),
      sat: 152,
      effect: 'none',
      xy: [0.3227, 0.329],
      ct: kelvinToMired(3000),
      colormode: 'hs',
    });
  });

  it('reports ct as the colour mode for a white bulb', () => {
    const target = makeTarget({ state: state({ power: 'on', colorMode: 'white' }) });
    expect(toHueState(target).colormode).toBe('ct');
  });

  it('omits brightness for a bulb that cannot be dimmed', () => {
    const target = makeTarget({ supportsBrightness: false });
    expect(toHueState(target)).not.toHaveProperty('bri');
  });

  it('omits the colour fields for a bulb without colour', () => {
    const published = toHueState(makeTarget({ supportsColor: false }));
    expect(published).not.toHaveProperty('hue');
    expect(published).not.toHaveProperty('sat');
    expect(published).not.toHaveProperty('xy');
    expect(published.colormode).toBe('ct');
  });

  it('omits ct for a bulb without white tones', () => {
    expect(toHueState(makeTarget({ supportsTemperature: false }))).not.toHaveProperty('ct');
  });

  it('omits the colour mode when the bulb has neither colour nor white tones', () => {
    const published = toHueState(
      makeTarget({ supportsColor: false, supportsTemperature: false, supportsBrightness: true }),
    );
    expect(published).not.toHaveProperty('colormode');
    expect(published).toHaveProperty('bri');
  });

  it('never reports a brightness of zero, which Hue treats as invalid', () => {
    const target = makeTarget({ state: state({ power: 'on', brightness: 0 }) });
    expect(toHueState(target).bri).toBe(1);
  });

  it('falls back to sensible defaults for a stateless target such as a scene', () => {
    const target = makeTarget({ kind: 'scene', state: null });
    expect(toHueState(target)).toMatchObject({ on: false, reachable: true, bri: 254, sat: 0 });
  });

  it('mirrors the reachable flag', () => {
    expect(toHueState(makeTarget({ state: state({ reachable: false }) })).reachable).toBe(false);
  });
});

describe('toHueLight', () => {
  it('wraps the state in a plausible Hue light resource', () => {
    const target = makeTarget({ hueId: '42', name: 'Bureau' });
    const light = toHueLight(target, BRIDGE_ID);

    expect(light).toMatchObject({
      type: 'Extended color light',
      name: 'Bureau',
      modelid: 'LCT015',
      manufacturername: 'Signify Netherlands B.V.',
      productname: 'Milight Studio',
      uniqueid: '00:17:88:ff:fe:12-42',
      swversion: '1.104.2',
    });
    expect(light.state).toEqual(toHueState(target));
  });

  it('derives a distinct unique id per target', () => {
    const first = toHueLight(makeTarget({ hueId: '1' }), BRIDGE_ID);
    const second = toHueLight(makeTarget({ hueId: '2' }), BRIDGE_ID);
    expect(first.uniqueid).not.toBe(second.uniqueid);
  });
});

describe('xyToHueSat', () => {
  it.each([
    { name: 'red', x: 0.675, y: 0.322, hueRange: [0, 40] },
    { name: 'green', x: 0.4091, y: 0.518, hueRange: [50, 160] },
    { name: 'blue', x: 0.167, y: 0.04, hueRange: [200, 280] },
  ])('places the $name primary in the right part of the wheel', ({ x, y, hueRange }) => {
    const { hue, saturation } = xyToHueSat(x, y);
    expect(hue).toBeGreaterThanOrEqual(hueRange[0]!);
    expect(hue).toBeLessThanOrEqual(hueRange[1]!);
    expect(saturation).toBeGreaterThan(50);
  });

  it('reports the D65 white point as barely saturated', () => {
    expect(xyToHueSat(0.3127, 0.329).saturation).toBeLessThan(10);
  });

  it('survives a y of zero without dividing by it', () => {
    const result = xyToHueSat(0.3, 0);
    expect(Number.isFinite(result.hue)).toBe(true);
    expect(Number.isFinite(result.saturation)).toBe(true);
  });

  it('always stays inside the hue and saturation ranges', () => {
    for (const x of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      for (const y of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const { hue, saturation } = xyToHueSat(x, y);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThanOrEqual(360);
        expect(saturation).toBeGreaterThanOrEqual(0);
        expect(saturation).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('hueStateToCommand', () => {
  it.each([
    { body: { on: true }, expected: { power: 'on' } },
    { body: { on: false }, expected: { power: 'off' } },
    { body: { bri: 254 }, expected: { brightness: 100 } },
    { body: { bri: 127 }, expected: { brightness: 50 } },
    { body: { bri: 0 }, expected: { brightness: 1 } },
    { body: { bri_inc: 25 }, expected: { brightnessStep: 10 } },
    { body: { bri_inc: -254 }, expected: { brightnessStep: -100 } },
    { body: { ct: 250 }, expected: { colorTemperature: 4000 } },
    { body: { transitiontime: 4 }, expected: { transitionMs: 400 } },
    { body: { transitiontime: 0 }, expected: { transitionMs: 0 } },
  ])('translates $body', ({ body, expected }) => {
    expect(hueStateToCommand(body)).toEqual(expected);
  });

  it('prefers an absolute brightness over an increment', () => {
    expect(hueStateToCommand({ bri: 100, bri_inc: 50 })).toEqual({ brightness: 39 });
  });

  it('ignores a zero increment', () => {
    expect(hueStateToCommand({ bri_inc: 0 })).toBeNull();
  });

  it('translates xy into hue and saturation', () => {
    const command = hueStateToCommand({ xy: [0.675, 0.322] });
    expect(command?.hue).toBe(xyToHueSat(0.675, 0.322).hue);
    expect(command?.saturation).toBe(xyToHueSat(0.675, 0.322).saturation);
  });

  it('lets xy win over a colour temperature in the same body', () => {
    const command = hueStateToCommand({ ct: 250, xy: [0.675, 0.322] });
    expect(command).not.toHaveProperty('colorTemperature');
    expect(command?.hue).toBeDefined();
  });

  it('ignores a malformed xy pair', () => {
    expect(hueStateToCommand({ xy: [0.4] })).toBeNull();
    expect(hueStateToCommand({ xy: ['a', 'b'] })).toBeNull();
    expect(hueStateToCommand({ xy: 'nope' })).toBeNull();
  });

  it('translates hue and sat from the Hue scales', () => {
    expect(hueStateToCommand({ hue: 0, sat: 254 })).toEqual({ hue: 0, saturation: 100 });
    expect(hueStateToCommand({ hue: 65_535, sat: 0 })).toEqual({ hue: 359, saturation: 0 });
    expect(hueStateToCommand({ hue: 32_768, sat: 127 })).toEqual({ hue: 180, saturation: 50 });
  });

  it('clamps an out-of-range hue', () => {
    expect(hueStateToCommand({ hue: 999_999 })?.hue).toBe(359);
    expect(hueStateToCommand({ hue: -10 })?.hue).toBe(0);
  });

  it('fills a missing saturation from the current state, defaulting to full', () => {
    expect(hueStateToCommand({ hue: 0 })?.saturation).toBe(100);
    expect(hueStateToCommand({ hue: 0 }, state({ saturation: 40 }))?.saturation).toBe(40);
  });

  it('fills a missing hue from the current state', () => {
    expect(hueStateToCommand({ sat: 254 }, state({ hue: 180 }))?.hue).toBe(180);
    expect(hueStateToCommand({ sat: 254 })?.hue).toBe(0);
  });

  it('lets hue and sat win over a colour temperature in the same body', () => {
    expect(hueStateToCommand({ ct: 250, sat: 254 })).not.toHaveProperty('colorTemperature');
  });

  it('caps an absurd transition time', () => {
    expect(hueStateToCommand({ transitiontime: 999_999 })?.transitionMs).toBe(600_000);
  });

  it.each([{}, { alert: 'select' }, { effect: 'colorloop' }, { on: 'yes' }, { bri: '100' }])(
    'returns null for the unusable body %p',
    (body) => {
      expect(hueStateToCommand(body)).toBeNull();
    },
  );

  it('combines several fields into one command', () => {
    expect(hueStateToCommand({ on: true, bri: 254, transitiontime: 10 })).toEqual({
      power: 'on',
      brightness: 100,
      transitionMs: 1000,
    });
  });
});

describe('hueSuccessResponse', () => {
  it('answers with one entry per field that was applied', () => {
    expect(hueSuccessResponse('7', { on: true, bri: 254 })).toEqual([
      { success: { '/lights/7/state/on': true } },
      { success: { '/lights/7/state/bri': 254 } },
    ]);
  });

  it('answers with an empty list for an empty body', () => {
    expect(hueSuccessResponse('7', {})).toEqual([]);
  });
});
