import {
  DEFAULT_LIGHT_STATE,
  REMOTE_TYPES,
  createDefaultLightState,
  kelvinToMired,
  type LightCommand,
  type LightState,
  type RemoteType,
} from '@milight-studio/shared';
import { describe, expect, it } from 'vitest';

import {
  applyCommandToState,
  buildHubCommandBody,
  mergeHubState,
  resolveColor,
  validateCommand,
} from './translate.js';
import type { HubGroupState } from './types.js';

const NOW = new Date('2024-01-01T00:00:00.000Z');
const LATER = new Date('2024-02-03T04:05:06.000Z');

function stateOf(patch: Partial<LightState> = {}): LightState {
  return { ...createDefaultLightState(NOW), ...patch };
}

describe('validateCommand', () => {
  it('accepts a command with no conflicting fields', () => {
    expect(validateCommand({ power: 'on', brightness: 40, hue: 30 })).toEqual([]);
    expect(validateCommand({})).toEqual([]);
  });

  it.each([
    {
      why: 'a hue together with a colour temperature',
      command: { hue: 30, colorTemperature: 3000 },
      path: 'colorTemperature',
    },
    {
      why: 'a hex colour together with a colour temperature',
      command: { hex: '#ff0000', colorTemperature: 3000 },
      path: 'colorTemperature',
    },
    { why: 'a hue together with white mode', command: { hue: 30, whiteMode: true }, path: 'whiteMode' },
    {
      why: 'a hex colour together with white mode',
      command: { hex: '#ff0000', whiteMode: true },
      path: 'whiteMode',
    },
    {
      why: 'absolute and relative brightness at once',
      command: { brightness: 40, brightnessStep: 10 },
      path: 'brightnessStep',
    },
    { why: 'hex together with hue', command: { hex: '#ff0000', hue: 10 }, path: 'hex' },
    { why: 'hex together with saturation', command: { hex: '#ff0000', saturation: 10 }, path: 'hex' },
    { why: 'a zero brightness step', command: { brightnessStep: 0 }, path: 'brightnessStep' },
  ])('rejects $why', ({ command, path }) => {
    const issues = validateCommand(command as LightCommand);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(path);
    expect(issues[0]?.message.length).toBeGreaterThan(0);
  });

  it('reports every conflict in one pass', () => {
    const issues = validateCommand({
      hex: '#ff0000',
      hue: 10,
      colorTemperature: 3000,
      whiteMode: true,
      brightness: 10,
      brightnessStep: 0,
    });
    expect(issues.map((issue) => issue.path)).toEqual([
      'colorTemperature',
      'whiteMode',
      'brightnessStep',
      'hex',
      'brightnessStep',
    ]);
  });

  it('allows white mode and a colour temperature together', () => {
    expect(validateCommand({ whiteMode: true, colorTemperature: 3000 })).toEqual([]);
  });
});

describe('resolveColor', () => {
  it.each([
    { hex: '#ff0000', expected: { hue: 0, saturation: 100 } },
    { hex: '#00ff00', expected: { hue: 120, saturation: 100 } },
    { hex: '#0000ff', expected: { hue: 240, saturation: 100 } },
    { hex: 'ffffff', expected: { hue: 0, saturation: 0 } },
    { hex: '#f00', expected: { hue: 0, saturation: 100 } },
  ])('resolves the hex colour $hex', ({ hex, expected }) => {
    expect(resolveColor({ hex })).toEqual(expected);
  });

  it('returns null for an unparseable hex colour', () => {
    expect(resolveColor({ hex: 'nonsense' })).toBeNull();
  });

  it('returns null when neither hue, saturation nor hex is present', () => {
    expect(resolveColor({})).toBeNull();
    expect(resolveColor({ power: 'on', brightness: 50 })).toBeNull();
  });

  it('defaults saturation to fully saturated when only a hue is given', () => {
    expect(resolveColor({ hue: 200 })).toEqual({ hue: 200, saturation: 100 });
  });

  it('defaults hue to zero when only a saturation is given', () => {
    expect(resolveColor({ saturation: 25 })).toEqual({ hue: 0, saturation: 25 });
  });

  it('wraps and clamps out-of-range values', () => {
    expect(resolveColor({ hue: 400, saturation: 250 })).toEqual({
      hue: 40,
      saturation: 100,
    });
    expect(resolveColor({ hue: -30, saturation: -5 })).toEqual({
      hue: 330,
      saturation: 0,
    });
  });
});

