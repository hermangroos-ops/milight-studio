import { describe, expect, it } from 'vitest';

import {
  LIGHT_CAPABILITIES,
  REMOTE_TYPES,
  REMOTE_TYPE_PROFILES,
  REMOTE_TYPE_PROFILE_LIST,
  getRemoteTypeProfile,
  groupIdsFor,
  isBroadcastGroup,
  isRemoteType,
  isValidGroupId,
  supportsCapability,
  type LightCapability,
  type RemoteType,
} from './remote-types.js';

describe('isRemoteType', () => {
  it.each(REMOTE_TYPES)('accepts the known remote type %s', (type) => {
    expect(isRemoteType(type)).toBe(true);
  });

  it.each(['RGB_CCT', 'rgbcct', 'fut0201', '', ' rgbw', null, undefined, 42, {}, [], ['rgbw']])(
    'rejects %p',
    (value) => {
      expect(isRemoteType(value)).toBe(false);
    },
  );

  it('rejects a symbol without stringifying it', () => {
    expect(isRemoteType(Symbol('rgbw'))).toBe(false);
  });
});

describe('remote type profiles', () => {
  it('exposes one profile per remote type in declaration order', () => {
    expect(REMOTE_TYPE_PROFILE_LIST.map((profile) => profile.id)).toEqual([...REMOTE_TYPES]);
  });

  it.each(REMOTE_TYPES)('%s has a frozen, self-consistent profile', (type) => {
    const profile = getRemoteTypeProfile(type);
    expect(profile).toBe(REMOTE_TYPE_PROFILES[type]);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile.id).toBe(type);
    expect(profile.label.length).toBeGreaterThan(0);
    expect(profile.hint.length).toBeGreaterThan(0);
    expect(profile.maxGroupId).toBeGreaterThanOrEqual(0);
    for (const capability of profile.capabilities) {
      expect(LIGHT_CAPABILITIES).toContain(capability);
    }
  });

  it('only advertises effects when there are effects to select', () => {
    for (const type of REMOTE_TYPES) {
      const profile = getRemoteTypeProfile(type);
      expect(profile.capabilities.includes('effects')).toBe(profile.effectCount > 0);
    }
  });

  it('gives a single-zone protocol no broadcast group', () => {
    for (const type of REMOTE_TYPES) {
      const profile = getRemoteTypeProfile(type);
      if (profile.maxGroupId === 0) expect(profile.supportsBroadcast).toBe(false);
    }
  });
});

describe('groupIdsFor', () => {
  it.each([
    { type: 'rgb_cct' as const, expected: [0, 1, 2, 3, 4] },
    { type: 'rgbw' as const, expected: [0, 1, 2, 3, 4] },
    { type: 'cct' as const, expected: [0, 1, 2, 3, 4] },
    { type: 'fut091' as const, expected: [0, 1, 2, 3, 4] },
    { type: 'fut089' as const, expected: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
    { type: 'rgb' as const, expected: [0] },
    { type: 'fut020' as const, expected: [0] },
  ])('lists every addressable group for $type', ({ type, expected }) => {
    expect(groupIdsFor(type)).toEqual(expected);
  });
});

describe('isValidGroupId', () => {
  it.each(REMOTE_TYPES)('accepts exactly the listed groups for %s', (type) => {
    const valid = groupIdsFor(type);
    for (const groupId of valid) expect(isValidGroupId(type, groupId)).toBe(true);
    expect(isValidGroupId(type, valid.length)).toBe(false);
  });

  it.each(REMOTE_TYPES)('rejects negative and non-integer group ids for %s', (type) => {
    for (const groupId of [-1, -0.5, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(isValidGroupId(type, groupId)).toBe(false);
    }
  });
});

describe('isBroadcastGroup', () => {
  it.each([
    { type: 'rgb_cct' as const, groupId: 0, expected: true },
    { type: 'rgb_cct' as const, groupId: 1, expected: false },
    { type: 'fut089' as const, groupId: 0, expected: true },
    { type: 'fut089' as const, groupId: 8, expected: false },
    { type: 'rgb' as const, groupId: 0, expected: false },
    { type: 'fut020' as const, groupId: 0, expected: false },
  ])('$type group $groupId → $expected', ({ type, groupId, expected }) => {
    expect(isBroadcastGroup(type, groupId)).toBe(expected);
  });
});

describe('supportsCapability', () => {
  const expected: Record<RemoteType, LightCapability[]> = {
    rgb_cct: ['power', 'brightness', 'color', 'colorTemperature', 'whiteMode', 'nightMode', 'effects'],
    fut089: ['power', 'brightness', 'color', 'colorTemperature', 'whiteMode', 'nightMode', 'effects'],
    rgbw: ['power', 'brightness', 'color', 'whiteMode', 'nightMode', 'effects'],
    cct: ['power', 'brightness', 'colorTemperature', 'nightMode'],
    fut091: ['power', 'brightness', 'colorTemperature', 'nightMode'],
    rgb: ['power', 'brightness', 'color', 'effects'],
    fut020: ['toggle', 'color', 'effects'],
  };

  it.each(REMOTE_TYPES)('answers for every capability of %s', (type) => {
    for (const capability of LIGHT_CAPABILITIES) {
      expect(supportsCapability(type, capability)).toBe(expected[type].includes(capability));
    }
  });

  it('is the only protocol that has to be toggled rather than switched', () => {
    const toggleOnly = REMOTE_TYPES.filter((type) => supportsCapability(type, 'toggle'));
    expect(toggleOnly).toEqual(['fut020']);
  });
});
