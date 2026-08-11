import { REMOTE_TYPES, type RemoteType } from '@milight-studio/shared';
import { describe, expect, it } from 'vitest';

import {
  SCENE_PROFILE,
  brightnessCommand,
  colorCommand,
  colorTemperatureCommand,
  deviceProfileForGroup,
  deviceProfileForRemoteType,
  endpointIdFor,
  kindHasColorControl,
  kindHasColorTemperature,
  kindHasHueSaturation,
  kindHasLevelControl,
  powerCommand,
  uniqueIdFor,
  withTransition,
  type MatterDeviceProfile,
  type MatterLightKind,
} from './device-mapping.js';

interface Expectation {
  kind: MatterLightKind;
  supportsPower: boolean;
  supportsToggle: boolean;
  brightnessMode: MatterDeviceProfile['brightnessMode'];
  supportsColor: boolean;
  supportsColorTemperature: boolean;
  supportsWhiteMode: boolean;
}

const EXPECTED: Record<RemoteType, Expectation> = {
  rgb_cct: {
    kind: 'extendedColor',
    supportsPower: true,
    supportsToggle: false,
    brightnessMode: 'absolute',
    supportsColor: true,
    supportsColorTemperature: true,
    supportsWhiteMode: true,
  },
  fut089: {
    kind: 'extendedColor',
    supportsPower: true,
    supportsToggle: false,
    brightnessMode: 'absolute',
    supportsColor: true,
    supportsColorTemperature: true,
    supportsWhiteMode: true,
  },
  rgbw: {
    kind: 'extendedColor',
    supportsPower: true,
    supportsToggle: false,
    brightnessMode: 'absolute',
    supportsColor: true,
    supportsColorTemperature: false,
    supportsWhiteMode: true,
  },
  rgb: {
    kind: 'extendedColor',
    supportsPower: true,
    supportsToggle: false,
    brightnessMode: 'relative',
    supportsColor: true,
    supportsColorTemperature: false,
    supportsWhiteMode: false,
  },
  fut020: {
    kind: 'extendedColor',
    supportsPower: false,
    supportsToggle: true,
    brightnessMode: 'none',
    supportsColor: true,
    supportsColorTemperature: false,
    supportsWhiteMode: false,
  },
  cct: {
    kind: 'colorTemperature',
    supportsPower: true,
    supportsToggle: false,
    brightnessMode: 'absolute',
    supportsColor: false,
    supportsColorTemperature: true,
    supportsWhiteMode: false,
  },
  fut091: {
    kind: 'colorTemperature',
    supportsPower: true,
    supportsToggle: false,
    brightnessMode: 'absolute',
    supportsColor: false,
    supportsColorTemperature: true,
    supportsWhiteMode: false,
  },
};

describe('deviceProfileForRemoteType', () => {
  it.each(REMOTE_TYPES)('maps %s onto the most capable Matter device type', (remoteType) => {
    expect(deviceProfileForRemoteType(remoteType)).toStrictEqual(EXPECTED[remoteType]);
  });

  it('covers every known remote type', () => {
    expect(Object.keys(EXPECTED).sort()).toStrictEqual([...REMOTE_TYPES].sort());
  });
});

describe('deviceProfileForGroup', () => {
  it('takes the union of its members capabilities', () => {
    const profile = deviceProfileForGroup(['cct', 'rgbw']);
    expect(profile.kind).toBe('extendedColor');
    expect(profile.supportsColor).toBe(true);
    expect(profile.supportsColorTemperature).toBe(true);
    expect(profile.brightnessMode).toBe('absolute');
  });

  it('stays a colour temperature light when no member does colour', () => {
    expect(deviceProfileForGroup(['cct', 'fut091']).kind).toBe('colorTemperature');
  });

  it('prefers absolute brightness when at least one member supports it', () => {
    expect(deviceProfileForGroup(['rgb', 'rgb_cct']).brightnessMode).toBe('absolute');
    expect(deviceProfileForGroup(['rgb', 'fut020']).brightnessMode).toBe('relative');
    expect(deviceProfileForGroup(['fut020']).brightnessMode).toBe('none');
  });

  it('falls back to a dimmable light for an empty group', () => {
    const profile = deviceProfileForGroup([]);
    expect(profile.kind).toBe('dimmable');
    expect(profile.supportsColor).toBe(false);
  });
});

describe('cluster predicates', () => {
  it('describes which clusters each device kind carries', () => {
    expect(kindHasLevelControl('onOff')).toBe(false);
    expect(kindHasLevelControl('dimmable')).toBe(true);
    expect(kindHasColorControl('dimmable')).toBe(false);
    expect(kindHasColorControl('colorTemperature')).toBe(true);
    expect(kindHasHueSaturation('colorTemperature')).toBe(false);
    expect(kindHasHueSaturation('extendedColor')).toBe(true);
    expect(kindHasColorTemperature('extendedColor')).toBe(true);
    expect(kindHasColorTemperature('dimmable')).toBe(false);
  });

  it('exposes scenes as a plain on/off endpoint', () => {
    expect(SCENE_PROFILE.kind).toBe('onOff');
    expect(kindHasLevelControl(SCENE_PROFILE.kind)).toBe(false);
  });
});

describe('endpointIdFor', () => {
  it('namespaces ids per entity kind and is deterministic', () => {
    const id = '5f1d0f66-2e51-4b8a-9a52-9b0e6b0d0d11';
    expect(endpointIdFor('light', id)).toBe(`light-${id}`);
    expect(endpointIdFor('group', id)).toBe(`group-${id}`);
    expect(endpointIdFor('scene', id)).toBe(`scene-${id}`);
    expect(endpointIdFor('light', id)).toBe(endpointIdFor('light', id));
  });
});

