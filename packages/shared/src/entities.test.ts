import { describe, expect, it } from 'vitest';

import {
  createGroupSchema,
  createLightSchema,
  createSceneSchema,
  deviceIdSchema,
  formatDeviceId,
  groupSchema,
  lightSchema,
  lightWithStateSchema,
  normaliseDeviceId,
  parseDeviceId,
  sceneSchema,
  sceneStepSchema,
  updateGroupSchema,
  updateLightSchema,
  updateSceneSchema,
} from './entities.js';
import { createDefaultLightState } from './light-state.js';

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '11111111-2222-4333-8444-555555555556';

describe('normaliseDeviceId', () => {
  it.each([
    { input: '0x1', expected: '0x0001' },
    { input: '0X0001', expected: '0x0001' },
    { input: '0x0001', expected: '0x0001' },
    { input: '0xABCD', expected: '0xabcd' },
    { input: '0XaBcD', expected: '0xabcd' },
    { input: '0xF', expected: '0x000f' },
    { input: '0x00', expected: '0x0000' },
    { input: '0xffff', expected: '0xffff' },
  ])('normalises $input to $expected', ({ input, expected }) => {
    expect(normaliseDeviceId(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const input of ['0x1', '0X0001', '0xAbC']) {
      expect(normaliseDeviceId(normaliseDeviceId(input))).toBe(normaliseDeviceId(input));
    }
  });

  // Garbage in, garbage out: only the leading prefix is stripped and the rest is padded
  // verbatim. Callers are expected to have run the value past deviceIdSchema first.
  it('only strips a single leading 0x prefix', () => {
    expect(normaliseDeviceId('0x0x1')).toBe('0x00x1');
  });
});

describe('parseDeviceId / formatDeviceId', () => {
  it.each([
    { deviceId: '0x0000', value: 0 },
    { deviceId: '0x0001', value: 1 },
    { deviceId: '0x1', value: 1 },
    { deviceId: '0x1f', value: 31 },
    { deviceId: '0X1F', value: 31 },
    { deviceId: '0xffff', value: 65_535 },
  ])('parses $deviceId as $value', ({ deviceId, value }) => {
    expect(parseDeviceId(deviceId)).toBe(value);
  });

  it.each([
    { value: 0, expected: '0x0000' },
    { value: 1, expected: '0x0001' },
    { value: 255, expected: '0x00ff' },
    { value: 65_535, expected: '0xffff' },
  ])('formats $value as $expected', ({ value, expected }) => {
    expect(formatDeviceId(value)).toBe(expected);
  });

  it('masks anything above 0xffff down to 16 bits', () => {
    expect(formatDeviceId(0x1_0000)).toBe('0x0000');
    expect(formatDeviceId(0x1_2345)).toBe('0x2345');
    expect(formatDeviceId(-1)).toBe('0xffff');
  });

  it('round trips through both directions', () => {
    for (const value of [0, 1, 42, 4095, 65_535]) {
      expect(parseDeviceId(formatDeviceId(value))).toBe(value);
    }
    for (const deviceId of ['0x0000', '0x0001', '0x1f2a', '0xffff']) {
      expect(formatDeviceId(parseDeviceId(deviceId))).toBe(deviceId);
    }
    expect(normaliseDeviceId('0x1')).toBe(formatDeviceId(parseDeviceId('0x1')));
  });
});

describe('deviceIdSchema', () => {
  it.each(['0x0', '0x1', '0xff', '0xFFFF', '0x1f2a'])('accepts %s', (value) => {
    expect(deviceIdSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', '1', '0x', '0x12345', 'xff', '0xgg', ' 0x1', '0x1 '])('rejects %p', (value) => {
    expect(deviceIdSchema.safeParse(value).success).toBe(false);
  });

  // The sniffer view of the hub prints ids with an uppercase prefix, so the schema
  // accepts either casing and `normaliseDeviceId` canonicalises it.
  it('accepts an uppercase 0X prefix and normalises it', () => {
    expect(deviceIdSchema.safeParse('0X1f2a').success).toBe(true);
    expect(normaliseDeviceId('0X1f2a')).toBe('0x1f2a');
  });
});

describe('createLightSchema', () => {
  const base = { name: 'Bureau', deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 };

  it('defaults exposeToVoice to true and room to undefined', () => {
    const parsed = createLightSchema.parse(base);
    expect(parsed.exposeToVoice).toBe(true);
    expect(parsed.room).toBeUndefined();
  });

  it('keeps an explicit exposeToVoice of false', () => {
    expect(createLightSchema.parse({ ...base, exposeToVoice: false }).exposeToVoice).toBe(false);
  });

  it('accepts a null room and trims names', () => {
    expect(createLightSchema.parse({ ...base, room: null }).room).toBeNull();
    expect(createLightSchema.parse({ ...base, name: '  Bureau  ' }).name).toBe('Bureau');
  });

  it.each([
    { patch: { name: '' }, why: 'empty name' },
    { patch: { name: '   ' }, why: 'whitespace-only name' },
    { patch: { name: 'x'.repeat(65) }, why: 'name over 64 characters' },
    { patch: { deviceId: 'nope' }, why: 'malformed device id' },
    { patch: { remoteType: 'rgbcct' }, why: 'unknown remote type' },
    { patch: { groupId: 9 }, why: 'group id above the maximum' },
    { patch: { groupId: -1 }, why: 'negative group id' },
    { patch: { groupId: 1.5 }, why: 'fractional group id' },
    { patch: { colour: 'red' }, why: 'unknown key' },
  ])('rejects a $why', ({ patch }) => {
    expect(createLightSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('requires every mandatory field', () => {
    expect(createLightSchema.safeParse({}).success).toBe(false);
  });
});

describe('updateLightSchema', () => {
  it('accepts an empty patch and any single field', () => {
    expect(updateLightSchema.safeParse({}).success).toBe(true);
    expect(updateLightSchema.parse({ name: 'Nieuw' }).name).toBe('Nieuw');
  });

  it('rejects unknown keys and invalid values', () => {
    expect(updateLightSchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(updateLightSchema.safeParse({ groupId: 12 }).success).toBe(false);
  });

  // A PATCH must only ever carry the fields the caller actually sent: the update schema
  // is built without defaults, so an untouched field stays `undefined` and the service
  // leaves the stored value alone.
  it('never materialises defaults for fields the patch does not mention', () => {
    expect(updateLightSchema.parse({}).exposeToVoice).toBeUndefined();
    expect(updateLightSchema.parse({ name: 'Nieuw' }).exposeToVoice).toBeUndefined();
    expect(updateLightSchema.parse({ name: 'Nieuw' }).room).toBeUndefined();
  });
});

describe('lightSchema / lightWithStateSchema', () => {
  const light = {
    id: UUID,
    name: 'Bureau',
    room: null,
    deviceId: '0x0001',
    remoteType: 'rgb_cct',
    groupId: 1,
    exposeToVoice: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  it('accepts a fully formed light', () => {
    expect(lightSchema.parse(light)).toEqual(light);
  });

  it('rejects a non-uuid id and unknown keys', () => {
    expect(lightSchema.safeParse({ ...light, id: 'not-a-uuid' }).success).toBe(false);
    expect(lightSchema.safeParse({ ...light, extra: true }).success).toBe(false);
  });

  it('requires the nested state on lightWithStateSchema', () => {
    expect(lightWithStateSchema.safeParse(light).success).toBe(false);
    const withState = { ...light, state: createDefaultLightState(new Date('2024-01-01T00:00:00.000Z')) };
    expect(lightWithStateSchema.parse(withState)).toEqual(withState);
  });
});

describe('createGroupSchema / groupSchema', () => {
  it('defaults lightIds to an empty list and exposeToVoice to true', () => {
    const parsed = createGroupSchema.parse({ name: 'Woonkamer' });
    expect(parsed.lightIds).toEqual([]);
    expect(parsed.exposeToVoice).toBe(true);
  });

  it('rejects non-uuid members and unknown keys', () => {
    expect(createGroupSchema.safeParse({ name: 'A', lightIds: ['nope'] }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: 'A', members: [] }).success).toBe(false);
  });

  it('accepts a fully formed group', () => {
    const group = {
      id: UUID,
      name: 'Woonkamer',
      room: 'Woonkamer',
      lightIds: [OTHER_UUID],
      exposeToVoice: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(groupSchema.parse(group)).toEqual(group);
  });
});

describe('updateGroupSchema / updateSceneSchema defaults', () => {
  // Renaming a group must not touch its membership. If `lightIds` defaulted to `[]` here,
  // `GroupService.update` would happily write that empty array over the real members.
  it('leaves lightIds undefined on a group patch that never mentions members', () => {
    const parsed = updateGroupSchema.parse({ name: 'Nieuw' });
    expect(parsed.lightIds).toBeUndefined();
    expect(parsed.exposeToVoice).toBeUndefined();
  });

  it('leaves untouched scene fields undefined', () => {
    expect(updateSceneSchema.parse({ name: 'Nieuw' }).exposeToVoice).toBeUndefined();
    expect(updateSceneSchema.parse({ name: 'Nieuw' }).steps).toBeUndefined();
  });
});

describe('sceneStepSchema', () => {
  it.each(['light', 'group'])('accepts a %s step', (targetType) => {
    const step = { targetType, targetId: UUID, command: { power: 'on' } };
    expect(sceneStepSchema.parse(step)).toEqual(step);
  });

  it.each([
    { step: { targetType: 'scene', targetId: UUID, command: { power: 'on' } }, why: 'unknown target type' },
    { step: { targetType: 'light', targetId: 'nope', command: { power: 'on' } }, why: 'non-uuid target' },
    { step: { targetType: 'light', targetId: UUID, command: {} }, why: 'empty command' },
    { step: { targetType: 'light', targetId: UUID }, why: 'missing command' },
    {
      step: { targetType: 'light', targetId: UUID, command: { power: 'on' }, delayMs: 10 },
      why: 'unknown key',
    },
  ])('rejects a step with a $why', ({ step }) => {
    expect(sceneStepSchema.safeParse(step).success).toBe(false);
  });
});

describe('createSceneSchema / sceneSchema', () => {
  const step = { targetType: 'light' as const, targetId: UUID, command: { power: 'on' as const } };

  it('requires at least one step and defaults exposeToVoice', () => {
    expect(createSceneSchema.safeParse({ name: 'Filmavond', steps: [] }).success).toBe(false);
    expect(createSceneSchema.parse({ name: 'Filmavond', steps: [step] }).exposeToVoice).toBe(true);
  });

  it('accepts a fully formed scene, including one with no steps at all', () => {
    const scene = {
      id: UUID,
      name: 'Filmavond',
      room: null,
      steps: [step],
      exposeToVoice: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(sceneSchema.parse(scene)).toEqual(scene);
    expect(sceneSchema.safeParse({ ...scene, steps: [] }).success).toBe(true);
  });

  it('rejects unknown keys and a bad nested command', () => {
    expect(createSceneSchema.safeParse({ name: 'A', steps: [step], icon: 'x' }).success).toBe(false);
    expect(
      createSceneSchema.safeParse({
        name: 'A',
        steps: [{ ...step, command: { brightness: 500 } }],
      }).success,
    ).toBe(false);
  });
});
