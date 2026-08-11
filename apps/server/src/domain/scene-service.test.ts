import { MilightHubUnreachableError } from '@milight-studio/milight-client';
import type { HubAddress } from '@milight-studio/milight-client';
import type { SceneStep } from '@milight-studio/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDomain, type DomainHarness } from '../../tests/helpers/domain.js';
import { MISSING_ID, idAt } from '../../tests/helpers/support.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';

let harness: DomainHarness;

beforeEach(async () => {
  harness = await createDomain();
});

function lightStep(targetId: string, command: SceneStep['command'] = { power: 'on' }): SceneStep {
  return { targetType: 'light', targetId, command };
}

describe('SceneService.create', () => {
  it('creates a scene with the injected id and clock', () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({
      name: '  Filmavond ',
      room: '  Woonkamer ',
      steps: [lightStep(light.id, { brightness: 20 })],
      exposeToVoice: false,
    });

    expect(scene).toEqual({
      id: idAt(2),
      name: 'Filmavond',
      room: 'Woonkamer',
      steps: [lightStep(light.id, { brightness: 20 })],
      exposeToVoice: false,
      createdAt: harness.clock.iso(),
      updatedAt: harness.clock.iso(),
    });
  });

  it('stores a missing room as null and emits scene.created', () => {
    const light = harness.addLight();
    harness.emitted.length = 0;
    const scene = harness.scenes.create({
      name: 'Ochtend',
      steps: [lightStep(light.id)],
      exposeToVoice: true,
    });

    expect(scene.room).toBeNull();
    expect(harness.emitted).toEqual([{ type: 'scene.created', scene }]);
  });

  it('accepts group targets', () => {
    const light = harness.addLight();
    const group = harness.groups.create({ name: 'A', lightIds: [light.id], exposeToVoice: true });
    const scene = harness.scenes.create({
      name: 'S',
      steps: [{ targetType: 'group', targetId: group.id, command: { power: 'off' } }],
      exposeToVoice: true,
    });

    expect(scene.steps[0]?.targetType).toBe('group');
  });

  it('rejects a duplicate name regardless of case', () => {
    const light = harness.addLight();
    harness.scenes.create({ name: 'Filmavond', steps: [lightStep(light.id)], exposeToVoice: true });

    expect(() =>
      harness.scenes.create({ name: '  filmavond ', steps: [lightStep(light.id)], exposeToVoice: true }),
    ).toThrow(ConflictError);
  });

  it.each([
    { steps: [{ targetType: 'light' as const, targetId: MISSING_ID, command: { power: 'on' as const } }] },
    { steps: [{ targetType: 'group' as const, targetId: MISSING_ID, command: { power: 'on' as const } }] },
  ])('rejects unknown targets', ({ steps }) => {
    try {
      harness.scenes.create({ name: 'S', steps, exposeToVoice: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).status).toBe(400);
      expect((error as ValidationError).details?.[0]?.path).toBe('steps');
      expect((error as ValidationError).details?.[0]?.message).toContain(MISSING_ID);
    }
  });

  it('names every unknown target at once', () => {
    const light = harness.addLight();
    try {
      harness.scenes.create({
        name: 'S',
        exposeToVoice: true,
        steps: [
          lightStep(light.id),
          lightStep(MISSING_ID),
          { targetType: 'group', targetId: idAt(99), command: { power: 'on' } },
        ],
      });
      expect.unreachable();
    } catch (error) {
      const message = (error as ValidationError).details?.[0]?.message ?? '';
      expect(message).toContain(`light:${MISSING_ID}`);
      expect(message).toContain(`group:${idAt(99)}`);
    }
  });
});

describe('SceneService.list / get', () => {
  it('lists nothing to begin with and returns a copy', () => {
    expect(harness.scenes.list()).toEqual([]);

    const light = harness.addLight();
    harness.scenes.create({ name: 'S', steps: [lightStep(light.id)], exposeToVoice: true });
    const listed = harness.scenes.list();
    listed.pop();
    expect(harness.scenes.list()).toHaveLength(1);
  });

  it('throws a 404 for an unknown scene', () => {
    expect(() => harness.scenes.get(MISSING_ID)).toThrow(NotFoundError);
  });
});

