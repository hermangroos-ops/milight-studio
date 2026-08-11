import type { Health } from '@milight-studio/shared';
import type { ReactNode } from 'react';

import { Badge } from './Badge.js';

import './StatusPanel.css';

export interface HubStatusProps {
  health: Health | undefined;
  isPending: boolean;
  error: unknown;
}

function formatTimestamp(value: string | null): string {
  if (value === null) return 'nooit';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('nl-NL');
}

export function HubStatus({ health, isPending, error }: HubStatusProps): ReactNode {
  if (isPending) return <p className="status-panel">Hubstatus wordt opgehaald…</p>;
  if (error !== null && error !== undefined) {
    return (
      <p className="status-panel status-panel--error" role="alert">
        De hubstatus kon niet worden opgehaald.
      </p>
    );
  }
  if (!health) return null;

  return (
    <dl className="status-panel">
      <div className="status-panel__row">
        <dt>Server</dt>
        <dd>
          <Badge tone={health.status === 'ok' ? 'success' : 'warning'}>
            {health.status === 'ok' ? 'In orde' : 'Verminderd'}
          </Badge>{' '}
          versie {health.version}
        </dd>
      </div>
      <div className="status-panel__row">
        <dt>Hub</dt>
        <dd>
          <Badge tone={health.hub.reachable ? 'success' : 'danger'}>
            {health.hub.reachable ? 'Bereikbaar' : 'Onbereikbaar'}
          </Badge>{' '}
          {health.hub.url}
        </dd>
      </div>
      <div className="status-panel__row">
        <dt>Firmware</dt>
        <dd>{health.hub.version ?? 'onbekend'}</dd>
      </div>
      <div className="status-panel__row">
        <dt>Laatst gecontroleerd</dt>
        <dd>{formatTimestamp(health.hub.checkedAt)}</dd>
      </div>
      <div className="status-panel__row">
        <dt>Draaitijd</dt>
        <dd>{`${Math.floor(health.uptimeSeconds / 60)} minuten`}</dd>
      </div>
    </dl>
  );
}
