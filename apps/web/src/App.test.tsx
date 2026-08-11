import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api/endpoints.js';
import { App } from './App.js';
import { makeGroup, makeLight, makeQueryClient, makeScene, makeState } from './test-utils/index.js';

const light = makeLight({ name: 'Bank', remoteType: 'rgb_cct', state: makeState({ power: 'on' }) });
const group = makeGroup({ name: 'Woonkamer', lightIds: [light.id] });
const scene = makeScene({ name: 'Filmavond' });

beforeEach(() => {
  window.location.hash = '';
  vi.spyOn(api, 'listLights').mockResolvedValue([light]);
  vi.spyOn(api, 'listGroups').mockResolvedValue([group]);
  vi.spyOn(api, 'listScenes').mockResolvedValue([scene]);
  vi.spyOn(api, 'bridges').mockResolvedValue([{ name: 'alexa', enabled: true, running: true, detail: null }]);
  vi.spyOn(api, 'health').mockResolvedValue({
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: 120,
    hub: { reachable: true, url: 'http://milight.local', version: '1.11.0', checkedAt: null },
  });
  vi.stubGlobal('WebSocket', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderApp(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('shows the lights screen first', async () => {
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Milight Studio' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Bank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lampen' })).toHaveAttribute('aria-current', 'page');
  });

  it('navigates between every screen', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Groepen' }));
    expect(await screen.findByRole('heading', { name: 'Woonkamer' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Scènes' }));
    expect(await screen.findByRole('heading', { name: 'Filmavond' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Instellingen' }));
    expect(await screen.findByRole('heading', { name: 'Hub' })).toBeInTheDocument();
    expect(await screen.findByText('Bereikbaar')).toBeInTheDocument();
    expect(await screen.findByText('Actief')).toBeInTheDocument();
  });

  it('warns when there is no live connection', async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Verbinden…')).toBeInTheDocument();
    });
  });
});
