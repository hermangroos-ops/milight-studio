import { MilightHubUnreachableError } from '@milight-studio/milight-client';
import type { HubAddress } from '@milight-studio/milight-client';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDomain, type DomainHarness } from '../../tests/helpers/domain.js';
import { MISSING_ID, idAt, notAnError } from '../../tests/helpers/support.js';
import { ConflictError, HubUnreachableError, NotFoundError, ValidationError } from '../errors.js';

let harness: DomainHarness;

beforeEach(async () => {
  harness = await createDomain();
});

describe('GroupService.create', () => {
  it('creates a group with the injected id and clock', () => {
    const light = harness.addLight();
    const group = harness.groups.create({
      name: '  Woonkamer ',
      room: '  Beneden ',
      lightIds: [light.id],
      exposeToVoice: false,
    });

    expect(group).toEqual({
      id: idAt(2),
      name: 'Woonkamer',
      room: 'Beneden',
      lightIds: [light.id],
      exposeToVoice: false,
      createdAt: harness.clock.iso(),
      updatedAt: harness.clock.iso(),
    });
  });

  it('stores a missing room as null and emits group.created', () => {
    harness.emitted.length = 0;
    const group = harness.groups.create({ name: 'Zolder', lightIds: [], exposeToVoice: true });

    expect(group.room).toBeNull();
    expect(harness.emitted).toEqual([{ type: 'group.created', group }]);
  });

  it('de-duplicates the member list while keeping the first occurrence order', () => {
    const a = harness.addLight();
    const b = harness.addLight();
    const group = harness.groups.create({
      name: 'Woonkamer',
      lightIds: [b.id, a.id, b.id, a.id, b.id],
      exposeToVoice: true,
    });

    expect(group.lightIds).toEqual([b.id, a.id]);
  });

  it('rejects a duplicate name regardless of case and surrounding space', () => {
    harness.groups.create({ name: 'Woonkamer', lightIds: [], exposeToVoice: true });

    expect(() => harness.groups.create({ name: 'woonkamer', lightIds: [], exposeToVoice: true })).toThrow(
      ConflictError,
    );
    expect(() => harness.groups.create({ name: '  WOONKAMER  ', lightIds: [], exposeToVoice: true })).toThrow(
      ConflictError,
    );
  });

  it('rejects unknown light ids and names them all', () => {
    const known = harness.addLight();
    try {
      harness.groups.create({
        name: 'Woonkamer',
        lightIds: [known.id, MISSING_ID, idAt(99)],
        exposeToVoice: true,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).status).toBe(400);
      expect((error as ValidationError).details?.[0]?.path).toBe('lightIds');
      expect((error as ValidationError).details?.[0]?.message).toContain(MISSING_ID);
      expect((error as ValidationError).details?.[0]?.message).toContain(idAt(99));
    }
  });
});

describe('GroupService.list / get / members', () => {
  it('lists nothing to begin with', () => {
    expect(harness.groups.list()).toEqual([]);
  });

  it('lists a copy, so callers cannot mutate the store', () => {
    harness.groups.create({ name: 'A', lightIds: [], exposeToVoice: true });
    const listed = harness.groups.list();
    listed.pop();
    expect(harness.groups.list()).toHaveLength(1);
  });

  it('throws a 404 for an unknown group', () => {
    expect(() => harness.groups.get(MISSING_ID)).toThrow(NotFoundError);
  });

  it('resolves members with their state, in membership order', () => {
    const a = harness.addLight();
    const b = harness.addLight();
    const group = harness.groups.create({ name: 'A', lightIds: [b.id, a.id], exposeToVoice: true });

    expect(harness.groups.members(group.id).map((light) => light.id)).toEqual([b.id, a.id]);
    expect(harness.groups.members(group.id)[0]?.state).toBeDefined();
  });

  it('silently skips members that no longer exist', () => {
    const light = harness.addLight();
    const group = harness.groups.create({ name: 'A', lightIds: [light.id], exposeToVoice: true });
    harness.store.mutate((data) => {
      data.lights = [];
    });

    expect(harness.groups.members(group.id)).toEqual([]);
  });
});