describe('SceneService.update', () => {
  it('changes only what was supplied and stamps the clock', () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({
      name: 'Oud',
      room: 'Woonkamer',
      steps: [lightStep(light.id)],
      exposeToVoice: true,
    });
    harness.clock.advance(1000);

    const updated = harness.scenes.update(scene.id, { name: ' Nieuw ' });

    expect(updated).toMatchObject({
      name: 'Nieuw',
      room: 'Woonkamer',
      steps: scene.steps,
      createdAt: scene.createdAt,
      updatedAt: harness.clock.iso(),
    });
  });

  it('replaces the steps and validates the new targets', () => {
    const a = harness.addLight();
    const b = harness.addLight();
    const scene = harness.scenes.create({ name: 'S', steps: [lightStep(a.id)], exposeToVoice: true });

    expect(harness.scenes.update(scene.id, { steps: [lightStep(b.id)] }).steps).toEqual([lightStep(b.id)]);
    expect(() => harness.scenes.update(scene.id, { steps: [lightStep(MISSING_ID)] })).toThrow(
      ValidationError,
    );
  });

  it('clears the room and flips the voice flag', () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({
      name: 'S',
      room: 'X',
      steps: [lightStep(light.id)],
      exposeToVoice: true,
    });

    expect(harness.scenes.update(scene.id, { room: null }).room).toBeNull();
    expect(harness.scenes.update(scene.id, { exposeToVoice: false }).exposeToVoice).toBe(false);
  });

  it('emits scene.updated and persists', async () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({ name: 'S', steps: [lightStep(light.id)], exposeToVoice: true });
    harness.emitted.length = 0;

    const updated = harness.scenes.update(scene.id, { name: 'T' });
    expect(harness.emitted).toEqual([{ type: 'scene.updated', scene: updated }]);

    await harness.store.flush();
    expect((await harness.persistence.load())?.scenes[0]?.name).toBe('T');
  });

  it('rejects a name another scene already uses but allows keeping its own', () => {
    const light = harness.addLight();
    harness.scenes.create({ name: 'Bezet', steps: [lightStep(light.id)], exposeToVoice: true });
    const scene = harness.scenes.create({ name: 'Vrij', steps: [lightStep(light.id)], exposeToVoice: true });

    expect(() => harness.scenes.update(scene.id, { name: 'bezet' })).toThrow(ConflictError);
    expect(() => harness.scenes.update(scene.id, { name: 'Vrij' })).not.toThrow();
  });

  it('throws a 404 for an unknown scene', () => {
    expect(() => harness.scenes.update(MISSING_ID, { name: 'x' })).toThrow(NotFoundError);
  });
});

describe('SceneService.remove', () => {
  it('deletes the scene and emits scene.deleted', async () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({ name: 'S', steps: [lightStep(light.id)], exposeToVoice: true });
    harness.emitted.length = 0;

    harness.scenes.remove(scene.id);

    expect(harness.scenes.list()).toEqual([]);
    expect(harness.emitted).toEqual([{ type: 'scene.deleted', sceneId: scene.id }]);

    await harness.store.flush();
    expect((await harness.persistence.load())?.scenes).toEqual([]);
  });

  it('throws a 404 for an unknown scene', () => {
    expect(() => {
      harness.scenes.remove(MISSING_ID);
    }).toThrow(NotFoundError);
  });
});