describe('buildHubCommandBody: key insertion order', () => {
  it('serialises status before level before colour', () => {
    const { body } = buildHubCommandBody(
      { power: 'on', brightness: 60, hue: 200, saturation: 50 },
      'rgb_cct',
    );
    expect(Object.keys(body)).toEqual(['status', 'level', 'hue', 'saturation']);
  });

  it('puts the colour temperature between brightness and colour', () => {
    const { body } = buildHubCommandBody(
      { power: 'on', brightness: 60, colorTemperature: 3000, transitionMs: 1000 },
      'rgb_cct',
    );
    expect(Object.keys(body)).toEqual(['status', 'level', 'color_temp', 'transition']);
  });

  it('emits commands after every scalar field and transition last', () => {
    const { body } = buildHubCommandBody(
      { power: 'on', brightness: 60, effect: 3, nightMode: true, transitionMs: 2000 },
      'rgb_cct',
    );
    expect(Object.keys(body)).toEqual(['status', 'level', 'mode', 'commands', 'transition']);
  });

  it('serialises to JSON in the same order', () => {
    const { body } = buildHubCommandBody({ power: 'on', brightness: 10, hue: 5 }, 'rgb_cct');
    expect(JSON.stringify(body)).toBe('{"status":"ON","level":10,"hue":5,"saturation":100}');
  });
});

describe('buildHubCommandBody: power', () => {
  it.each(['rgb_cct', 'fut089', 'rgbw', 'cct', 'fut091', 'rgb'] as const)(
    'switches %s on and off with an explicit status',
    (remoteType) => {
      expect(buildHubCommandBody({ power: 'on' }, remoteType).body).toEqual({ status: 'ON' });
      expect(buildHubCommandBody({ power: 'off' }, remoteType).body).toEqual({ status: 'OFF' });
    },
  );

  it.each(REMOTE_TYPES)('turns an explicit toggle into the toggle command for %s', (remoteType) => {
    expect(buildHubCommandBody({ power: 'toggle' }, remoteType).body).toEqual({ commands: ['toggle'] });
  });

  it('forces a toggle for fut020, which has no addressable power', () => {
    expect(buildHubCommandBody({ power: 'on' }, 'fut020').body).toEqual({ commands: ['toggle'] });
    expect(buildHubCommandBody({ power: 'off' }, 'fut020').body).toEqual({ commands: ['toggle'] });
  });
});

