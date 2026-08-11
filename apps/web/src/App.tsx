import type { ReactNode } from 'react';

import { Badge } from './components/Badge.js';
import { ToastProvider } from './components/Toast.js';
import { useHashRoute, ROUTES, type Route } from './hooks/useHashRoute.js';
import { useServerEvents } from './hooks/useServerEvents.js';
import { GroupsPage } from './pages/GroupsPage.js';
import { LightsPage } from './pages/LightsPage.js';
import { ScenesPage } from './pages/ScenesPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

import './App.css';

const LABELS: Record<Route, string> = {
  lampen: 'Lampen',
  groepen: 'Groepen',
  scenes: 'Scènes',
  instellingen: 'Instellingen',
};

function RouteView({ route }: { route: Route }): ReactNode {
  switch (route) {
    case 'lampen':
      return <LightsPage />;
    case 'groepen':
      return <GroupsPage />;
    case 'scenes':
      return <ScenesPage />;
    case 'instellingen':
      return <SettingsPage />;
  }
}

export function AppShell(): ReactNode {
  const { route, navigate } = useHashRoute();
  const connection = useServerEvents();

  return (
    <div className="app">
      <a className="app__skip visually-hidden" href="#main">
        Naar hoofdinhoud
      </a>
      <header className="app__header">
        <h1 className="app__title">Milight Studio</h1>
        {connection === 'open' ? null : (
          <Badge tone={connection === 'connecting' ? 'warning' : 'danger'}>
            {connection === 'connecting' ? 'Verbinden…' : 'Geen live verbinding'}
          </Badge>
        )}
      </header>

      <main className="app__main" id="main">
        <RouteView route={route} />
      </main>

      <nav className="app__nav" aria-label="Hoofdnavigatie">
        {ROUTES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="app__nav-item"
            aria-current={route === candidate ? 'page' : undefined}
            onClick={() => {
              navigate(candidate);
            }}
          >
            {LABELS[candidate]}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function App(): ReactNode {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