describe('SceneService.activate', () => {
  it('applies every step in order and reports the count', async () => {
    const a = harness.addLight({ deviceId: '0x0001' });
    const b = harness.addLight({ deviceId: '0x0002' });
    const c = harness.addLight({ deviceId: '0x0003' });
    const group = harness.groups.create({ name: 'Groep', lightIds: [c.id], exposeToVoice: true });
    const scene = harness.scenes.create({
      name: 'Filmavond',
      exposeToVoice: true,
      steps: [
        lightStep(a.id, { power: 'on', brightness: 10 }),
        { targetType: 'group', targetId: group.id, command: { power: 'on', brightness: 40 } },
        lightStep(b.id, { power: 'off' }),
      ],
    });
    harness.emitted.length = 0;

    const result = await harness.scenes.activate(scene.id);

    expect(harness.hub.commands.map((call) => [call.address.deviceId, call.body])).toEqual([
      ['0x0001', { status: 'ON', level: 10 }],
      ['0x0003', { status: 'ON', level: 40 }],
      ['0x0002', { status: 'OFF' }],
    ]);
    expect(result.appliedSteps).toBe(3);
    expect(result.failed).toEqual([]);
    expect(result.scene.id).toBe(scene.id);
    expect(harness.emitted.at(-1)).toEqual({ type: 'scene.activated', sceneId: scene.id });
  });

  it('keeps going after a failing step and reports it', async () => {
    const good = harness.addLight({ deviceId: '0x0001' });
    const bad = harness.addLight({ deviceId: '0x0002' });
    const alsoGood = harness.addLight({ deviceId: '0x0003' });
    const scene = harness.scenes.create({
      name: 'S',
      exposeToVoice: true,
      steps: [lightStep(good.id), lightStep(bad.id), lightStep(alsoGood.id)],
    });

    harness.hub.failWith = new MilightHubUnreachableError('down');
    harness.hub.failWhen = (address?: HubAddress) => address?.deviceId === '0x0002';

    const result = await harness.scenes.activate(scene.id);

    expect(result.appliedSteps).toBe(2);
    expect(result.failed).toEqual([
      {
        targetType: 'light',
        targetId: bad.id,
        code: 'hub_unreachable',
        message: expect.any(String),
      },
    ]);
    expect(harness.lights.getState(alsoGood.id).power).toBe('on');
  });

  it('reports a failing group step by its group id', async () => {
    const light = harness.addLight();
    const group = harness.groups.create({ name: 'Leeg', lightIds: [], exposeToVoice: true });
    const scene = harness.scenes.create({
      name: 'S',
      exposeToVoice: true,
      steps: [{ targetType: 'group', targetId: group.id, command: { power: 'on' } }, lightStep(light.id)],
    });

    const result = await harness.scenes.activate(scene.id);

    expect(result.appliedSteps).toBe(1);
    expect(result.failed).toEqual([
      {
        targetType: 'group',
        targetId: group.id,
        code: 'validation_failed',
        message: expect.any(String),
      },
    ]);
  });

  it('classifies a non-AppError failure as internal_error', async () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({ name: 'S', steps: [lightStep(light.id)], exposeToVoice: true });
    harness.hub.failWith = new RangeError('boom');

    const result = await harness.scenes.activate(scene.id);
    expect(result.failed).toEqual([
      { targetType: 'light', targetId: light.id, code: 'internal_error', message: 'boom' },
    ]);
  });

  it('emits scene.activated even when every step failed', async () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({ name: 'S', steps: [lightStep(light.id)], exposeToVoice: true });
    harness.hub.failWith = new MilightHubUnreachableError('down');
    harness.emitted.length = 0;

    const result = await harness.scenes.activate(scene.id);

    expect(result.appliedSteps).toBe(0);
    expect(harness.emitted.at(-1)).toEqual({ type: 'scene.activated', sceneId: scene.id });
  });

  it('activates a scene with no steps at all', async () => {
    const light = harness.addLight();
    const scene = harness.scenes.create({ name: 'S', steps: [lightStep(light.id)], exposeToVoice: true });
    harness.store.mutate((data) => {
      data.scenes = data.scenes.map((entry) => ({ ...entry, steps: [] }));
    });

    const result = await harness.scenes.activate(scene.id);
    expect(result).toMatchObject({ appliedSteps: 0, failed: [] });
  });

  it('throws a 404 for an unknown scene', async () => {
    await expect(harness.scenes.activate(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});