describe('buildHubCommandBody: brightness', () => {
  it.each(['rgb_cct', 'fut089', 'rgbw', 'cct', 'fut091'] as const)(
    'sets an absolute level for %s',
    (remoteType) => {
      expect(buildHubCommandBody({ brightness: 42 }, remoteType).body).toEqual({ level: 42 });
      expect(buildHubCommandBody({ brightness: 0 }, remoteType).body).toEqual({ level: 0 });
      expect(buildHubCommandBody({ brightness: 100 }, remoteType).body).toEqual({ level: 100 });
    },
  );

  it.each([
    { brightness: 100, commands: ['level_up'] },
    { brightness: 80, commands: ['level_up', 'level_up'] },
    { brightness: 50, commands: Array<string>(5).fill('level_up') },
    { brightness: 30, commands: ['level_down', 'level_down', 'level_down'] },
    { brightness: 0, commands: ['level_down'] },
  ])('nudges a relative-only rgb bulb towards $brightness', ({ brightness, commands }) => {
    expect(buildHubCommandBody({ brightness }, 'rgb').body).toEqual({ commands });
  });

  it('reports brightness as unsupported on fut020', () => {
    const result = buildHubCommandBody({ brightness: 50 }, 'fut020');
    expect(result.body).toEqual({});
    expect(result.unsupported).toEqual(['brightness']);
  });

  it.each([
    { step: 10, commands: ['level_up'] },
    { step: 25, commands: ['level_up', 'level_up', 'level_up'] },
    { step: 100, commands: Array<string>(10).fill('level_up') },
    { step: 1, commands: ['level_up'] },
    { step: -10, commands: ['level_down'] },
    { step: -35, commands: Array<string>(4).fill('level_down') },
    { step: -100, commands: Array<string>(10).fill('level_down') },
  ])('turns a step of $step into the right number of presses', ({ step, commands }) => {
    expect(buildHubCommandBody({ brightnessStep: step }, 'rgb_cct').body).toEqual({ commands });
  });

  it('ignores a zero step entirely', () => {
    expect(buildHubCommandBody({ brightnessStep: 0 }, 'rgb_cct')).toEqual({ body: {}, unsupported: [] });
  });

  it('reports a step as unsupported on fut020', () => {
    const result = buildHubCommandBody({ brightnessStep: 20 }, 'fut020');
    expect(result.body).toEqual({});
    expect(result.unsupported).toEqual(['brightness']);
  });
});

describe('buildHubCommandBody: white mode and colour temperature', () => {
  it.each(['rgb_cct', 'fut089', 'rgbw'] as const)('sends set_white for %s', (remoteType) => {
    expect(buildHubCommandBody({ whiteMode: true }, remoteType).body).toEqual({ commands: ['set_white'] });
  });

  it.each(['cct', 'fut091'] as const)(
    'sends set_white for %s because it can do white tones',
    (remoteType) => {
      expect(buildHubCommandBody({ whiteMode: true }, remoteType).body).toEqual({
        commands: ['set_white'],
      });
    },
  );

  it.each(['rgb', 'fut020'] as const)('reports white mode as unsupported on %s', (remoteType) => {
    const result = buildHubCommandBody({ whiteMode: true }, remoteType);
    expect(result.body).toEqual({});
    expect(result.unsupported).toEqual(['whiteMode']);
  });

  it.each(['rgb_cct', 'fut089', 'cct', 'fut091'] as const)(
    'converts a colour temperature to mireds for %s',
    (remoteType) => {
      expect(buildHubCommandBody({ colorTemperature: 3000 }, remoteType).body).toEqual({
        color_temp: kelvinToMired(3000),
      });
      expect(buildHubCommandBody({ colorTemperature: 2700 }, remoteType).body).toEqual({ color_temp: 370 });
      expect(buildHubCommandBody({ colorTemperature: 6500 }, remoteType).body).toEqual({ color_temp: 154 });
    },
  );

  it.each(['rgbw', 'rgb', 'fut020'] as const)(
    'drops the colour temperature as unsupported on %s',
    (remoteType) => {
      const result = buildHubCommandBody({ colorTemperature: 3000 }, remoteType);
      expect(result.body).toEqual({});
      expect(result.unsupported).toEqual(['colorTemperature']);
    },
  );
});

describe('buildHubCommandBody: colour', () => {
  it.each(['rgb_cct', 'fut089', 'rgbw', 'rgb', 'fut020'] as const)('sets hue and saturation on %s', (t) => {
    expect(buildHubCommandBody({ hue: 200, saturation: 60 }, t).body).toEqual({ hue: 200, saturation: 60 });
  });

  it('accepts a hex colour just as well', () => {
    expect(buildHubCommandBody({ hex: '#00ff00' }, 'rgb_cct').body).toEqual({ hue: 120, saturation: 100 });
  });

  it.each(['cct', 'fut091'] as const)('drops the colour as unsupported on %s', (remoteType) => {
    const result = buildHubCommandBody({ hue: 200 }, remoteType);
    expect(result.body).toEqual({});
    expect(result.unsupported).toEqual(['color']);
  });

  it('ignores an unparseable hex colour without reporting it as unsupported', () => {
    const result = buildHubCommandBody({ hex: 'nonsense' }, 'rgb_cct');
    expect(result.body).toEqual({});
    expect(result.unsupported).toEqual([]);
  });
});

