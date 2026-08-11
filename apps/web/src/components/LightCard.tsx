import { REMOTE_TYPE_PROFILES, type LightCommand, type LightWithState } from '@milight-studio/shared';
import { useState, type ReactNode } from 'react';

import { capabilitiesOf } from '../state/capabilities.js';

import { Badge } from './Badge.js';
import { LightControls } from './LightControls.js';
import { Toggle } from './Toggle.js';

import './LightCard.css';

export interface LightCardProps {
  light: LightWithState;
  onCommand: (command: LightCommand) => void;
  onEdit?: (light: LightWithState) => void;
  busy?: boolean;
}

/**
 * Controls stay enabled while a command is in flight.
 *
 * Every mutation is optimistic, so there is nothing to protect against — and disabling
 * the element the user is currently operating blurs it, dropping focus to <body> and
 * swallowing any key pressed during the round trip. `aria-busy` communicates the
 * pending state instead, which assistive tech announces without stealing focus.
 */
export function LightCard({ light, onCommand, onEdit, busy = false }: LightCardProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const capabilities = capabilitiesOf(light.remoteType);
  const profile = REMOTE_TYPE_PROFILES[light.remoteType];
  const isOn = light.state.power === 'on';
  const toggleOnly = capabilities.has('toggle') && !capabilities.has('power');

  return (
    <article className="light-card card" aria-label={light.name} aria-busy={busy}>
      <div className="light-card__header">
        <div className="light-card__identity">
          <h3 className="light-card__name">{light.name}</h3>
          <p className="light-card__meta">
            {light.room ?? 'Geen kamer'} · {profile.label}
          </p>
          <div className="light-card__badges">
            {light.state.reachable ? null : <Badge tone="danger">Onbereikbaar</Badge>}
            {light.state.nightMode ? <Badge tone="neutral">Nachtmodus</Badge> : null}
            {light.state.effect === null ? null : (
              <Badge tone="neutral">{`Modus ${light.state.effect + 1}`}</Badge>
            )}
          </div>
        </div>

        {toggleOnly ? (
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              onCommand({ power: 'toggle' });
            }}
          >
            {`Wisselen: ${light.name}`}
          </button>
        ) : (
          <Toggle
            checked={isOn}
            label={`${light.name} aan of uit`}
            hideLabel
            onChange={(checked) => {
              onCommand({ power: checked ? 'on' : 'off' });
            }}
          />
        )}
      </div>

      <div className="light-card__footer">
        <button
          type="button"
          className="button button--small"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? `Verberg instellingen van ${light.name}` : `Toon instellingen van ${light.name}`}
        </button>
        {onEdit ? (
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              onEdit(light);
            }}
          >
            {`Bewerk ${light.name}`}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <LightControls
          capabilities={capabilities}
          state={light.state}
          onCommand={onCommand}
          nameSuffix={light.name}
        />
      ) : null}
    </article>
  );
}
