import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/endpoints.js';
import {
  createHarness,
  makeGroup,
  makeLight,
  makeQueryClient,
  makeScene,
  makeState,
} from '../test-utils/index.js';

import { GroupsPage } from './GroupsPage.js';
import { LightsPage } from './LightsPage.js';
import { ScenesPage } from './ScenesPage.js';
import { SettingsPage } from './SettingsPage.js';

const light = makeLight({ name: 'Bank', room: 'Woonkamer', state: makeState({ power: 'off' }) });
const group = makeGroup({ name: 'Woonkamer', lightIds: [light.id] });
const scene = makeScene({ name: 'Filmavond' });

beforeEach(() => {
  vi.spyOn(api, 'listLights').mockResolvedValue([light]);
  vi.spyOn(api, 'listGroups').mockResolvedValue([group]);
  vi.spyOn(api, 'listScenes').mockResolvedValue([scene]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(ui: React.ReactElement): void {
  const { wrapper: Wrapper } = createHarness(makeQueryClient());
  render(<Wrapper>{ui}</Wrapper>);
}

describe('LightsPage', () => {
  it('sends a command when a light is switched on', async () => {
    const user = userEvent.setup();
    const setState = vi
      .spyOn(api, 'setLightState')
      .mockResolvedValue({ ...light, state: makeState({ power: 'on' }) });
    renderPage(<LightsPage />);

    await user.click(await screen.findByRole('switch', { name: 'Bank aan of uit' }));

    expect(setState).toHaveBeenCalledWith(light.id, { power: 'on' });
  });

  it('edits a light through the modal', async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(api, 'updateLight').mockResolvedValue(light);
    renderPage(<LightsPage />);

    await user.click(await screen.findByRole('button', { name: 'Bewerk Bank' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Bank bewerken');

    await user.click(within(dialog).getByRole('button', { name: 'Wijzigingen opslaan' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(light.id, expect.objectContaining({ name: 'Bank' }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deletes a light from the modal footer', async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(api, 'deleteLight').mockResolvedValue(undefined);
    renderPage(<LightsPage />);

    await user.click(await screen.findByRole('button', { name: 'Bewerk Bank' }));
    await user.click(screen.getByRole('button', { name: 'Lamp verwijderen' }));

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith(light.id);
    });
  });

  it('shows the empty state', async () => {
    vi.spyOn(api, 'listLights').mockResolvedValue([]);
    renderPage(<LightsPage />);

    expect(await screen.findByText(/Nog geen lampen/)).toBeInTheDocument();
  });
});

describe('GroupsPage', () => {
  it('creates a group', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(api, 'createGroup').mockResolvedValue(group);
    renderPage(<GroupsPage />);

    await user.click(await screen.findByRole('button', { name: 'Nieuwe groep' }));
    await user.type(screen.getByLabelText(/^naam$/i), 'Zolder');
    await user.click(screen.getByRole('button', { name: 'Groep aanmaken' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zolder' }));
    });
  });

  it('edits and deletes a group', async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(api, 'updateGroup').mockResolvedValue(group);
    const remove = vi.spyOn(api, 'deleteGroup').mockResolvedValue(undefined);
    renderPage(<GroupsPage />);

    await user.click(await screen.findByRole('button', { name: 'Bewerk Woonkamer' }));
    await user.click(screen.getByRole('button', { name: 'Groep opslaan' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(group.id, expect.objectContaining({ name: 'Woonkamer' }));
    });

    await user.click(screen.getByRole('button', { name: 'Verwijder Woonkamer' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith(group.id);
    });
  });

  it('shows per-light failures returned by a group command', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'setGroupState').mockResolvedValue({
      group,
      lights: [],
      failed: [{ lightId: light.id, code: 'unsupported_capability', message: 'Kent geen kleur' }],
    });
    renderPage(<GroupsPage />);

    await user.click(await screen.findByRole('switch', { name: 'Woonkamer aan of uit' }));

    expect(await screen.findByText('Bank: Kent geen kleur')).toBeInTheDocument();
  });
});

describe('ScenesPage', () => {
  it('activates and deletes a scene', async () => {
    const user = userEvent.setup();
    const activate = vi.spyOn(api, 'activateScene').mockResolvedValue({ scene, appliedSteps: 1, failed: [] });
    const remove = vi.spyOn(api, 'deleteScene').mockResolvedValue(undefined);
    renderPage(<ScenesPage />);

    await user.click(await screen.findByRole('button', { name: 'Activeer Filmavond' }));
    await waitFor(() => {
      expect(activate).toHaveBeenCalledWith(scene.id);
    });

    await user.click(screen.getByRole('button', { name: 'Verwijder Filmavond' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith(scene.id);
    });
  });

  it('captures a new scene from the current state', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(api, 'createScene').mockResolvedValue(scene);
    renderPage(<ScenesPage />);

    await user.click(await screen.findByRole('button', { name: 'Nieuwe scène' }));
    await user.type(screen.getByLabelText(/^naam$/i), 'Ochtend');
    await user.click(await screen.findByRole('checkbox', { name: 'Bank' }));
    await user.click(screen.getByRole('button', { name: 'Scène opslaan' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ochtend',
          steps: [{ targetType: 'light', targetId: light.id, command: { power: 'off' } }],
        }),
      );
    });
  });
});

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'bridges').mockResolvedValue([]);
    vi.spyOn(api, 'health').mockResolvedValue({
      status: 'ok',
      version: '0.1.0',
      uptimeSeconds: 60,
      hub: { reachable: true, url: 'http://milight.local', version: null, checkedAt: null },
    });
  });

  it('adds a light through the wizard', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(api, 'createLight').mockResolvedValue(light);
    renderPage(<SettingsPage />);

    await user.type(screen.getByLabelText(/^naam$/i), 'Eettafel');
    await user.type(screen.getByLabelText(/apparaat-id/i), '0x00a1');
    await user.click(screen.getByRole('button', { name: 'Lamp toevoegen' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Eettafel', deviceId: '0x00a1', groupId: 1 }),
      );
    });
  });

  it('pairs a light and shows the hub and bridge sections', async () => {
    const user = userEvent.setup();
    const pair = vi.spyOn(api, 'pairLight').mockResolvedValue(undefined);
    renderPage(<SettingsPage />);

    expect(await screen.findByText('Bereikbaar')).toBeInTheDocument();
    expect(await screen.findByText(/geen bruggen/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Koppelen' }));
    await waitFor(() => {
      expect(pair).toHaveBeenCalledWith(light.id);
    });
  });
});
