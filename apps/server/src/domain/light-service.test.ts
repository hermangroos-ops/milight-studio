import { MilightHubResponseError, MilightHubUnreachableError } from '@milight-studio/milight-client';
import { beforeEach, describe, expect, it } from 'vitest';

import { MISSING_ID, idAt } from '../../tests/helpers/support.js';
import { createDomain, type DomainHarness } from '../../tests/helpers/domain.js';
import {
  ConflictError,
  HubFailureError,
  HubUnreachableError,
  NotFoundError,
  UnsupportedCapabilityError,
  ValidationError,
} from '../errors.js';
import { systemClock, toHubAddress, translateHubError } from './light-service.js';

let harness: DomainHarness;

beforeEach(async () => {
  harness = await createDomain();
});

describe('systemClock', () => {
  it('reads the wall clock', () => {
    const before = Date.now();
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('toHubAddress', () => {
  it('keeps only the three fields that make up a radio address', () => {
    expect(toHubAddress({ deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 3 })).toEqual({
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 3,
    });
  });
});

describe('translateHubError', () => {
  it('turns an unreachable hub into a 503', () => {
    const cause = new MilightHubUnreachableError('nope');
    try {
      translateHubError(cause);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HubUnreachableError);
      expect((error as HubUnreachableError).status).toBe(503);
      expect((error as Error).cause).toBe(cause);
    }
  });

  it('turns a hub rejection into a 502', () => {
    const cause = new MilightHubResponseError('bad', 500, 'oops');
    try {
      translateHubError(cause);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HubFailureError);
      expect((error as HubFailureError).status).toBe(502);
      expect((error as Error).message).toContain('bad');
    }
  });

  it('rethrows anything it does not recognise untouched', () => {
    const other = new RangeError('something else');
    expect(() => translateHubError(other)).toThrow(other);
  });
});

describe('LightService.create', () => {
  it('normalises the device id and stamps the injected clock and id generator', () => {
    const light = harness.lights.create({
      name: '  Bureau  ',
      room: '  Studeerkamer ',
      deviceId: '0X1',
      remoteType: 'rgb_cct',
      groupId: 2,
      exposeToVoice: false,
    });

    expect(light).toMatchObject({
      id: idAt(1),
      name: 'Bureau',
      room: 'Studeerkamer',
      deviceId: '0x0001',
      groupId: 2,
      exposeToVoice: false,
      createdAt: harness.clock.iso(),
      updatedAt: harness.clock.iso(),
    });
    expect(light.state.power).toBe('off');
    expect(light.state.updatedAt).toBe(harness.clock.iso());
  });

  it('stores a missing room as null', () => {
    expect(harness.addLight({ room: undefined }).room).toBeNull();
    expect(harness.addLight({ room: null }).room).toBeNull();
  });

  it('emits light.created and persists the light with a default state', async () => {
    const light = harness.addLight();
    expect(harness.emitted).toEqual([
      { type: 'light.created', light: expect.objectContaining({ id: light.id }) },
    ]);

    await harness.store.flush();
    const persisted = await harness.persistence.load();
    expect(persisted?.lights.map((entry) => entry.id)).toEqual([light.id]);
    expect(persisted?.states[light.id]?.power).toBe('off');
  });

  it('rejects a duplicate radio address with a conflict', () => {
    harness.addLight({ deviceId: '0x0007', remoteType: 'rgb_cct', groupId: 3, name: 'Eerste' });
    expect(() =>
      harness.addLight({ deviceId: '0x7', remoteType: 'rgb_cct', groupId: 3, name: 'Tweede' }),
    ).toThrow(ConflictError);

    try {
      harness.addLight({ deviceId: '0x0007', remoteType: 'rgb_cct', groupId: 3 });
    } catch (error) {
      expect((error as ConflictError).status).toBe(409);
      expect((error as Error).message).toContain('Eerste');
    }
  });

  it('allows the same device id on a different group or protocol', () => {
    harness.addLight({ deviceId: '0x0007', remoteType: 'rgb_cct', groupId: 1 });
    expect(() => harness.addLight({ deviceId: '0x0007', remoteType: 'rgb_cct', groupId: 2 })).not.toThrow();
    expect(() => harness.addLight({ deviceId: '0x0007', remoteType: 'rgbw', groupId: 1 })).not.toThrow();
  });

  it.each([
    { remoteType: 'rgb' as const, groupId: 1 },
    { remoteType: 'fut020' as const, groupId: 4 },
    { remoteType: 'rgb_cct' as const, groupId: 5 },
    { remoteType: 'cct' as const, groupId: 8 },
  ])('rejects group $groupId for $remoteType', ({ remoteType, groupId }) => {
    try {
      harness.addLight({ remoteType, groupId });
      expect.unreachable('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).status).toBe(400);
      expect((error as ValidationError).details?.[0]?.path).toBe('groupId');
      expect((error as ValidationError).details?.[0]?.message).toContain(remoteType);
    }
  });

  it.each([
    { remoteType: 'fut089' as const, groupId: 8 },
    { remoteType: 'rgb' as const, groupId: 0 },
    { remoteType: 'fut020' as const, groupId: 0 },
  ])('accepts group $groupId for $remoteType', ({ remoteType, groupId }) => {
    expect(harness.addLight({ remoteType, groupId }).groupId).toBe(groupId);
  });
});

describe('LightService.list / find / get', () => {
  it('lists nothing to begin with', () => {
    expect(harness.lights.list()).toEqual([]);
  });

  it('lists every light with its state attached', () => {
    const first = harness.addLight();
    const second = harness.addLight();
    expect(harness.lights.list().map((light) => light.id)).toEqual([first.id, second.id]);
    expect(harness.lights.list()[0]?.state).toBeDefined();
  });

  it('finds a known light and returns undefined for an unknown one', () => {
    const light = harness.addLight();
    expect(harness.lights.find(light.id)?.id).toBe(light.id);
    expect(harness.lights.find(MISSING_ID)).toBeUndefined();
  });

  it('throws a 404 from get for an unknown light', () => {
    try {
      harness.lights.get(MISSING_ID);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).status).toBe(404);
      expect((error as Error).message).toContain(MISSING_ID);
    }
  });

  it('exposes the state directly', () => {
    const light = harness.addLight();
    expect(harness.lights.getState(light.id)).toEqual(light.state);
  });

  it('synthesises a default state when persistence lost it', () => {
    const light = harness.addLight();
    harness.store.mutate((data) => {
      data.states = {};
    });
    expect(harness.lights.getState(light.id).power).toBe('off');
  });
});

describe('LightService.update', () => {
  it('changes only the fields that were supplied', () => {
    const light = harness.addLight({ name: 'Oud', room: 'Zolder' });
    harness.clock.advance(60_000);

    const updated = harness.lights.update(light.id, { name: '  Nieuw ' });

    expect(updated).toMatchObject({
      name: 'Nieuw',
      room: 'Zolder',
      deviceId: light.deviceId,
      remoteType: light.remoteType,
      groupId: light.groupId,
      createdAt: light.createdAt,
      updatedAt: harness.clock.iso(),
    });
  });

  it('clears the room when explicitly set to null', () => {
    const light = harness.addLight({ room: 'Zolder' });
    expect(harness.lights.update(light.id, { room: null }).room).toBeNull();
  });

  it('moves a light to a new radio address', () => {
    const light = harness.addLight({ deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 });
    const moved = harness.lights.update(light.id, { deviceId: '0X2', remoteType: 'fut089', groupId: 7 });
    expect(moved).toMatchObject({ deviceId: '0x0002', remoteType: 'fut089', groupId: 7 });
  });

  it('emits light.updated and persists the change', async () => {
    const light = harness.addLight();
    harness.emitted.length = 0;

    const { state: _state, ...updated } = harness.lights.update(light.id, { name: 'Nieuw' });
    expect(harness.emitted).toEqual([{ type: 'light.updated', light: updated }]);

    await harness.store.flush();
    expect((await harness.persistence.load())?.lights[0]?.name).toBe('Nieuw');
  });

  it('rejects a move onto an address another light already owns', () => {
    harness.addLight({ deviceId: '0x0001', groupId: 1, name: 'Bezet' });
    const other = harness.addLight({ deviceId: '0x0002', groupId: 2 });

    expect(() => harness.lights.update(other.id, { deviceId: '0x0001', groupId: 1 })).toThrow(ConflictError);
  });

  it('allows an update that keeps the light on its own address', () => {
    const light = harness.addLight({ deviceId: '0x0001', groupId: 1 });
    expect(() => harness.lights.update(light.id, { deviceId: '0x0001', groupId: 1 })).not.toThrow();
  });

  it('rejects a group that the new remote type cannot address', () => {
    const light = harness.addLight({ remoteType: 'fut089', groupId: 7 });
    expect(() => harness.lights.update(light.id, { remoteType: 'rgb_cct' })).toThrow(ValidationError);
  });

  it('throws a 404 for an unknown light', () => {
    expect(() => harness.lights.update(MISSING_ID, { name: 'x' })).toThrow(NotFoundError);
  });

  it('leaves the shadow state untouched', () => {
    const light = harness.addLight();
    const updated = harness.lights.update(light.id, { name: 'Nieuw' });
    expect(updated.state).toEqual(light.state);
  });
});

describe('LightService.remove', () => {
  it('deletes the light, its state, and emits light.deleted', async () => {
    const light = harness.addLight();
    harness.emitted.length = 0;

    harness.lights.remove(light.id);

    expect(harness.lights.list()).toEqual([]);
    expect(harness.emitted).toEqual([{ type: 'light.deleted', lightId: light.id }]);

    await harness.store.flush();
    const persisted = await harness.persistence.load();
    expect(persisted?.lights).toEqual([]);
    expect(persisted?.states[light.id]).toBeUndefined();
  });

  it('detaches the light from every group without touching the others', () => {
    const doomed = harness.addLight();
    const survivor = harness.addLight();
    const group = harness.groups.create({
      name: 'Woonkamer',
      lightIds: [doomed.id, survivor.id],
      exposeToVoice: true,
    });
    const untouched = harness.groups.create({
      name: 'Zolder',
      lightIds: [survivor.id],
      exposeToVoice: true,
    });

    harness.lights.remove(doomed.id);

    expect(harness.groups.get(group.id).lightIds).toEqual([survivor.id]);
    expect(harness.groups.get(untouched.id)).toEqual(untouched);
  });

  it('strips the light from every scene step but keeps the other steps', () => {
    const doomed = harness.addLight();
    const survivor = harness.addLight();
    const group = harness.groups.create({ name: 'Groep', lightIds: [survivor.id], exposeToVoice: true });
    const scene = harness.scenes.create({
      name: 'Filmavond',
      exposeToVoice: true,
      steps: [
        { targetType: 'light', targetId: doomed.id, command: { power: 'on' } },
        { targetType: 'light', targetId: survivor.id, command: { power: 'on' } },
        { targetType: 'group', targetId: group.id, command: { power: 'on' } },
      ],
    });

    harness.lights.remove(doomed.id);

    expect(harness.scenes.get(scene.id).steps.map((step) => step.targetId)).toEqual([survivor.id, group.id]);
  });

  it('throws a 404 for an unknown light', () => {
    expect(() => {
      harness.lights.remove(MISSING_ID);
    }).toThrow(NotFoundError);
  });
});

describe('LightService.command', () => {
  it('sends the translated body to the hub and commits the new state', async () => {
    const light = harness.addLight({ deviceId: '0x000a', remoteType: 'rgb_cct', groupId: 2 });
    harness.emitted.length = 0;
    harness.clock.advance(1000);

    const result = await harness.lights.command(light.id, { power: 'on', brightness: 40 });

    expect(harness.hub.commands).toEqual([
      {
        address: { deviceId: '0x000a', remoteType: 'rgb_cct', groupId: 2 },
        body: { status: 'ON', level: 40 },
      },
    ]);
    expect(result.state).toMatchObject({
      power: 'on',
      brightness: 40,
      reachable: true,
      updatedAt: harness.clock.iso(),
    });
    expect(harness.emitted).toEqual([{ type: 'light.state', lightId: light.id, state: result.state }]);

    await harness.store.flush();
    expect((await harness.persistence.load())?.states[light.id]).toEqual(result.state);
  });

  it('makes the new state visible to subsequent reads', async () => {
    const light = harness.addLight();
    await harness.lights.command(light.id, { power: 'on', brightness: 25 });
    expect(harness.lights.getState(light.id)).toMatchObject({ power: 'on', brightness: 25 });
  });

  it('rejects conflicting fields with a 400 before touching the hub', async () => {
    const light = harness.addLight();
    const error = await harness.lights
      .command(light.id, { hue: 30, colorTemperature: 3000 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).status).toBe(400);
    expect((error as ValidationError).details?.map((detail) => detail.path)).toEqual(['colorTemperature']);
    expect(harness.hub.calls).toEqual([]);
  });

  it.each([
    { remoteType: 'cct' as const, command: { hue: 200 }, capability: 'color' },
    { remoteType: 'fut020' as const, command: { brightness: 50 }, capability: 'brightness' },
    { remoteType: 'rgbw' as const, command: { colorTemperature: 3000 }, capability: 'colorTemperature' },
    { remoteType: 'rgb' as const, command: { nightMode: true as const }, capability: 'nightMode' },
  ])('rejects $command on $remoteType with a 422', async ({ remoteType, command, capability }) => {
    const light = harness.addLight({ remoteType, groupId: 0 });
    const error = await harness.lights.command(light.id, command).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnsupportedCapabilityError);
    expect((error as UnsupportedCapabilityError).status).toBe(422);
    expect((error as UnsupportedCapabilityError).details?.[0]?.path).toBe(capability);
    expect((error as UnsupportedCapabilityError).details?.[0]?.message).toContain(remoteType);
    expect(harness.hub.calls).toEqual([]);
  });

  it('still sends a command whose supported half is non-empty', async () => {
    const light = harness.addLight({ remoteType: 'cct', groupId: 1 });
    const result = await harness.lights.command(light.id, { power: 'on', hue: 200 });

    expect(harness.hub.commands[0]?.body).toEqual({ status: 'ON' });
    expect(result.state.colorMode).not.toBe('color');
  });

  it('throws a 404 for an unknown light', async () => {
    await expect(harness.lights.command(MISSING_ID, { power: 'on' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('marks the light unreachable and reports 503 when the hub cannot be reached', async () => {
    const light = harness.addLight();
    harness.emitted.length = 0;
    harness.hub.failWith = new MilightHubUnreachableError('no route to host');

    const error = await harness.lights.command(light.id, { power: 'on' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HubUnreachableError);
    expect((error as HubUnreachableError).status).toBe(503);
    expect(harness.lights.getState(light.id).reachable).toBe(false);
    expect(harness.emitted).toEqual([
      {
        type: 'light.state',
        lightId: light.id,
        state: expect.objectContaining({ reachable: false }),
      },
    ]);
  });

  it('marks the light unreachable and reports 502 when the hub rejects the request', async () => {
    const light = harness.addLight();
    harness.hub.failWith = new MilightHubResponseError('bad gateway', 500, 'boom');

    const error = await harness.lights.command(light.id, { power: 'on' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HubFailureError);
    expect((error as HubFailureError).status).toBe(502);
    expect(harness.lights.getState(light.id).reachable).toBe(false);
  });

  it('does not re-emit an unreachable state for an already unreachable light', async () => {
    const light = harness.addLight();
    harness.hub.failWith = new MilightHubUnreachableError('down');

    await harness.lights.command(light.id, { power: 'on' }).catch(() => undefined);
    harness.emitted.length = 0;
    await harness.lights.command(light.id, { power: 'on' }).catch(() => undefined);

    expect(harness.emitted).toEqual([]);
  });

  it('clears the unreachable flag as soon as a command lands again', async () => {
    const light = harness.addLight();
    harness.hub.failWith = new MilightHubUnreachableError('down');
    await harness.lights.command(light.id, { power: 'on' }).catch(() => undefined);

    harness.hub.failWith = null;
    const recovered = await harness.lights.command(light.id, { power: 'on' });
    expect(recovered.state.reachable).toBe(true);
  });

  it('lets an unexpected failure bubble up unchanged', async () => {
    const light = harness.addLight();
    const boom = new RangeError('unexpected');
    harness.hub.failWith = boom;

    await expect(harness.lights.command(light.id, { power: 'on' })).rejects.toBe(boom);
  });
});

describe('LightService.refresh', () => {
  it('folds the hub state into the shadow state and emits it', async () => {
    const light = harness.addLight();
    harness.hub.state = { state: 'ON', level: 80, bulb_mode: 'color', hue: 100, saturation: 50 };
    harness.emitted.length = 0;
    harness.clock.advance(5000);

    const refreshed = await harness.lights.refresh(light.id);

    expect(harness.hub.calls.map((call) => call.kind)).toEqual(['getState']);
    expect(refreshed.state).toMatchObject({
      power: 'on',
      brightness: 80,
      colorMode: 'color',
      hue: 100,
      saturation: 50,
      reachable: true,
      updatedAt: harness.clock.iso(),
    });
    expect(harness.emitted).toEqual([{ type: 'light.state', lightId: light.id, state: refreshed.state }]);
  });

  it('marks the light unreachable and translates the failure', async () => {
    const light = harness.addLight();
    harness.hub.failWith = new MilightHubUnreachableError('down');

    await expect(harness.lights.refresh(light.id)).rejects.toBeInstanceOf(HubUnreachableError);
    expect(harness.lights.getState(light.id).reachable).toBe(false);
  });

  it('throws a 404 for an unknown light', async () => {
    await expect(harness.lights.refresh(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('LightService.pair / unpair', () => {
  it.each(['pair', 'unpair'] as const)('sends %s to the light address', async (operation) => {
    const light = harness.addLight({ deviceId: '0x00ff', remoteType: 'rgbw', groupId: 3 });
    await harness.lights[operation](light.id);

    expect(harness.hub.calls).toEqual([
      { kind: operation, address: { deviceId: '0x00ff', remoteType: 'rgbw', groupId: 3 } },
    ]);
  });

  it.each(['pair', 'unpair'] as const)('translates a hub failure during %s', async (operation) => {
    const light = harness.addLight();
    harness.hub.failWith = new MilightHubResponseError('nope', 500, '');

    await expect(harness.lights[operation](light.id)).rejects.toBeInstanceOf(HubFailureError);
  });

  it.each(['pair', 'unpair'] as const)('does not mark the light unreachable on a failed %s', async (op) => {
    const light = harness.addLight();
    harness.hub.failWith = new MilightHubUnreachableError('down');

    await expect(harness.lights[op](light.id)).rejects.toBeInstanceOf(HubUnreachableError);
    expect(harness.lights.getState(light.id).reachable).toBe(true);
  });

  it.each(['pair', 'unpair'] as const)('throws a 404 from %s for an unknown light', async (operation) => {
    await expect(harness.lights[operation](MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});
