import { describe, expect, it } from 'vitest';

import { apiErrorSchema, bridgeStatusSchema, healthSchema } from './api.js';
import { createDefaultLightState } from './light-state.js';
import { serverEventSchema, type ServerEvent } from './events.js';

const NOW = '2024-01-01T00:00:00.000Z';
const UUID = '11111111-2222-4333-8444-555555555555';

const light = {
  id: UUID,
  name: 'Bureau',
  room: null,
  deviceId: '0x0001',
  remoteType: 'rgb_cct' as const,
  groupId: 1,
  exposeToVoice: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const group = {
  id: UUID,
  name: 'Woonkamer',
  room: null,
  lightIds: [UUID],
  exposeToVoice: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const scene = {
  id: UUID,
  name: 'Filmavond',
  room: null,
  steps: [{ targetType: 'light' as const, targetId: UUID, command: { power: 'on' as const } }],
  exposeToVoice: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const examples: ServerEvent[] = [
  { type: 'hello', serverTime: NOW, version: '1.2.3' },
  { type: 'light.created', light },
  { type: 'light.updated', light },
  { type: 'light.deleted', lightId: UUID },
  { type: 'light.state', lightId: UUID, state: createDefaultLightState(new Date(NOW)) },
  { type: 'group.created', group },
  { type: 'group.updated', group },
  { type: 'group.deleted', groupId: UUID },
  { type: 'scene.created', scene },
  { type: 'scene.updated', scene },
  { type: 'scene.deleted', sceneId: UUID },
  { type: 'scene.activated', sceneId: UUID },
  { type: 'hub.status', reachable: true, version: '1.11.0', checkedAt: NOW },
];

describe('serverEventSchema', () => {
  it.each(examples.map((event) => [event.type, event] as const))('accepts a %s event', (_type, event) => {
    expect(serverEventSchema.parse(event)).toEqual(event);
  });

  it('covers every variant of the union exactly once', () => {
    const types = examples.map((event) => event.type);
    expect(new Set(types).size).toBe(types.length);

    const declared = serverEventSchema.options.map((option) => option.shape.type.value);
    expect([...types].sort()).toEqual([...declared].sort());
  });

  it('accepts a null hub version', () => {
    expect(
      serverEventSchema.safeParse({ type: 'hub.status', reachable: false, version: null, checkedAt: NOW })
        .success,
    ).toBe(true);
  });

  it.each([
    { event: { type: 'unknown.event' }, why: 'an unknown discriminator' },
    { event: {}, why: 'a missing discriminator' },
    { event: { type: 'hello', serverTime: NOW }, why: 'a missing field' },
    { event: { type: 'hello', serverTime: NOW, version: '1', extra: 1 }, why: 'an unknown key' },
    { event: { type: 'light.created', light: { ...light, id: 'nope' } }, why: 'an invalid nested light' },
    { event: { type: 'light.deleted', lightId: 42 }, why: 'a non-string id' },
  ])('rejects an event with $why', ({ event }) => {
    expect(serverEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('api schemas', () => {
  it('accepts the error envelope with and without details', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'not_found', message: 'gone' } }).success).toBe(true);
    expect(
      apiErrorSchema.safeParse({
        error: { code: 'validation_failed', message: 'bad', details: [{ path: 'name', message: 'x' }] },
      }).success,
    ).toBe(true);
  });

  it.each([
    { body: { error: { code: 'x' } }, why: 'a missing message' },
    { body: { code: 'x', message: 'y' }, why: 'a missing envelope' },
    { body: { error: { code: 'x', message: 'y', hint: 'z' } }, why: 'an unknown key' },
    { body: { error: { code: 'x', message: 'y', details: [{ path: 'a' }] } }, why: 'an incomplete detail' },
  ])('rejects an envelope with $why', ({ body }) => {
    expect(apiErrorSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a health document in both states', () => {
    const hub = { reachable: true, url: 'http://hub', version: '1.11.0', checkedAt: NOW };
    expect(healthSchema.parse({ status: 'ok', version: '1', uptimeSeconds: 5, hub })).toBeTruthy();
    expect(
      healthSchema.parse({
        status: 'degraded',
        version: '1',
        uptimeSeconds: 0,
        hub: { ...hub, reachable: false, version: null, checkedAt: null },
      }),
    ).toBeTruthy();
    expect(healthSchema.safeParse({ status: 'broken', version: '1', uptimeSeconds: 0, hub }).success).toBe(
      false,
    );
  });

  it('accepts a bridge status with and without detail', () => {
    expect(
      bridgeStatusSchema.parse({ name: 'hue', enabled: true, running: false, detail: null }),
    ).toBeTruthy();
    expect(bridgeStatusSchema.safeParse({ name: 'hue', enabled: true, running: false }).success).toBe(false);
  });
});
