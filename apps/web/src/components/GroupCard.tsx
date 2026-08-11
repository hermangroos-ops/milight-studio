import type { Group, LightCommand, LightWithState } from '@milight-studio/shared';
import { useState, type ReactNode } from 'react';

import type { CommandFailure } from '../api/endpoints.js';
import { capabilitiesOfAll } from '../state/capabilities.js';

import { Badge } from './Badge.js';
import { LightControls } from './LightControls.js';
import { Toggle } from './Toggle.js';

import './GroupCard.css';

export interface GroupCardProps {
  group: Group;
  members: readonly LightWithState[];
  failures?: readonly CommandFailure[];
  busy?: boolean;
  onCommand: (command: LightCommand) => void;
  onEdit: (group: Group) => void;
  onDelete: (group: Group) => void;
}

/** Representative state for the whole group: the first member that is on, else the first. */
function representativeState(members: readonly LightWithState[]): LightWithState | undefined {
  return members.find((light) => light.state.power === 'on') ?? members[0];
}

export function GroupCard({
  group,
  members,
  failures = [],
  busy = false,
  onCommand,
  onEdit,
  onDelete,
}: GroupCardProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const capabilities = capabilitiesOfAll(members.map((light) => light.remoteType));
  const representative = representativeState(members);
  const anyOn = members.some((light) => light.state.power === 'on');
  const unreachable = members.filter((light) => !light.state.reachable).length;
  const failureNames = new Map(members.map((light) => [light.id, light.name]));

  return (
    <article className="group-card card" aria-label={group.name}>
      <div className="group-card__header">
        <div>
          <h3 className="group-card__name">{group.name}</h3>
          <p className="group-card__meta">
            {group.room ?? 'Geen kamer'} · {members.length} lampen
          </p>
          <div className="group-card__badges">
            {unreachable > 0 ? <Badge tone="danger">{`${unreachable} onbereikbaar`}</Badge> : null}
            {group.exposeToVoice ? <Badge tone="neutral">Spraak</Badge> : null}
          </div>
        </div>
        <Toggle
          checked={anyOn}
          disabled={busy || members.length === 0}
          label={`${group.name} aan of uit`}
          hideLabel
          onChange={(checked) => {
            onCommand({ power: checked ? 'on' : 'off' });
          }}
        />
      </div>

      {failures.length > 0 ? (
        <ul className="group-card__failures" aria-label={`Mislukte opdrachten in ${group.name}`}>
          {failures.map((failure) => (
            <li key={`${failure.lightId}-${failure.code}`}>
              {`${failureNames.get(failure.lightId) ?? failure.lightId}: ${failure.message}`}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="group-card__actions">
        <button
          type="button"
          className="button button--small"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? `Verberg bediening van ${group.name}` : `Toon bediening van ${group.name}`}
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            onEdit(group);
          }}
        >
          {`Bewerk ${group.name}`}
        </button>
        <button
          type="button"
          className="button button--small button--danger"
          onClick={() => {
            onDelete(group);
          }}
        >
          {`Verwijder ${group.name}`}
        </button>
      </div>

      {expanded && representative ? (
        <LightControls
          capabilities={capabilities}
          state={representative.state}
          onCommand={onCommand}
          disabled={busy}
          nameSuffix={group.name}
        />
      ) : null}
      {expanded && !representative ? (
        <p className="group-card__empty">Voeg eerst lampen toe aan deze groep.</p>
      ) : null}
    </article>
  );
}
