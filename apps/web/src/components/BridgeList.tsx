import type { BridgeStatus } from '@milight-studio/shared';
import type { ReactNode } from 'react';

import { Badge } from './Badge.js';

import './StatusPanel.css';

export interface BridgeListProps {
  bridges: readonly BridgeStatus[];
}

export function BridgeList({ bridges }: BridgeListProps): ReactNode {
  if (bridges.length === 0) {
    return <p className="status-panel">Er zijn geen bruggen geconfigureerd.</p>;
  }

  return (
    <dl className="status-panel">
      {bridges.map((bridge) => (
        <div className="status-panel__row" key={bridge.name}>
          <dt>{bridge.name}</dt>
          <dd>
            {bridge.enabled ? (
              <Badge tone={bridge.running ? 'success' : 'warning'}>
                {bridge.running ? 'Actief' : 'Gestopt'}
              </Badge>
            ) : (
              <Badge tone="neutral">Uitgeschakeld</Badge>
            )}
            {bridge.detail === null ? null : <span className="bridge-detail"> {bridge.detail}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
