import { useEffect, useId, useState, type ReactNode } from 'react';

import { useThrottledCallback, DEFAULT_THROTTLE_MS } from '../hooks/useThrottledCallback.js';

import './RangeField.css';

export interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  /** CSS `background` for the track, e.g. a gradient preview. */
  trackBackground: string;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  throttleMs?: number;
}

/**
 * Shared plumbing for the brightness and temperature sliders: a labelled native
 * range input that renders instantly from local state while the outward
 * `onChange` is throttled so a drag does not flood the API.
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  trackBackground,
  formatValue,
  onChange,
  throttleMs = DEFAULT_THROTTLE_MS,
}: RangeFieldProps): ReactNode {
  const inputId = useId();
  const [localValue, setLocalValue] = useState(value);
  const emit = useThrottledCallback(onChange, throttleMs);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="range-field">
      <div className="range-field__header">
        <label className="range-field__label" htmlFor={inputId}>
          {label}
        </label>
        <output className="range-field__value" htmlFor={inputId}>
          {formatValue(localValue)}
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        className="range-field__input"
        min={min}
        max={max}
        step={step}
        value={localValue}
        disabled={disabled}
        style={{ background: trackBackground }}
        aria-valuetext={formatValue(localValue)}
        onChange={(event) => {
          const next = Number(event.target.value);
          setLocalValue(next);
          emit(next);
        }}
      />
    </div>
  );
}
