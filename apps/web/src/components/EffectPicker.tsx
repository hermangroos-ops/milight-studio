import { useId, type ReactNode } from 'react';

import './EffectPicker.css';

export interface EffectPickerProps {
  value: number | null;
  count: number;
  onSelect: (effect: number | null) => void;
  onNext: () => void;
  disabled?: boolean;
}

const NONE_VALUE = 'none';

export function EffectPicker({
  value,
  count,
  onSelect,
  onNext,
  disabled = false,
}: EffectPickerProps): ReactNode {
  const selectId = useId();
  const options = Array.from({ length: count }, (_, index) => index);

  return (
    <div className="effect-picker">
      <label className="effect-picker__label" htmlFor={selectId}>
        Effect
      </label>
      <div className="effect-picker__row">
        <select
          id={selectId}
          className="effect-picker__select"
          value={value === null ? NONE_VALUE : String(value)}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            onSelect(raw === NONE_VALUE ? null : Number(raw));
          }}
        >
          <option value={NONE_VALUE}>Geen effect</option>
          {options.map((index) => (
            <option key={index} value={index}>
              {`Modus ${index + 1}`}
            </option>
          ))}
        </select>
        <button type="button" className="button button--small" onClick={onNext} disabled={disabled}>
          Volgende
        </button>
      </div>
    </div>
  );
}
