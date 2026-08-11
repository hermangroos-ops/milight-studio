import { MAX_KELVIN, MAX_MIRED, MIN_KELVIN, MIN_MIRED, type LightState } from '@milight-studio/shared';
import { describe, expect, it } from 'vitest';

import {
  COLOR_MODE_COLOR_TEMPERATURE,
  COLOR_MODE_HUE_SATURATION,
  MATTER_HUE_MAX,
  MATTER_LEVEL_MAX,
  MATTER_LEVEL_MIN,
  MAX_TRANSITION_MS,
  aggregateLightStates,
  brightnessToLevel,
  degreesToMatterHue,
  enhancedHueToDegrees,
  enhancedHueToMatterHue,
  kelvinToMireds,
  levelToBrightness,
  lightStateToMatterAttributes,
  matterHueToDegrees,
  matterSaturationToPercent,
  matterXyToUnit,
  miredsToKelvin,
  percentToMatterSaturation,
  transitionTimeToMs,
} from './attribute-mapping.js';

function state(overrides: Partial<LightState> = {}): LightState {
  return {
    power: 'on',
    brightness: 50,
    colorMode: 'color',
    hue: 120,
    saturation: 80,
    colorTemperature: 4000,
    effect: null,
    nightMode: false,
    reachable: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('brightness and level', () => {
  it('maps the ends of the scale onto each other', () => {
    expect(brightnessToLevel(100)).toBe(MATTER_LEVEL_MAX);
    expect(levelToBrightness(MATTER_LEVEL_MAX)).toBe(100);
    // 0 is reserved for "off" on a lighting endpoint, so 0 % becomes the minimum level.
    expect(brightnessToLevel(0)).toBe(MATTER_LEVEL_MIN);
    expect(levelToBrightness(0)).toBe(0);
  });

  it('clamps beyond both ends', () => {
    expect(brightnessToLevel(-50)).toBe(MATTER_LEVEL_MIN);
    expect(brightnessToLevel(500)).toBe(MATTER_LEVEL_MAX);
    expect(levelToBrightness(-10)).toBe(0);
    expect(levelToBrightness(1_000)).toBe(100);
  });

  it('round-trips every percentage to within one percent', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(Math.abs(levelToBrightness(brightnessToLevel(percent)) - percent)).toBeLessThanOrEqual(1);
    }
  });
});

describe('hue', () => {
  it('maps the ends of the scale onto each other', () => {
    expect(degreesToMatterHue(0)).toBe(0);
    expect(degreesToMatterHue(359)).toBe(MATTER_HUE_MAX);
    expect(matterHueToDegrees(0)).toBe(0);
    expect(matterHueToDegrees(MATTER_HUE_MAX)).toBe(359);
  });

  it('wraps and clamps out-of-range input', () => {
    expect(degreesToMatterHue(360)).toBe(0);
    expect(degreesToMatterHue(-1)).toBe(degreesToMatterHue(359));
    expect(matterHueToDegrees(255)).toBe(359);
    expect(matterHueToDegrees(-5)).toBe(0);
  });

  it('round-trips every degree to within two degrees', () => {
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const back = matterHueToDegrees(degreesToMatterHue(degrees));
      expect(Math.abs(back - degrees)).toBeLessThanOrEqual(2);
    }
  });

  it('folds a 16-bit enhanced hue back onto the byte scale', () => {
    expect(enhancedHueToDegrees(0)).toBe(0);
    expect(enhancedHueToDegrees(65_535)).toBe(359);
    expect(enhancedHueToDegrees(1_000_000)).toBe(359);
    expect(enhancedHueToMatterHue(0)).toBe(0);
    expect(enhancedHueToMatterHue(65_535)).toBe(MATTER_HUE_MAX);
    expect(enhancedHueToMatterHue(32_768)).toBe(degreesToMatterHue(180));
  });
});

describe('saturation', () => {
  it('maps the ends of the scale onto each other', () => {
    expect(percentToMatterSaturation(0)).toBe(0);
    expect(percentToMatterSaturation(100)).toBe(254);
    expect(matterSaturationToPercent(0)).toBe(0);
    expect(matterSaturationToPercent(254)).toBe(100);
  });

  it('clamps beyond both ends', () => {
    expect(percentToMatterSaturation(-10)).toBe(0);
    expect(percentToMatterSaturation(200)).toBe(254);
    expect(matterSaturationToPercent(255)).toBe(100);
    expect(matterSaturationToPercent(-1)).toBe(0);
  });

  it('round-trips every percentage to within one percent', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const back = matterSaturationToPercent(percentToMatterSaturation(percent));
      expect(Math.abs(back - percent)).toBeLessThanOrEqual(1);
    }
  });
});