describe('uniqueIdFor', () => {
  const uuid = '5f1d0f66-2e51-4b8a-9a52-9b0e6b0d0d11';

  it('turns a uuid into exactly 32 stable characters', () => {
    const unique = uniqueIdFor(uuid);
    expect(unique).toBe('5f1d0f662e514b8a9a529b0e6b0d0d11');
    expect(unique).toHaveLength(32);
    expect(uniqueIdFor(uuid)).toBe(unique);
  });

  it('gives different entities different ids', () => {
    expect(uniqueIdFor(uuid)).not.toBe(uniqueIdFor('5f1d0f66-2e51-4b8a-9a52-9b0e6b0d0d12'));
  });

  it('hashes over-long ids down to a stable digest within the 32 character limit', () => {
    const long = `${uuid}-${uuid}`;
    expect(uniqueIdFor(long)).toBe(uniqueIdFor(long));
    expect(uniqueIdFor(long).length).toBeLessThanOrEqual(32);
    expect(uniqueIdFor(long)).not.toBe(uniqueIdFor(`${long}x`));
  });

  it('never returns an empty id', () => {
    expect(uniqueIdFor('---').length).toBeGreaterThan(0);
  });
});

describe('powerCommand', () => {
  const absolute = deviceProfileForRemoteType('rgb_cct');
  const toggleOnly = deviceProfileForRemoteType('fut020');

  it('sends an absolute power command when the protocol has one', () => {
    expect(powerCommand(absolute, 'on', 'off')).toStrictEqual({ power: 'on' });
    expect(powerCommand(absolute, 'off', 'on')).toStrictEqual({ power: 'off' });
    // Repeating a command is harmless and keeps Alexa's view authoritative.
    expect(powerCommand(absolute, 'on', 'on')).toStrictEqual({ power: 'on' });
  });

  it('only toggles a toggle-only protocol when the state actually differs', () => {
    expect(powerCommand(toggleOnly, 'on', 'off')).toStrictEqual({ power: 'toggle' });
    expect(powerCommand(toggleOnly, 'on', 'on')).toBeNull();
    expect(powerCommand(toggleOnly, 'off', 'off')).toBeNull();
    expect(powerCommand(toggleOnly, 'off', 'on')).toStrictEqual({ power: 'toggle' });
  });

  it('gives up when the protocol has neither power nor toggle', () => {
    const profile: MatterDeviceProfile = { ...absolute, supportsPower: false, supportsToggle: false };
    expect(powerCommand(profile, 'on', 'off')).toBeNull();
  });
});

describe('brightnessCommand', () => {
  const absolute = deviceProfileForRemoteType('rgb_cct');
  const relative = deviceProfileForRemoteType('rgb');
  const none = deviceProfileForRemoteType('fut020');

  it('sets an absolute brightness', () => {
    expect(brightnessCommand(absolute, 40, 10)).toStrictEqual({ brightness: 40 });
  });

  it('clamps out-of-range targets', () => {
    expect(brightnessCommand(absolute, -20, 10)).toStrictEqual({ brightness: 0 });
    expect(brightnessCommand(absolute, 140, 10)).toStrictEqual({ brightness: 100 });
  });

  it('turns an absolute target into a step for step-only protocols', () => {
    expect(brightnessCommand(relative, 70, 40)).toStrictEqual({ brightnessStep: 30 });
    expect(brightnessCommand(relative, 20, 60)).toStrictEqual({ brightnessStep: -40 });
    expect(brightnessCommand(relative, 50, 50)).toBeNull();
  });

  it('does nothing for protocols without brightness', () => {
    expect(brightnessCommand(none, 50, 10)).toBeNull();
  });
});

describe('colorCommand', () => {
  const colour = deviceProfileForRemoteType('rgb_cct');
  const white = deviceProfileForRemoteType('cct');

  it('passes hue and saturation through', () => {
    expect(colorCommand(colour, 120, 80)).toStrictEqual({ hue: 120, saturation: 80 });
  });

  it('supports setting only one of the two', () => {
    expect(colorCommand(colour, 120, null)).toStrictEqual({ hue: 120 });
    expect(colorCommand(colour, null, 80)).toStrictEqual({ saturation: 80 });
    expect(colorCommand(colour, null, null)).toBeNull();
  });

  it('refuses colour on a white-only bulb', () => {
    expect(colorCommand(white, 120, 80)).toBeNull();
  });
});

describe('colorTemperatureCommand', () => {
  it('sets kelvin on tunable white bulbs', () => {
    expect(colorTemperatureCommand(deviceProfileForRemoteType('cct'), 4000)).toStrictEqual({
      colorTemperature: 4000,
    });
  });

  it('degrades to plain white on bulbs with a fixed white channel', () => {
    expect(colorTemperatureCommand(deviceProfileForRemoteType('rgbw'), 4000)).toStrictEqual({
      whiteMode: true,
    });
  });

  it('gives up on bulbs with no white at all', () => {
    expect(colorTemperatureCommand(deviceProfileForRemoteType('rgb'), 4000)).toBeNull();
  });
});

describe('withTransition', () => {
  it('attaches a fade duration only when there is one', () => {
    expect(withTransition({ power: 'on' }, 2_000)).toStrictEqual({ power: 'on', transitionMs: 2_000 });
    expect(withTransition({ power: 'on' }, undefined)).toStrictEqual({ power: 'on' });
    expect(withTransition({ power: 'on' }, 0)).toStrictEqual({ power: 'on' });
  });
});
