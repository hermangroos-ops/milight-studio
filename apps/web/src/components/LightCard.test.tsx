import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { makeLight, makeState } from '../test-utils/index.js';

import { LightCard } from './LightCard.js';

describe('LightCard', () => {
  it('shows the name, room and protocol', () => {
    const light = makeLight({ name: 'Bank', room: 'Woonkamer' });
    render(<LightCard light={light} onCommand={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Bank' })).toBeInTheDocument();
    expect(screen.getByText(/Woonkamer · RGB \+ CCT/)).toBeInTheDocument();
  });

  it('sends power on when the toggle is switched on', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const light = makeLight({ name: 'Bank', state: makeState({ power: 'off' }) });
    render(<LightCard light={light} onCommand={onCommand} />);

    await user.click(screen.getByRole('switch', { name: 'Bank aan of uit' }));

    expect(onCommand).toHaveBeenCalledWith({ power: 'on' });
  });

  it('sends power off when the toggle is switched off', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const light = makeLight({ name: 'Bank', state: makeState({ power: 'on' }) });
    render(<LightCard light={light} onCommand={onCommand} />);

    const toggle = screen.getByRole('switch', { name: 'Bank aan of uit' });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(onCommand).toHaveBeenCalledWith({ power: 'off' });
  });

  it('shows the unreachable badge when the hub could not be reached', () => {
    const light = makeLight({ state: makeState({ reachable: false }) });
    render(<LightCard light={light} onCommand={vi.fn()} />);

    expect(screen.getByText('Onbereikbaar')).toBeInTheDocument();
  });

  it('hides the unreachable badge for a healthy light and shows mode badges', () => {
    const light = makeLight({ state: makeState({ nightMode: true, effect: 2 }) });
    render(<LightCard light={light} onCommand={vi.fn()} />);

    expect(screen.queryByText('Onbereikbaar')).not.toBeInTheDocument();
    expect(screen.getByText('Nachtmodus')).toBeInTheDocument();
    expect(screen.getByText('Modus 3')).toBeInTheDocument();
  });

  it('uses a toggle button for protocols that only support toggling', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const light = makeLight({ name: 'Strip', remoteType: 'fut020' });
    render(<LightCard light={light} onCommand={onCommand} />);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Wisselen: Strip' }));

    expect(onCommand).toHaveBeenCalledWith({ power: 'toggle' });
  });

  it('reveals the capability-gated controls on demand', async () => {
    const user = userEvent.setup();
    const light = makeLight({ name: 'Bank', remoteType: 'cct' });
    render(<LightCard light={light} onCommand={vi.fn()} />);

    expect(screen.queryByLabelText(/kleurtemperatuur/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Toon instellingen van Bank' }));

    expect(screen.getByLabelText(/kleurtemperatuur — bank/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verberg instellingen van Bank' }));
    expect(screen.queryByLabelText(/kleurtemperatuur/i)).not.toBeInTheDocument();
  });

  it('offers an edit button when a handler is supplied', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const light = makeLight({ name: 'Bank', room: null });
    render(<LightCard light={light} onCommand={vi.fn()} onEdit={onEdit} busy />);

    expect(screen.getByText(/Geen kamer/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bewerk Bank' }));

    expect(onEdit).toHaveBeenCalledWith(light);
    // A pending command must never disable a control: that would blur whatever the
    // user is operating. The card reports the pending state with aria-busy instead.
    expect(screen.getByRole('switch', { name: 'Bank aan of uit' })).toBeEnabled();
    expect(screen.getByRole('article', { name: 'Bank' })).toHaveAttribute('aria-busy', 'true');
  });
});