describe('buildHubCommandBody: effects', () => {
  it.each(['rgb_cct', 'fut089', 'rgbw', 'rgb', 'fut020'] as const)('selects a mode on %s', (remoteType) => {
    expect(buildHubCommandBody({ effect: 5 }, remoteType).body).toEqual({ mode: 5 });
    expect(buildHubCommandBody({ effect: 0 }, remoteType).body).toEqual({ mode: 0 });
    expect(buildHubCommandBody({ effect: 8 }, remoteType).body).toEqual({ mode: 8 });
  });

  it('advances to the next mode instead of selecting one', () => {
    expect(buildHubCommandBody({ effect: 'next' }, 'rgb_cct').body).toEqual({ commands: ['next_mode'] });
  });

  it.each([
    { effectSpeed: 'up' as const, command: 'mode_speed_up' },
    { effectSpeed: 'down' as const, command: 'mode_speed_down' },
  ])('maps the effect speed $effectSpeed', ({ effectSpeed, command }) => {
    expect(buildHubCommandBody({ effectSpeed }, 'rgb_cct').body).toEqual({ commands: [command] });
  });

  it.each(['cct', 'fut091'] as const)('reports effects as unsupported on %s', (remoteType) => {
    expect(buildHubCommandBody({ effect: 3 }, remoteType).unsupported).toEqual(['effects']);
    expect(buildHubCommandBody({ effect: 'next' }, remoteType).unsupported).toEqual(['effects']);
    expect(buildHubCommandBody({ effectSpeed: 'up' }, remoteType).unsupported).toEqual(['effects']);
  });
});

describe('buildHubCommandBody: night mode and transitions', () => {
  it.each(['rgb_cct', 'fut089', 'rgbw', 'cct', 'fut091'] as const)('sends night_mode on %s', (t) => {
    expect(buildHubCommandBody({ nightMode: true }, t).body).toEqual({ commands: ['night_mode'] });
  });

  it.each(['rgb', 'fut020'] as const)('reports night mode as unsupported on %s', (remoteType) => {
    expect(buildHubCommandBody({ nightMode: true }, remoteType).unsupported).toEqual(['nightMode']);
  });

  it('always queues night_mode last, after every other command', () => {
    const { body } = buildHubCommandBody(
      { power: 'toggle', brightnessStep: 20, whiteMode: true, effectSpeed: 'up', nightMode: true },
      'rgb_cct',
    );
    expect(body.commands).toEqual([
      'toggle',
      'level_up',
      'level_up',
      'set_white',
      'mode_speed_up',
      'night_mode',
    ]);
  });

  it.each([
    { transitionMs: 1000, transition: 1 },
    { transitionMs: 1500, transition: 1.5 },
    { transitionMs: 250, transition: 0.3 },
    { transitionMs: 60_000, transition: 60 },
    { transitionMs: 50, transition: 0.1 },
  ])('converts $transitionMs ms into $transition s', ({ transitionMs, transition }) => {
    expect(buildHubCommandBody({ power: 'on', transitionMs }, 'rgb_cct').body.transition).toBe(transition);
  });

  it('omits the transition entirely when it is zero', () => {
    expect(buildHubCommandBody({ power: 'on', transitionMs: 0 }, 'rgb_cct').body).toEqual({ status: 'ON' });
  });
});

