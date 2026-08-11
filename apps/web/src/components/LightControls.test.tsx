import type { RemoteType } from '@milight-studio/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { capabilitiesOf, capabilitiesOfAll } from '../state/capabilities.js';
import { makeState } from '../test-utils/index.js';

import { LightControls } from './LightControls.js';

function renderFor(remoteType: RemoteType, onCommand = vi.fn()): { onCommand: typeof onCommand } {
  render(
    <LightControls
      capabilities={capabilitiesOf(remoteType)}
      state={makeState({ power: 'on', colorMode: 'color', hue: 200, saturation: 60 })}
      onCommand={onCommand}
    />,
  );
  return { onCommand };
}

describe('capability gating', () => {
  it('renders colour and temperature controls for an rgb_cct light', () => {
    renderFor('rgb_cct');

    expect(screen.getByRole('slider', { name: /kleurenwiel/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/kleurtemperatuur/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/helderheid/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^effect$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nachtmodus' })).toBeInTheDocument();
  });

  it('renders temperature but no colour picker for a cct light', () => {
    renderFor('cct');

    expect(screen.getByLabelText(/kleurtemperatuur/i)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: /kleurenwiel/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^effect$/i)).not.toBeInTheDocument();
  });

  it('renders no temperature slider for an rgb light', () => {
    renderFor('rgb');

    expect(screen.queryByLabelText(/kleurtemperatuur/i)).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /kleurenwiel/i })).toBeInTheDocument();
  });

  it('offers relative brightness steps when the protocol cannot set a level', async () => {
    const user = userEvent.setup();
    const { onCommand } = renderFor('rgb');

    expect(screen.queryByLabelText(/helderheid$/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Feller' }));
    await user.click(screen.getByRole('button', { name: 'Dimmen' }));

    expect(onCommand).toHaveBeenNthCalledWith(1, { brightnessStep: 10 });
    expect(onCommand).toHaveBeenNthCalledWith(2, { brightnessStep: -10 });
  });

  it('renders no brightness control at all for fut020', () => {
    renderFor('fut020');

    expect(screen.queryByLabelText(/helderheid/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Feller' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nachtmodus' })).not.toBeInTheDocument();
  });

  it('sends white and night mode commands', async () => {
    const user = userEvent.setup();
    const { onCommand } = renderFor('rgb_cct');

    await user.click(screen.getByRole('button', { name: 'Wit licht' }));
    await user.click(screen.getByRole('button', { name: 'Nachtmodus' }));

    expect(onCommand).toHaveBeenNthCalledWith(1, { whiteMode: true });
    expect(onCommand).toHaveBeenNthCalledWith(2, { nightMode: true });
  });

  it('drives effects through the picker', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    renderFor('rgb_cct', onCommand);

    await user.selectOptions(screen.getByLabelText(/^effect$/i), '3');
    await user.click(screen.getByRole('button', { name: 'Volgende' }));
    await user.selectOptions(screen.getByLabelText(/^effect$/i), 'none');

    expect(onCommand).toHaveBeenNthCalledWith(1, { effect: 3 });
    expect(onCommand).toHaveBeenNthCalledWith(2, { effect: 'next' });
    expect(onCommand).toHaveBeenNthCalledWith(3, { whiteMode: true });
  });

  it('unions capabilities across a mixed group', () => {
    render(
      <LightControls
        capabilities={capabilitiesOfAll(['cct', 'rgb'])}
        state={makeState({ power: 'on' })}
        onCommand={vi.fn()}
        nameSuffix="Woonkamer"
      />,
    );

    expect(screen.getByLabelText(/kleurtemperatuur — woonkamer/i)).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /kleurenwiel — woonkamer/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/helderheid — woonkamer/i)).toBeInTheDocument();
  });

  it('falls back to no brightness when no member supports it', () => {
    const capabilities = capabilitiesOfAll(['fut020']);
    expect(capabilities.brightnessMode).toBe('none');
    expect(capabilitiesOfAll(['rgb', 'fut020']).brightnessMode).toBe('relative');
    expect(capabilitiesOfAll([]).effectCount).toBe(0);
  });
});
