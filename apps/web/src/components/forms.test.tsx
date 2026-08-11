import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { makeGroup, makeLight, makeState } from '../test-utils/index.js';

import { GroupCard } from './GroupCard.js';
import { GroupForm } from './GroupForm.js';
import { SceneForm } from './SceneForm.js';

describe('GroupForm', () => {
  it('requires a name', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GroupForm lights={[]} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Groep aanmaken' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Geef de groep een naam.');
    expect(screen.getByText(/nog geen lampen/i)).toBeInTheDocument();
  });

  it('submits the picked members', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const first = makeLight({ name: 'Bank' });
    const second = makeLight({ name: 'Eettafel', room: null });
    render(<GroupForm lights={[first, second]} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/^naam$/i), 'Woonkamer');
    await user.type(screen.getByLabelText(/^kamer/i), 'Beneden');
    await user.click(screen.getByRole('checkbox', { name: /Bank/ }));
    await user.click(screen.getByRole('checkbox', { name: /Eettafel/ }));
    await user.click(screen.getByRole('checkbox', { name: /Eettafel/ }));
    await user.click(screen.getByRole('button', { name: 'Groep aanmaken' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Woonkamer',
      room: 'Beneden',
      lightIds: [first.id],
      exposeToVoice: true,
    });
  });

  it('pre-fills when editing an existing group', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const light = makeLight({ name: 'Bank' });
    const group = makeGroup({ name: 'Woonkamer', room: null, lightIds: [light.id] });
    render(<GroupForm lights={[light]} initial={group} onSubmit={onSubmit} />);

    expect(screen.getByRole('checkbox', { name: /Bank/ })).toBeChecked();
    await user.click(screen.getByRole('switch', { name: /spraakbesturing/i }));
    await user.click(screen.getByRole('button', { name: 'Groep opslaan' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Woonkamer',
      room: null,
      lightIds: [light.id],
      exposeToVoice: false,
    });
  });
});

describe('SceneForm', () => {
  it('requires a name and at least one target', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SceneForm lights={[]} groups={[]} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Scène opslaan' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Geef de scène een naam.');

    await user.type(screen.getByLabelText(/^naam$/i), 'Filmavond');
    await user.click(screen.getByRole('button', { name: 'Scène opslaan' }));
    expect(screen.getByRole('alert')).toHaveTextContent('minstens één lamp of groep');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('captures the current state of the selected lights and groups', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const light = makeLight({ name: 'Bank', state: makeState({ power: 'on', brightness: 35 }) });
    const group = makeGroup({ name: 'Woonkamer', lightIds: [light.id] });
    render(<SceneForm lights={[light]} groups={[group]} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/^naam$/i), 'Filmavond');
    await user.type(screen.getByLabelText(/^kamer/i), 'Beneden');
    await user.click(screen.getByRole('checkbox', { name: 'Bank' }));
    await user.click(screen.getByRole('checkbox', { name: 'Woonkamer' }));
    await user.click(screen.getByRole('button', { name: 'Scène opslaan' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Filmavond',
        room: 'Beneden',
        exposeToVoice: true,
      }),
    );
    const steps = onSubmit.mock.calls[0]![0].steps as { targetType: string }[];
    expect(steps.map((step) => step.targetType)).toEqual(['light', 'group']);
  });

  it('says when there is nothing to capture', () => {
    render(<SceneForm lights={[]} groups={[]} busy onSubmit={vi.fn()} />);

    expect(screen.getByText('Nog geen lampen.')).toBeInTheDocument();
    expect(screen.getByText('Nog geen groepen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scène opslaan' })).toBeDisabled();
  });
});

describe('GroupCard', () => {
  it('summarises the members and drives them all at once', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const first = makeLight({ remoteType: 'rgb_cct', state: makeState({ power: 'on' }) });
    const second = makeLight({ remoteType: 'cct', state: makeState({ reachable: false }) });
    const group = makeGroup({ name: 'Woonkamer', lightIds: [first.id, second.id] });

    render(
      <GroupCard
        group={group}
        members={[first, second]}
        onCommand={onCommand}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('1 onbereikbaar')).toBeInTheDocument();
    expect(screen.getByText(/2 lampen/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Woonkamer aan of uit' }));
    expect(onCommand).toHaveBeenCalledWith({ power: 'off' });

    await user.click(screen.getByRole('button', { name: 'Toon bediening van Woonkamer' }));
    expect(screen.getByLabelText(/kleurtemperatuur — woonkamer/i)).toBeInTheDocument();
  });

  it('lists per-light failures by name', () => {
    const light = makeLight({ name: 'Bank' });
    const group = makeGroup({ name: 'Woonkamer', lightIds: [light.id] });

    render(
      <GroupCard
        group={group}
        members={[light]}
        failures={[
          { lightId: light.id, code: 'unsupported_capability', message: 'Kent geen kleur' },
          { lightId: 'onbekend', code: 'hub_error', message: 'Hub weg' },
        ]}
        onCommand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Bank: Kent geen kleur')).toBeInTheDocument();
    expect(screen.getByText('onbekend: Hub weg')).toBeInTheDocument();
  });

  it('handles an empty group and exposes edit and delete', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const group = makeGroup({ name: 'Leeg', room: null, exposeToVoice: false });

    render(<GroupCard group={group} members={[]} onCommand={vi.fn()} onEdit={onEdit} onDelete={onDelete} />);

    expect(screen.getByRole('switch', { name: 'Leeg aan of uit' })).toBeDisabled();
    expect(screen.queryByText('Spraak')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toon bediening van Leeg' }));
    expect(screen.getByText(/Voeg eerst lampen toe/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bewerk Leeg' }));
    await user.click(screen.getByRole('button', { name: 'Verwijder Leeg' }));
    expect(onEdit).toHaveBeenCalledWith(group);
    expect(onDelete).toHaveBeenCalledWith(group);
  });
});