describe('colour temperature', () => {
  it('clamps to what a MiBoxer bulb can actually produce', () => {
    expect(kelvinToMireds(MIN_KELVIN)).toBe(MAX_MIRED);
    expect(kelvinToMireds(1_000)).toBe(MAX_MIRED);
    // 6500 K is the coolest a MiBoxer bulb goes, which is a hair above the mired floor.
    expect(kelvinToMireds(40_000)).toBe(kelvinToMireds(MAX_KELVIN));
    expect(kelvinToMireds(MAX_KELVIN)).toBeGreaterThanOrEqual(MIN_MIRED);
    expect(kelvinToMireds(MAX_KELVIN)).toBeLessThan(MIN_MIRED + 5);
    expect(miredsToKelvin(10)).toBe(MAX_KELVIN);
    expect(miredsToKelvin(10_000)).toBeLessThanOrEqual(MIN_KELVIN + 5);
  });

  it('round-trips the usable range to within a few kelvin', () => {
    for (let kelvin = MIN_KELVIN; kelvin <= MAX_KELVIN; kelvin += 100) {
      const back = miredsToKelvin(kelvinToMireds(kelvin));
      expect(back).toBeGreaterThanOrEqual(MIN_KELVIN);
      expect(back).toBeLessThanOrEqual(MAX_KELVIN);
      expect(Math.abs(back - kelvin)).toBeLessThanOrEqual(30);
    }
  });
});

describe('transitionTimeToMs', () => {
  it('converts tenths of a second into milliseconds', () => {
    expect(transitionTimeToMs(10)).toBe(1_000);
    expect(transitionTimeToMs(5)).toBe(500);
    expect(transitionTimeToMs(1)).toBe(100);
  });

  it('treats "no transition" as an absent fade rather than a zero-length one', () => {
    expect(transitionTimeToMs(null)).toBeUndefined();
    expect(transitionTimeToMs(undefined)).toBeUndefined();
    expect(transitionTimeToMs(0)).toBeUndefined();
    expect(transitionTimeToMs(-5)).toBeUndefined();
    expect(transitionTimeToMs(Number.NaN)).toBeUndefined();
    // 0xffff is the spec's "use the device default".
    expect(transitionTimeToMs(0xffff)).toBeUndefined();
  });

  it('clamps to the longest fade a command may carry', () => {
    expect(transitionTimeToMs(0xfffe)).toBe(MAX_TRANSITION_MS);
  });
});

describe('matterXyToUnit', () => {
  it('scales 16.16 fixed point into the 0–1 CIE range', () => {
    expect(matterXyToUnit(0)).toBe(0);
    expect(matterXyToUnit(65_536)).toBe(1);
    expect(matterXyToUnit(32_768)).toBeCloseTo(0.5, 5);
    expect(matterXyToUnit(-100)).toBe(0);
    expect(matterXyToUnit(1_000_000)).toBe(1);
  });
});

describe('lightStateToMatterAttributes', () => {
  it('projects a colour state onto the cluster attributes', () => {
    expect(lightStateToMatterAttributes(state())).toStrictEqual({
      onOff: true,
      currentLevel: brightnessToLevel(50),
      currentHue: degreesToMatterHue(120),
      currentSaturation: percentToMatterSaturation(80),
      colorTemperatureMireds: kelvinToMireds(4_000),
      colorMode: COLOR_MODE_HUE_SATURATION,
    });
  });

  it('reports colour temperature mode for white and for off', () => {
    expect(lightStateToMatterAttributes(state({ colorMode: 'white' })).colorMode).toBe(
      COLOR_MODE_COLOR_TEMPERATURE,
    );
    expect(lightStateToMatterAttributes(state({ colorMode: 'off' })).colorMode).toBe(
      COLOR_MODE_COLOR_TEMPERATURE,
    );
  });

  it('reflects power', () => {
    expect(lightStateToMatterAttributes(state({ power: 'off' })).onOff).toBe(false);
  });
});

describe('aggregateLightStates', () => {
  it('has nothing to say about an empty group', () => {
    expect(aggregateLightStates([])).toBeNull();
  });

  it('is on when any member is on and averages the lit members brightness', () => {
    const aggregate = aggregateLightStates([
      state({ power: 'off', brightness: 10 }),
      state({ power: 'on', brightness: 60 }),
      state({ power: 'on', brightness: 80 }),
    ]);
    expect(aggregate?.power).toBe('on');
    expect(aggregate?.brightness).toBe(70);
  });

  it('averages every member when the whole group is off', () => {
    const aggregate = aggregateLightStates([
      state({ power: 'off', brightness: 20 }),
      state({ power: 'off', brightness: 40 }),
    ]);
    expect(aggregate?.power).toBe('off');
    expect(aggregate?.brightness).toBe(30);
  });

  it('takes colour from a lit member', () => {
    const aggregate = aggregateLightStates([
      state({ power: 'off', hue: 0, saturation: 0 }),
      state({ power: 'on', hue: 200, saturation: 90 }),
    ]);
    expect(aggregate?.hue).toBe(200);
    expect(aggregate?.saturation).toBe(90);
  });

  it('is unreachable as soon as one member is', () => {
    const aggregate = aggregateLightStates([state({ reachable: true }), state({ reachable: false })]);
    expect(aggregate?.reachable).toBe(false);
  });

  it('reports the most recent update time', () => {
    const aggregate = aggregateLightStates([
      state({ updatedAt: '2026-01-01T00:00:00.000Z' }),
      state({ updatedAt: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(aggregate?.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});
