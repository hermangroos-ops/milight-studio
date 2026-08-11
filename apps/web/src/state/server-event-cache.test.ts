import type { Light, ServerEvent } from '@milight-studio/shared';
import { describe, expect, it } from 'vitest';

import { makeGroup, makeLight, makeScene, makeState } from '../test-utils/index.js';

import { applyServerEvent, emptySnapshot, parseServerEvent } from './server-event-cache.js';

function withoutState(light: ReturnType<typeof makeLight>): Light {
  const { state: _state, ...rest } = light;
  return rest;
}

describe('applyServerEvent', () => {
  it('leaves the snapshot untouched for hello', () => {
    const snapshot = emptySnapshot();
    expect(applyServerEvent(snapshot, { type: 'hello', serverTime: 'now', version: '1.0.0' })).toBe(snapshot);
  });

  it('adds a created light with a default state', () => {
    const light = makeLight();
    const next = applyServerEvent(emptySnapshot(), { type: 'light.created', light: withoutState(light) });

    expect(next.lights).toHaveLength(1);
    expect(next.lights[0]?.id).toBe(light.id);
    expect(next.lights[0]?.state.power).toBe('off');
  });

  it('keeps the known state when a created light is already cached', () => {
    const light = makeLight({ state: makeState({ power: 'on', brightness: 33 }) });
    const snapshot = { ...emptySnapshot(), lights: [light] };

    const next = applyServerEvent(snapshot, { type: 'light.created', light: withoutState(light) });

    expect(next.lights).toHaveLength(1);
    expect(next.lights[0]?.state.brightness).toBe(33);
  });

  it('merges a light update onto the cached state', () => {
    const light = makeLight({ name: 'Oud', state: makeState({ brightness: 12 }) });
    const snapshot = { ...emptySnapshot(), lights: [light] };

    const next = applyServerEvent(snapshot, {
      type: 'light.updated',
      light: { ...withoutState(light), name: 'Nieuw' },
    });

    expect(next.lights[0]?.name).toBe('Nieuw');
    expect(next.lights[0]?.state.brightness).toBe(12);
  });

  it('ignores updates for lights it has never seen', () => {
    const snapshot = emptySnapshot();
    const event: ServerEvent = { type: 'light.updated', light: withoutState(makeLight()) };

    expect(applyServerEvent(snapshot, event)).toBe(snapshot);
  });

  it('removes a deleted light', () => {
    const light = makeLight();
    const snapshot = { ...emptySnapshot(), lights: [light] };

    expect(applyServerEvent(snapshot, { type: 'light.deleted', lightId: light.id }).lights).toEqual([]);
  });

  it('replaces the state of a light', () => {
    const light = makeLight();
    const other = makeLight();
    const snapshot = { ...emptySnapshot(), lights: [light, other] };
    const state = makeState({ power: 'on', brightness: 77 });

    const next = applyServerEvent(snapshot, { type: 'light.state', lightId: light.id, state });

    expect(next.lights[0]?.state).toEqual(state);
    expect(next.lights[1]).toBe(other);
  });

  it('ignores state for an unknown light', () => {
    const snapshot = { ...emptySnapshot(), lights: [makeLight()] };
    const event: ServerEvent = { type: 'light.state', lightId: 'nope', state: makeState() };

    expect(applyServerEvent(snapshot, event)).toBe(snapshot);
  });

  it('inserts and updates groups', () => {
    const group = makeGroup({ name: 'Woonkamer' });
    const created = applyServerEvent(emptySnapshot(), { type: 'group.created', group });
    const updated = applyServerEvent(created, {
      type: 'group.updated',
      group: { ...group, name: 'Zolder' },
    });

    expect(created.groups).toHaveLength(1);
    expect(updated.groups).toHaveLength(1);
    expect(updated.groups[0]?.name).toBe('Zolder');
  });

  it('removes a deleted group', () => {
    const group = makeGroup();
    const snapshot = { ...emptySnapshot(), groups: [group] };

    expect(applyServerEvent(snapshot, { type: 'group.deleted', groupId: group.id }).groups).toEqual([]);
  });

  it('inserts, updates and removes scenes', () => {
    const scene = makeScene({ name: 'Filmavond' });
    const created = applyServerEvent(emptySnapshot(), { type: 'scene.created', scene });
    const updated = applyServerEvent(created, {
      type: 'scene.updated',
      scene: { ...scene, name: 'Ochtend' },
    });
    const deleted = applyServerEvent(updated, { type: 'scene.deleted', sceneId: scene.id });

    expect(created.scenes).toHaveLength(1);
    expect(updated.scenes[0]?.name).toBe('Ochtend');
    expect(deleted.scenes).toEqual([]);
  });

  it('records the most recently activated scene', () => {
    const next = applyServerEvent(emptySnapshot(), { type: 'scene.activated', sceneId: 'scene-9' });
    expect(next.lastSceneActivatedId).toBe('scene-9');
  });

  it('stores hub status', () => {
    const next = applyServerEvent(emptySnapshot(), {
      type: 'hub.status',
      reachable: false,
      version: '1.11.0',
      checkedAt: '2024-01-01T10:00:00.000Z',
    });

    expect(next.hub).toEqual({
      reachable: false,
      version: '1.11.0',
      checkedAt: '2024-01-01T10:00:00.000Z',
    });
  });
});

describe('parseServerEvent', () => {
  it('parses a well-formed message', () => {
    expect(parseServerEvent('{"type":"scene.activated","sceneId":"a"}')).toEqual({
      type: 'scene.activated',
      sceneId: 'a',
    });
  });

  it('rejects anything it cannot use', () => {
    expect(parseServerEvent(42)).toBeNull();
    expect(parseServerEvent('not json')).toBeNull();
    expect(parseServerEvent('null')).toBeNull();
    expect(parseServerEvent('{"nope":1}')).toBeNull();
  });
});