describe('buildHubCommandBody: every remote type at once', () => {
  const command: LightCommand = {
    power: 'on',
    brightness: 60,
    hue: 120,
    saturation: 80,
    effect: 2,
    nightMode: true,
    transitionMs: 1000,
  };

  const expected: Record<RemoteType, { body: unknown; unsupported: string[] }> = {
    rgb_cct: {
      body: {
        status: 'ON',
        level: 60,
        hue: 120,
        saturation: 80,
        mode: 2,
        commands: ['night_mode'],
        transition: 1,
      },
      unsupported: [],
    },
    fut089: {
      body: {
        status: 'ON',
        level: 60,
        hue: 120,
        saturation: 80,
        mode: 2,
        commands: ['night_mode'],
        transition: 1,
      },
      unsupported: [],
    },
    rgbw: {
      body: {
        status: 'ON',
        level: 60,
        hue: 120,
        saturation: 80,
        mode: 2,
        commands: ['night_mode'],
        transition: 1,
      },
      unsupported: [],
    },
    cct: {
      body: { status: 'ON', level: 60, commands: ['night_mode'], transition: 1 },
      unsupported: ['color', 'effects'],
    },
    fut091: {
      body: { status: 'ON', level: 60, commands: ['night_mode'], transition: 1 },
      unsupported: ['color', 'effects'],
    },
    rgb: {
      body: {
        status: 'ON',
        hue: 120,
        saturation: 80,
        mode: 2,
        commands: ['level_up', 'level_up', 'level_up', 'level_up'],
        transition: 1,
      },
      unsupported: ['nightMode'],
    },
    fut020: {
      body: {
        hue: 120,
        saturation: 80,
        mode: 2,
        commands: ['toggle'],
        transition: 1,
      },
      unsupported: ['brightness', 'nightMode'],
    },
  };

  it.each(REMOTE_TYPES)('translates the kitchen-sink command for %s', (remoteType) => {
    const result = buildHubCommandBody(command, remoteType);
    expect(result.body).toEqual(expected[remoteType].body);
    expect(result.unsupported).toEqual(expected[remoteType].unsupported);
  });

  it.each(REMOTE_TYPES)('produces an empty body for an empty command on %s', (remoteType) => {
    expect(buildHubCommandBody({}, remoteType)).toEqual({ body: {}, unsupported: [] });
  });
});

