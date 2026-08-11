import { describe, expect, it } from 'vitest';

import { makeLight, makeState } from '../test-utils/index.js';

import { captureSceneSteps, commandFromGroup, commandFromLight } from './scene-capture.js';

describe('commandFromLight', () => {
  it('captures only power for a light that is off', () => {
    expect(commandFromLight(makeLight({ state: makeState({ power: 'off' }) }))).toEqual({ power: 'off' });
  });

  it('captures brightness and colour for an rgb_cct light in colour mode', () => {
    const light = makeLight({
      remoteType: 'rgb_cct',
      state: makeState({ power: 'on', brightness: 60, colorMode: 'color', hue: 30, saturation: 80 }),
    });

    expect(commandFromLight(light)).toEqual({
      power: 'on',
      brightness: 60,
      hue: 30,
      saturation: 80,
    });
  });

  it('captures colour temperature when the light is in white mode', () => {
    const light = makeLight({
      remoteType: 'cct',
      state: makeState({ power: 'on', brightness: 40, colorMode: 'white', colorTemperature: 3200 }),
    });

    expect(commandFromLight(light)).toEqual({ power: 'on', brightness: 40, colorTemperature: 3200 });
  });

  it('falls back to white mode for rgbw lights without a temperature channel', () => {
    const light = makeLight({
      remoteType: 'rgbw',
      state: makeState({ power: 'on', colorMode: 'white' }),
    });

    expect(commandFromLight(light)).toMatchObject({ whiteMode: true });
  });

  it('captures the running effect instead of the colour', () => {
    const light = makeLight({
      remoteType: 'rgb_cct',
      state: makeState({ power: 'on', brightness: 70, effect: 5, colorMode: 'color' }),
    });

    expect(commandFromLight(light)).toEqual({ power: 'on', brightness: 70, effect: 5 });
  });

  it('omits absolute brightness for protocols that cannot set it', () => {
    const light = makeLight({ remoteType: 'rgb', state: makeState({ power: 'on', brightness: 70 }) });

    expect(commandFromLight(light).brightness).toBeUndefined();
  });
});

describe('commandFromGroup', () => {
  it('returns null for an empty group', () => {
    expect(commandFromGroup([])).toBeNull();
  });

  it('prefers a member that is on', () => {
    const off = makeLight({ state: makeState({ power: 'off' }) });
    const on = makeLight({ state: makeState({ power: 'on', brightness: 25 }) });

    expect(commandFromGroup([off, on])).toMatchObject({ power: 'on', brightness: 25 });
  });

  it('drops brightness when no member can set it absolutely', () => {
    const light = makeLight({ remoteType: 'rgb_cct', state: makeState({ power: 'on', brightness: 25 }) });
    const strip = makeLight({ remoteType: 'fut020' });

    // The representative supports brightness but the union does not.
    expect(commandFromGroup([light])).toHaveProperty('brightness');
    expect(commandFromGroup([strip, light])).toHaveProperty('brightness');
    expect(commandFromGroup([strip])).not.toHaveProperty('brightness');
  });
});

describe('captureSceneSteps', () => {
  it('builds one step per selected light and group', () => {
    const first = makeLight({ state: makeState({ power: 'on', brightness: 10 }) });
    const second = makeLight({ state: makeState({ power: 'off' }) });

    const steps = captureSceneSteps({
      lights: [first, second],
      selectedLightIds: [first.id, 'unknown'],
      groups: [{ id: 'group-1', lightIds: [second.id] }],
      selectedGroupIds: ['group-1', 'missing'],
    });

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ targetType: 'light', targetId: first.id });
    expect(steps[1]).toMatchObject({ targetType: 'group', targetId: 'group-1' });
  });

  it('skips groups whose members are all unknown', () => {
    expect(
      captureSceneSteps({
        lights: [],
        selectedLightIds: [],
        groups: [{ id: 'group-1', lightIds: ['ghost'] }],
        selectedGroupIds: ['group-1'],
      }),
    ).toEqual([]);
  });
});