describe('GroupService.update', () => {
  it('changes only what was supplied and stamps the clock', () => {
    const light = harness.addLight();
    const group = harness.groups.create({
      name: 'Oud',
      room: 'Beneden',
      lightIds: [light.id],
      exposeToVoice: true,
    });
    harness.clock.advance(1000);

    const updated = harness.groups.update(group.id, { name: ' Nieuw ' });

    expect(updated).toMatchObject({
      name: 'Nieuw',
      room: 'Beneden',
      lightIds: [light.id],
      createdAt: group.createdAt,
      updatedAt: harness.clock.iso(),
    });
  });

  it('replaces and de-duplicates the member list', () => {
    const a = harness.addLight();
    const b = harness.addLight();
    const group = harness.groups.create({ name: 'A', lightIds: [a.id], exposeToVoice: true });

    expect(harness.groups.update(group.id, { lightIds: [b.id, b.id] }).lightIds).toEqual([b.id]);
    expect(harness.groups.update(group.id, { lightIds: [] }).lightIds).toEqual([]);
  });

  it('clears the room and flips the voice flag', () => {
    const group = harness.groups.create({ name: 'A', room: 'X', lightIds: [], exposeToVoice: true });
    expect(harness.groups.update(group.id, { room: null }).room).toBeNull();
    expect(harness.groups.update(group.id, { exposeToVoice: false }).exposeToVoice).toBe(false);
  });

  it('emits group.updated and persists', async () => {
    const group = harness.groups.create({ name: 'A', lightIds: [], exposeToVoice: true });
    harness.emitted.length = 0;

    const updated = harness.groups.update(group.id, { name: 'B' });
    expect(harness.emitted).toEqual([{ type: 'group.updated', group: updated }]);

    await harness.store.flush();
    expect((await harness.persistence.load())?.groups[0]?.name).toBe('B');
  });

  it('rejects a name another group already uses but allows keeping its own', () => {
    harness.groups.create({ name: 'Bezet', lightIds: [], exposeToVoice: true });
    const group = harness.groups.create({ name: 'Vrij', lightIds: [], exposeToVoice: true });

    expect(() => harness.groups.update(group.id, { name: 'bezet' })).toThrow(ConflictError);
    expect(() => harness.groups.update(group.id, { name: 'Vrij' })).not.toThrow();
  });

  it('rejects unknown members', () => {
    const group = harness.groups.create({ name: 'A', lightIds: [], exposeToVoice: true });
    expect(() => harness.groups.update(group.id, { lightIds: [MISSING_ID] })).toThrow(ValidationError);
  });

  it('throws a 404 for an unknown group', () => {
    expect(() => harness.groups.update(MISSING_ID, { name: 'x' })).toThrow(NotFoundError);
  });
});

describe('GroupService.remove', () => {
  it('deletes the group and emits group.deleted, leaving the lights alone', async () => {
    const light = harness.addLight();
    const group = harness.groups.create({ name: 'A', lightIds: [light.id], exposeToVoice: true });
    harness.emitted.length = 0;

    harness.groups.remove(group.id);

    expect(harness.groups.list()).toEqual([]);
    expect(harness.lights.find(light.id)).toBeDefined();
    expect(harness.emitted).toEqual([{ type: 'group.deleted', groupId: group.id }]);

    await harness.store.flush();
    expect((await harness.persistence.load())?.groups).toEqual([]);
  });

  it('strips the group from every scene step', () => {
    const light = harness.addLight();
    const group = harness.groups.create({ name: 'A', lightIds: [light.id], exposeToVoice: true });
    const scene = harness.scenes.create({
      name: 'S',
      exposeToVoice: true,
      steps: [
        { targetType: 'group', targetId: group.id, command: { power: 'on' } },
        { targetType: 'light', targetId: light.id, command: { power: 'on' } },
      ],
    });

    harness.groups.remove(group.id);

    expect(harness.scenes.get(scene.id).steps.map((step) => step.targetId)).toEqual([light.id]);
  });

  it('throws a 404 for an unknown group', () => {
    expect(() => {
      harness.groups.remove(MISSING_ID);
    }).toThrow(NotFoundError);
  });
});

