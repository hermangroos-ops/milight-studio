import { describe, expect, it } from 'vitest';

import { MAX_KELVIN, MIN_KELVIN } from './color.js';
import {
  DEFAULT_LIGHT_STATE,
  MAX_EFFECT_INDEX,
  colorModeSchema,
  createDefaultLightState,
  lightCommandSchema,
  lightStateSchema,
  powerStateSchema,
} from './light-state.js';

describe('createDefaultLightState', () => {
  it('produces a state that satisfies the schema', () => {
    const state = createDefaultLightState(new Date('2024-05-04T03:02:01.000Z'));
    expect(lightStateSchema.parse(state)).toEqual(state);
    expect(state.updatedAt).toBe('2024-05-04T03:02:01.000Z');
  });

  it('copies the frozen defaults rather than sharing them', () => {
    const state = createDefaultLightState(new Date(0));
    expect(state).toMatchObject(DEFAULT_LIGHT_STATE);
    expect(Object.isFrozen(state)).toBe(false);
    state.brightness = 10;
    expect(DEFAULT_LIGHT_STATE.brightness).toBe(100);
  });

  it('defaults to now when no clock is supplied', () => {
    const before = Date.now();
    const state = createDefaultLightState();
    expect(Date.parse(state.updatedAt)).toBeGreaterThanOrEqual(before);
  });
});

describe('enums', () => {
  it.each(['on', 'off'])('accepts the power state %s', (value) => {
    expect(powerStateSchema.parse(value)).toBe(value);
  });

  it.each(['color', 'white', 'off'])('accepts the colour mode %s', (value) => {
    expect(colorModeSchema.parse(value)).toBe(value);
  });

  it.each(['ON', 'toggle', '', null])('rejects the power state %p', (value) => {
    expect(powerStateSchema.safeParse(value).success).toBe(false);
  });
});

describe('lightStateSchema', () => {
  const state = createDefaultLightState(new Date('2024-01-01T00:00:00.000Z'));

  it.each([
    { patch: { brightness: 101 }, why: 'brightness above 100' },
    { patch: { brightness: -1 }, why: 'negative brightness' },
    { patch: { brightness: 50.5 }, why: 'fractional brightness' },
    { patch: { hue: 360 }, why: 'hue of 360' },
    { patch: { saturation: 101 }, why: 'saturation above 100' },
    { patch: { colorTemperature: MIN_KELVIN - 1 }, why: 'colour temperature below the minimum' },
    { patch: { colorTemperature: MAX_KELVIN + 1 }, why: 'colour temperature above the maximum' },
    { patch: { effect: MAX_EFFECT_INDEX + 1 }, why: 'effect index above the maximum' },
    { patch: { extra: true }, why: 'unknown key' },
  ])('rejects a state with a $why', ({ patch }) => {
    expect(lightStateSchema.safeParse({ ...state, ...patch }).success).toBe(false);
  });

  it('accepts a null effect and both bounds of every range', () => {
    expect(
      lightStateSchema.safeParse({
        ...state,
        effect: null,
        brightness: 0,
        hue: 359,
        saturation: 100,
        colorTemperature: MAX_KELVIN,
      }).success,
    ).toBe(true);
  });
});

describe('lightCommandSchema', () => {
  it('rejects an empty command', () => {
    const result = lightCommandSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Command must contain at least one field');
  });

  it('rejects an unknown key even alongside valid ones', () => {
    expect(lightCommandSchema.safeParse({ power: 'on', warp: 9 }).success).toBe(false);
  });

  it.each([
    { command: { power: 'on' } },
    { command: { power: 'off' } },
    { command: { power: 'toggle' } },
    { command: { brightness: 0 } },
    { command: { brightness: 100 } },
    { command: { brightnessStep: -100 } },
    { command: { brightnessStep: 100 } },
    { command: { hue: 0 } },
    { command: { hue: 359 } },
    { command: { saturation: 50 } },
    { command: { colorTemperature: MIN_KELVIN } },
    { command: { colorTemperature: MAX_KELVIN } },
    { command: { whiteMode: true } },
    { command: { nightMode: true } },
    { command: { effect: 0 } },
    { command: { effect: MAX_EFFECT_INDEX } },
    { command: { effect: 'next' } },
    { command: { effectSpeed: 'up' } },
    { command: { effectSpeed: 'down' } },
    { command: { transitionMs: 0 } },
    { command: { transitionMs: 600_000 } },
  ])('accepts $command', ({ command }) => {
    expect(lightCommandSchema.parse(command)).toEqual(command);
  });

  it.each([
    { command: { power: 'ON' }, why: 'a power value with the wrong case' },
    { command: { brightness: 101 }, why: 'brightness above 100' },
    { command: { brightness: -1 }, why: 'negative brightness' },
    { command: { brightness: 12.5 }, why: 'fractional brightness' },
    { command: { brightnessStep: 101 }, why: 'a step above 100' },
    { command: { brightnessStep: -101 }, why: 'a step below -100' },
    { command: { hue: 360 }, why: 'a hue of 360' },
    { command: { hue: -1 }, why: 'a negative hue' },
    { command: { saturation: 101 }, why: 'saturation above 100' },
    { command: { colorTemperature: MIN_KELVIN - 1 }, why: 'a temperature below the minimum' },
    { command: { colorTemperature: MAX_KELVIN + 1 }, why: 'a temperature above the maximum' },
    { command: { whiteMode: false }, why: 'whiteMode set to false' },
    { command: { nightMode: false }, why: 'nightMode set to false' },
    { command: { effect: MAX_EFFECT_INDEX + 1 }, why: 'an effect above the maximum' },
    { command: { effect: 'previous' }, why: 'an unknown effect keyword' },
    { command: { effectSpeed: 'faster' }, why: 'an unknown effect speed' },
    { command: { transitionMs: 600_001 }, why: 'a transition longer than ten minutes' },
    { command: { transitionMs: -1 }, why: 'a negative transition' },
  ])('rejects $why', ({ command }) => {
    expect(lightCommandSchema.safeParse(command).success).toBe(false);
  });

  it.each(['#fff', 'fff', '#FFFFFF', 'ffffff', '#Ff8800', '#000'])('accepts the hex colour %s', (hex) => {
    expect(lightCommandSchema.parse({ hex }).hex).toBe(hex);
  });

  it.each(['#ff', '#ffff', '#fffff', '#fffffff', 'gggggg', '#gg0000', '', 'red', '# fff'])(
    'rejects the hex colour %p',
    (hex) => {
      expect(lightCommandSchema.safeParse({ hex }).success).toBe(false);
    },
  );

  it('allows the combinations the schema cannot arbitrate (validateCommand does)', () => {
    expect(lightCommandSchema.safeParse({ hue: 10, colorTemperature: 3000 }).success).toBe(true);
    expect(lightCommandSchema.safeParse({ brightness: 10, brightnessStep: 10 }).success).toBe(true);
  });
});
