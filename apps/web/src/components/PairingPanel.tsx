import type { LightWithState } from '@milight-studio/shared';
import { useId, useState, type ReactNode } from 'react';

import './PairingPanel.css';

export interface PairingPanelProps {
  lights: readonly LightWithState[];
  busy?: boolean;
  onPair: (lightId: string, pair: boolean) => void;
}

/**
 * Pairing only works in the few seconds after a bulb is powered on, so the
 * instruction to power-cycle first is part of the control, not a footnote.
 */
export function PairingPanel({ lights, busy = false, onPair }: PairingPanelProps): ReactNode {
  const selectId = useId();
  const [selected, setSelected] = useState('');
  const target = selected === '' ? lights[0]?.id : selected;

  return (
    <div className="pairing-panel">
      <p className="pairing-panel__hint">
        Koppelen lukt alleen binnen enkele seconden nadat de lamp stroom krijgt. Zet de lamp eerst uit en weer
        aan, druk daarna direct op Koppelen.
      </p>

      <div className="field">
        <label className="field__label" htmlFor={selectId}>
          Lamp
        </label>
        <select
          id={selectId}
          value={target ?? ''}
          disabled={lights.length === 0}
          onChange={(event) => {
            setSelected(event.target.value);
          }}
        >
          {lights.length === 0 ? <option value="">Geen lampen beschikbaar</option> : null}
          {lights.map((light) => (
            <option key={light.id} value={light.id}>
              {`${light.name} (${light.deviceId}, groep ${light.groupId})`}
            </option>
          ))}
        </select>
      </div>

      <div className="pairing-panel__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || target === undefined}
          onClick={() => {
            if (target !== undefined) onPair(target, true);
          }}
        >
          Koppelen
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy || target === undefined}
          onClick={() => {
            if (target !== undefined) onPair(target, false);
          }}
        >
          Ontkoppelen
        </button>
      </div>
    </div>
  );
}
