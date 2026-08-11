import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { makeLight, makeScene } from '../test-utils/index.js';

import { BridgeList } from './BridgeList.js';
import { HubStatus } from './HubStatus.js';
import { PairingPanel } from './PairingPanel.js';
import { SceneCard } from './SceneCard.js';

describe('HubStatus', () => {
  const health = {
    status: 'ok' as const,
    version: '0.1.0',
    uptimeSeconds: 3600,
    hub: {
      reachable: true,
      url: 'http://milight.local',
      version: '1.11.0',
      checkedAt: '2024-01-01T10:00:00.000Z',
    },
  };

  it('renders the hub details', () => {
    render(<HubStatus health={health} isPending={false} error={null} />);

    expect(screen.getByText('In orde')).toBeInTheDocument();
    expect(screen.getByText('Bereikbaar')).toBeInTheDocument();
    expect(screen.getByText('1.11.0')).toBeInTheDocument();
    expect(screen.getByText('60 minuten')).toBeInTheDocument();
  });

  it('handles a degraded, unreachable hub with unknown fields', () => {
    render(
      <HubStatus
        health={{
          ...health,
          status: 'degraded',
          hub: { ...health.hub, reachable: false, version: null, checkedAt: null },
        }}
        isPending={false}
        error={null}
      />,
    );

    expect(screen.getByText('Verminderd')).toBeInTheDocument();
    expect(screen.getByText('Onbereikbaar')).toBeInTheDocument();
    expect(screen.getByText('onbekend')).toBeInTheDocument();
    expect(screen.getByText('nooit')).toBeInTheDocument();
  });

  it('falls back for an unparseable timestamp', () => {
    render(
      <HubStatus
        health={{ ...health, hub: { ...health.hub, checkedAt: 'zomaar' } }}
        isPending={false}
        error={null}
      />,
    );
    expect(screen.getByText('zomaar')).toBeInTheDocument();
  });

  it('shows loading and error states, and nothing without data', () => {
    const view = render(<HubStatus health={undefined} isPending error={null} />);
    expect(screen.getByText(/wordt opgehaald/)).toBeInTheDocument();

    view.rerender(<HubStatus health={undefined} isPending={false} error={new Error('x')} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    view.rerender(<HubStatus health={undefined} isPending={false} error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('BridgeList', () => {
  it('renders each bridge with its state', () => {
    render(
      <BridgeList
        bridges={[
          { name: 'alexa', enabled: true, running: true, detail: 'poort 3456' },
          { name: 'matter', enabled: true, running: false, detail: null },
          { name: 'hue', enabled: false, running: false, detail: null },
        ]}
      />,
    );

    expect(screen.getByText('Actief')).toBeInTheDocument();
    expect(screen.getByText('Gestopt')).toBeInTheDocument();
    expect(screen.getByText('Uitgeschakeld')).toBeInTheDocument();
    expect(screen.getByText(/poort 3456/)).toBeInTheDocument();
  });

  it('explains when there are none', () => {
    render(<BridgeList bridges={[]} />);
    expect(screen.getByText(/geen bruggen/i)).toBeInTheDocument();
  });
});

describe('PairingPanel', () => {
  it('tells the user to power-cycle first and pairs the selected light', async () => {
    const user = userEvent.setup();
    const onPair = vi.fn();
    const first = makeLight({ name: 'Bank' });
    const second = makeLight({ name: 'Eettafel' });
    render(<PairingPanel lights={[first, second]} onPair={onPair} />);

    expect(screen.getByText(/uit en weer aan/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Koppelen' }));
    expect(onPair).toHaveBeenCalledWith(first.id, true);

    await user.selectOptions(screen.getByLabelText('Lamp'), second.id);
    await user.click(screen.getByRole('button', { name: 'Ontkoppelen' }));
    expect(onPair).toHaveBeenLastCalledWith(second.id, false);
  });

  it('disables itself when there are no lights', () => {
    render(<PairingPanel lights={[]} onPair={vi.fn()} />);

    expect(screen.getByLabelText('Lamp')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Koppelen' })).toBeDisabled();
  });

  it('respects the busy flag', () => {
    render(<PairingPanel lights={[makeLight()]} busy onPair={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Koppelen' })).toBeDisabled();
  });
});

describe('SceneCard', () => {
  it('summarises the scene and activates it', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onDelete = vi.fn();
    const scene = makeScene({
      name: 'Filmavond',
      steps: [
        { targetType: 'light', targetId: 'a', command: { power: 'on' } },
        { targetType: 'group', targetId: 'b', command: { power: 'off' } },
      ],
    });
    render(<SceneCard scene={scene} onActivate={onActivate} onDelete={onDelete} />);

    expect(screen.getByText(/Geen kamer · 1 lampen · 1 groepen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activeer Filmavond' }));
    await user.click(screen.getByRole('button', { name: 'Verwijder Filmavond' }));

    expect(onActivate).toHaveBeenCalledWith(scene);
    expect(onDelete).toHaveBeenCalledWith(scene);
  });

  it('disables activation while busy and hides the voice badge when not exposed', () => {
    const scene = makeScene({ name: 'Nacht', room: 'Slaapkamer', exposeToVoice: false });
    render(<SceneCard scene={scene} busy onActivate={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Activeer Nacht' })).toBeDisabled();
    expect(screen.queryByText('Spraak')).not.toBeInTheDocument();
  });
});