describe('applyCommandToState', () => {
  it('stamps the supplied clock onto updatedAt', () => {
    expect(applyCommandToState(stateOf(), { power: 'on' }, 'rgb_cct', LATER).updatedAt).toBe(
      LATER.toISOString(),
    );
  });

  it('never mutates the state it was given', () => {
    const state = stateOf({ power: 'off' });
    const snapshot = { ...state };
    applyCommandToState(state, { power: 'on', brightness: 10 }, 'rgb_cct', NOW);
    expect(state).toEqual(snapshot);
  });

  it.each([
    { from: 'on' as const, to: 'off' as const },
    { from: 'off' as const, to: 'on' as const },
  ])('toggles $from to $to', ({ from, to }) => {
    expect(applyCommandToState(stateOf({ power: from }), { power: 'toggle' }, 'rgb_cct', NOW).power).toBe(to);
  });

  it('applies absolute brightness and clears night mode', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', nightMode: true, brightness: 1 }),
      { brightness: 70 },
      'rgb_cct',
      NOW,
    );
    expect(next.brightness).toBe(70);
    expect(next.nightMode).toBe(false);
  });

  it('applies a relative brightness step against the current level', () => {
    expect(
      applyCommandToState(stateOf({ power: 'on', brightness: 40 }), { brightnessStep: 25 }, 'rgb_cct', NOW)
        .brightness,
    ).toBe(65);
    expect(
      applyCommandToState(stateOf({ power: 'on', brightness: 10 }), { brightnessStep: -50 }, 'rgb_cct', NOW)
        .brightness,
    ).toBe(0);
    expect(
      applyCommandToState(stateOf({ power: 'on', brightness: 90 }), { brightnessStep: 50 }, 'rgb_cct', NOW)
        .brightness,
    ).toBe(100);
  });

  it('leaves brightness untouched for a protocol that cannot address it', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', brightness: 100 }),
      { brightness: 20 },
      'fut020',
      NOW,
    );
    expect(next.brightness).toBe(100);
  });

  it('forces on plus a brightness of 1 for night mode', () => {
    const next = applyCommandToState(
      stateOf({ power: 'off', brightness: 80 }),
      { nightMode: true },
      'rgb_cct',
      NOW,
    );
    expect(next).toMatchObject({ power: 'on', brightness: 1, nightMode: true });
  });

  it('ignores night mode on a protocol that lacks it', () => {
    const next = applyCommandToState(stateOf({ power: 'on' }), { nightMode: true }, 'rgb', NOW);
    expect(next.nightMode).toBe(false);
    expect(next.brightness).toBe(DEFAULT_LIGHT_STATE.brightness);
  });

  it('switches to white mode, dropping saturation and any effect', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', colorMode: 'color', saturation: 90, effect: 4 }),
      { whiteMode: true },
      'rgb_cct',
      NOW,
    );
    expect(next).toMatchObject({ colorMode: 'white', saturation: 0, effect: null });
  });

  it('lets a colour temperature clear the colour mode and the effect', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', colorMode: 'color', effect: 2 }),
      { colorTemperature: 3200 },
      'rgb_cct',
      NOW,
    );
    expect(next).toMatchObject({ colorMode: 'white', colorTemperature: 3200, effect: null });
  });

  it('clamps a colour temperature into the supported kelvin band', () => {
    const state = stateOf({ power: 'on' });
    expect(applyCommandToState(state, { colorTemperature: 9000 }, 'rgb_cct', NOW).colorTemperature).toBe(
      6500,
    );
    expect(applyCommandToState(state, { colorTemperature: 1000 }, 'rgb_cct', NOW).colorTemperature).toBe(
      2700,
    );
  });

  it('ignores a colour temperature on a protocol without white tones', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', colorMode: 'color', colorTemperature: 4000 }),
      { colorTemperature: 3000 },
      'rgbw',
      NOW,
    );
    expect(next.colorTemperature).toBe(4000);
    expect(next.colorMode).toBe('color');
  });

  it('lets a colour clear the effect and switch the colour mode', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', colorMode: 'white', effect: 6 }),
      { hue: 300, saturation: 40 },
      'rgb_cct',
      NOW,
    );
    expect(next).toMatchObject({ hue: 300, saturation: 40, colorMode: 'color', effect: null });
  });

  it('ignores a colour on a protocol without colour', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', colorMode: 'white', hue: 10 }),
      { hue: 300 },
      'cct',
      NOW,
    );
    expect(next.hue).toBe(10);
    expect(next.colorMode).toBe('white');
  });

  it.each([
    { from: null, expected: 0 },
    { from: 0, expected: 1 },
    { from: 7, expected: 8 },
    { from: 8, expected: 0 },
  ])('cycles the effect from $from to $expected', ({ from, expected }) => {
    const next = applyCommandToState(
      stateOf({ power: 'on', effect: from }),
      { effect: 'next' },
      'rgb_cct',
      NOW,
    );
    expect(next.effect).toBe(expected);
  });

  it('clamps a selected effect to what the protocol offers', () => {
    expect(applyCommandToState(stateOf({ power: 'on' }), { effect: 8 }, 'rgb_cct', NOW).effect).toBe(8);
    expect(applyCommandToState(stateOf({ power: 'on' }), { effect: 3 }, 'cct', NOW).effect).toBeNull();
  });

  it.each([
    { command: { brightness: 55 }, why: 'a brightness' },
    { command: { hue: 100 }, why: 'a hue' },
    { command: { hex: '#00ff00' }, why: 'a hex colour' },
    { command: { colorTemperature: 3000 }, why: 'a colour temperature' },
  ])('implicitly powers a dark bulb on when given $why', ({ command }) => {
    const next = applyCommandToState(stateOf({ power: 'off' }), command, 'rgb_cct', NOW);
    expect(next.power).toBe('on');
  });

  it('does not implicitly power on when the command explicitly asked for off', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on' }),
      { power: 'off', brightness: 40 },
      'rgb_cct',
      NOW,
    );
    expect(next.power).toBe('off');
    expect(next.brightness).toBe(40);
  });

  it.each([
    { command: { effect: 3 }, why: 'an effect' },
    { command: { effectSpeed: 'up' as const }, why: 'an effect speed' },
    { command: { whiteMode: true }, why: 'white mode' },
  ])('does not implicitly power on for $why alone', ({ command }) => {
    expect(applyCommandToState(stateOf({ power: 'off' }), command, 'rgb_cct', NOW).power).toBe('off');
  });

  it('reports the colour mode as off whenever the bulb ends up powered off', () => {
    const next = applyCommandToState(
      stateOf({ power: 'on', colorMode: 'color' }),
      { power: 'off' },
      'rgb_cct',
      NOW,
    );
    expect(next.colorMode).toBe('off');
  });

  it.each([
    { saturation: 0, colorMode: 'white' },
    { saturation: 60, colorMode: 'color' },
  ])('restores the colour mode to $colorMode when powering on again', ({ saturation, colorMode }) => {
    const next = applyCommandToState(
      stateOf({ power: 'off', colorMode: 'off', saturation }),
      { power: 'on' },
      'rgb_cct',
      NOW,
    );
    expect(next.colorMode).toBe(colorMode);
  });

  it('defaults the clock to now when none is supplied', () => {
    const before = Date.now();
    const next = applyCommandToState(stateOf(), { power: 'on' }, 'rgb_cct');
    expect(Date.parse(next.updatedAt)).toBeGreaterThanOrEqual(before);
  });
});

