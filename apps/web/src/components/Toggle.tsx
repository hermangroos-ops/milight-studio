import type { ReactNode } from 'react';

import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Hides the visible text but keeps it as the accessible name. */
  hideLabel?: boolean;
  disabled?: boolean;
}

/** Switch built on a real checkbox so it is announced and operated natively. */
export function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
  disabled = false,
}: ToggleProps): ReactNode {
  return (
    <label className={`toggle${disabled ? ' toggle--disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        className="toggle__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className={hideLabel ? 'visually-hidden' : 'toggle__label'}>{label}</span>
    </label>
  );
}