describe('GroupService.command', () => {
  it('rejects a command to an empty group with a 400 and never touches the hub', async () => {
    const group = harness.groups.create({ name: 'Leeg', lightIds: [], exposeToVoice: true });

    const error = await harness.groups.command(group.id, { power: 'on' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).status).toBe(400);
    expect((error as ValidationError).details?.[0]?.path).toBe('lightIds');
    expect(harness.hub.calls).toEqual([]);
  });

  it('fans the command out to every member, in membership order', async () => {
    const a = harness.addLight({ deviceId: '0x0001' });
    const b = harness.addLight({ deviceId: '0x0002' });
    const c = harness.addLight({ deviceId: '0x0003' });
    const group = harness.groups.create({
      name: 'Woonkamer',
      lightIds: [c.id, a.id, b.id],
      exposeToVoice: true,
    });

    const result = await harness.groups.command(group.id, { power: 'on', brightness: 30 });

    expect(harness.hub.commands.map((call) => call.address.deviceId)).toEqual(['0x0003', '0x0001', '0x0002']);
    expect(harness.hub.commands.every((call) => call.body.status === 'ON')).toBe(true);
    expect(result.lights.map((light) => light.id)).toEqual([c.id, a.id, b.id]);
    expect(result.failed).toEqual([]);
    expect(result.group.id).toBe(group.id);
  });

  it('addresses members one at a time rather than in parallel', async () => {
    const lights = [harness.addLight(), harness.addLight(), harness.addLight()];
    const group = harness.groups.create({
      name: 'Woonkamer',
      lightIds: lights.map((light) => light.id),
      exposeToVoice: true,
    });

    const seen: number[] = [];
    const original = harness.hub.sendCommand.bind(harness.hub);
    harness.hub.sendCommand = async (address, body) => {
      seen.push(harness.hub.commands.length);
      await Promise.resolve();
      return original(address, body);
    };

    await harness.groups.command(group.id, { power: 'on' });
    expect(seen).toEqual([0, 1, 2]);
  });

  it('reports a partial failure while the other members still change', async () => {
    const good = harness.addLight({ deviceId: '0x0001' });
    const bad = harness.addLight({ deviceId: '0x0002' });
    const alsoGood = harness.addLight({ deviceId: '0x0003' });
    const group = harness.groups.create({
      name: 'Woonkamer',
      lightIds: [good.id, bad.id, alsoGood.id],
      exposeToVoice: true,
    });

    harness.hub.failWith = new MilightHubUnreachableError('down');
    harness.hub.failWhen = (address?: HubAddress) => address?.deviceId === '0x0002';

    const result = await harness.groups.command(group.id, { power: 'on' });

    expect(result.lights.map((light) => light.id)).toEqual([good.id, alsoGood.id]);
    expect(result.failed).toEqual([
      { lightId: bad.id, code: 'hub_unreachable', message: expect.any(String) },
    ]);
    expect(harness.lights.getState(good.id).power).toBe('on');
    expect(harness.lights.getState(bad.id).reachable).toBe(false);
  });

  it('reports a per-light validation failure without aborting the fan-out', async () => {
    const colour = harness.addLight({ remoteType: 'rgb_cct', groupId: 1 });
    const white = harness.addLight({ remoteType: 'cct', groupId: 1 });
    const group = harness.groups.create({
      name: 'Gemengd',
      lightIds: [colour.id, white.id],
      exposeToVoice: true,
    });

    const result = await harness.groups.command(group.id, { hue: 120 });

    expect(result.lights.map((light) => light.id)).toEqual([colour.id]);
    expect(result.failed).toEqual([
      { lightId: white.id, code: 'unsupported_capability', message: expect.any(String) },
    ]);
  });

  it('rethrows the first failure when nothing at all worked', async () => {
    const a = harness.addLight();
    const b = harness.addLight();
    const group = harness.groups.create({
      name: 'Woonkamer',
      lightIds: [a.id, b.id],
      exposeToVoice: true,
    });

    harness.hub.failWith = new MilightHubUnreachableError('down');

    await expect(harness.groups.command(group.id, { power: 'on' })).rejects.toBeInstanceOf(
      HubUnreachableError,
    );
  });

  it('wraps a non-Error rejection when nothing worked', async () => {
    const light = harness.addLight();
    const group = harness.groups.create({ name: 'A', lightIds: [light.id], exposeToVoice: true });
    harness.hub.failWith = notAnError('just a string');

    const error = await harness.groups.command(group.id, { power: 'on' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Every light in the group failed to respond');
  });

  it('classifies a non-AppError failure as internal_error in the failed list', async () => {
    const good = harness.addLight({ deviceId: '0x0001' });
    const bad = harness.addLight({ deviceId: '0x0002' });
    const group = harness.groups.create({
      name: 'A',
      lightIds: [good.id, bad.id],
      exposeToVoice: true,
    });

    harness.hub.failWith = new RangeError('boom');
    harness.hub.failWhen = (address?: HubAddress) => address?.deviceId === '0x0002';

    const result = await harness.groups.command(group.id, { power: 'on' });
    expect(result.failed).toEqual([{ lightId: bad.id, code: 'internal_error', message: 'boom' }]);
  });

  it('skips a member that has since been deleted, reporting it as not found', async () => {
    const light = harness.addLight();
    const ghost = harness.addLight();
    const group = harness.groups.create({
      name: 'A',
      lightIds: [light.id, ghost.id],
      exposeToVoice: true,
    });
    harness.store.mutate((data) => {
      data.lights = data.lights.filter((entry) => entry.id !== ghost.id);
    });

    const result = await harness.groups.command(group.id, { power: 'on' });
    expect(result.failed).toEqual([{ lightId: ghost.id, code: 'not_found', message: expect.any(String) }]);
  });

  it('throws a 404 for an unknown group', async () => {
    await expect(harness.groups.command(MISSING_ID, { power: 'on' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