describe('mergeHubState', () => {
  it('marks the light reachable and stamps the clock', () => {
    const next = mergeHubState(stateOf({ reachable: false }), {}, LATER);
    expect(next.reachable).toBe(true);
    expect(next.updatedAt).toBe(LATER.toISOString());
  });

  it.each([
    { hub: { state: 'ON' as const }, power: 'on' },
    { hub: { state: 'OFF' as const }, power: 'off' },
    { hub: { status: 'ON' as const }, power: 'on' },
    { hub: { status: 'OFF' as const }, power: 'off' },
  ])('reads the power from $hub', ({ hub, power }) => {
    expect(mergeHubState(stateOf({ power: 'off' }), hub, NOW).power).toBe(power);
  });

  it('prefers `state` over `status` when both are present', () => {
    expect(mergeHubState(stateOf(), { state: 'ON', status: 'OFF' }, NOW).power).toBe('on');
  });

  it('leaves the power alone when the hub reports neither field', () => {
    expect(mergeHubState(stateOf({ power: 'on' }), { level: 20 }, NOW).power).toBe('on');
  });

  it.each([
    { hub: { state: 'ON' as const, level: 60 }, brightness: 60 },
    { hub: { state: 'ON' as const, level: 250 }, brightness: 100 },
    { hub: { state: 'ON' as const, level: -10 }, brightness: 0 },
    { hub: { state: 'ON' as const, brightness: 255 }, brightness: 100 },
    { hub: { state: 'ON' as const, brightness: 128 }, brightness: 50 },
    { hub: { state: 'ON' as const, brightness: 0 }, brightness: 0 },
  ])('reads the brightness from $hub', ({ hub, brightness }) => {
    expect(mergeHubState(stateOf(), hub, NOW).brightness).toBe(brightness);
  });

  it('prefers the 0–100 `level` over the 0–255 `brightness`', () => {
    expect(mergeHubState(stateOf(), { state: 'ON', level: 10, brightness: 255 }, NOW).brightness).toBe(10);
  });

  it('normalises the hue and clamps the saturation', () => {
    const next = mergeHubState(stateOf(), { state: 'ON', hue: 400, saturation: 250 }, NOW);
    expect(next.hue).toBe(40);
    expect(next.saturation).toBe(100);
  });

  it.each([
    { hub: { state: 'ON' as const, color_temp: 200 }, kelvin: 5000 },
    { hub: { state: 'ON' as const, color_temp: 370 }, kelvin: 2703 },
    { hub: { state: 'ON' as const, kelvin: 0 }, kelvin: 2700 },
    { hub: { state: 'ON' as const, kelvin: 50 }, kelvin: 4600 },
    { hub: { state: 'ON' as const, kelvin: 100 }, kelvin: 6500 },
  ])('reads the colour temperature from $hub', ({ hub, kelvin }) => {
    expect(mergeHubState(stateOf(), hub, NOW).colorTemperature).toBe(kelvin);
  });

  it('prefers mireds over the kelvin percentage', () => {
    expect(
      mergeHubState(stateOf(), { state: 'ON', color_temp: 200, kelvin: 100 }, NOW).colorTemperature,
    ).toBe(5000);
  });

  it('reads and clamps the effect index', () => {
    expect(mergeHubState(stateOf(), { state: 'ON', mode: 4 }, NOW).effect).toBe(4);
    expect(mergeHubState(stateOf(), { state: 'ON', mode: 99 }, NOW).effect).toBe(8);
  });

  it.each([
    { bulb_mode: 'color', colorMode: 'color', nightMode: false },
    { bulb_mode: 'rgb', colorMode: 'color', nightMode: false },
    { bulb_mode: 'white', colorMode: 'white', nightMode: false },
    { bulb_mode: 'color_temp', colorMode: 'white', nightMode: false },
    { bulb_mode: 'scene', colorMode: 'color', nightMode: false },
    { bulb_mode: 'night', colorMode: 'white', nightMode: true },
  ])('maps bulb_mode $bulb_mode', ({ bulb_mode, colorMode, nightMode }) => {
    const next = mergeHubState(stateOf({ colorMode: 'white' }), { state: 'ON', bulb_mode }, NOW);
    expect(next.colorMode).toBe(colorMode);
    expect(next.nightMode).toBe(nightMode);
  });

  it('falls back to color_mode when bulb_mode is absent', () => {
    expect(mergeHubState(stateOf(), { state: 'ON', color_mode: 'color' }, NOW).colorMode).toBe('color');
  });

  it('prefers bulb_mode over color_mode', () => {
    const next = mergeHubState(stateOf(), { state: 'ON', bulb_mode: 'white', color_mode: 'color' }, NOW);
    expect(next.colorMode).toBe('white');
  });

  it('clears night mode when the hub reports any other mode', () => {
    expect(
      mergeHubState(stateOf({ nightMode: true }), { state: 'ON', bulb_mode: 'white' }, NOW).nightMode,
    ).toBe(false);
  });

  it('leaves night mode alone when the hub says nothing about the mode', () => {
    expect(mergeHubState(stateOf({ nightMode: true }), { state: 'ON' }, NOW).nightMode).toBe(true);
  });

  it('forces the colour mode to off for an unlit bulb', () => {
    expect(mergeHubState(stateOf(), { state: 'OFF', bulb_mode: 'color' }, NOW).colorMode).toBe('off');
  });

  it('ignores fields of the wrong type', () => {
    const hub = {
      level: '60',
      hue: '10',
      saturation: null,
      color_temp: 'warm',
      mode: '3',
    } as unknown as HubGroupState;
    const next = mergeHubState(stateOf({ power: 'on', brightness: 42, hue: 7 }), hub, NOW);
    expect(next).toMatchObject({ brightness: 42, hue: 7, effect: null });
  });

  it('ignores an empty payload but still refreshes reachability', () => {
    const state = stateOf({ power: 'on', reachable: false });
    expect(mergeHubState(state, {}, NOW)).toEqual({
      ...state,
      reachable: true,
      updatedAt: NOW.toISOString(),
    });
  });

  it('defaults the clock to now when none is supplied', () => {
    const before = Date.now();
    expect(Date.parse(mergeHubState(stateOf(), {}).updatedAt)).toBeGreaterThanOrEqual(before);
  });
});
