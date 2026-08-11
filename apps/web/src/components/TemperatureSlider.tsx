import { kelvinToRgb, MAX_KELVIN, MIN_KELVIN, rgbToHex } from '@milight-studio/shared';
import type { ReactNode } from 'react';

import { RangeField } from './RangeField.js';

export interface TemperatureSliderProps {
  value: number;
  onChange: (kelvin: number) => void;
  disabled?: boolean;
  label?: string;
  throttleMs?: number;
}

const STOP_COUNT = 6;

/** Warm-to-cool gradient sampled from `kelvinToRgb` so the track matches reality. */
export function temperatureGradient(): string {
  const stops: string[] = [];
  for (let index = 0; index < STOP_COUNT; index += 1) {
    const ratio = index / (STOP_COUNT - 1);
    const kelvin = MIN_KELVIN + ratio * (MAX_KELVIN - MIN_KELVIN);
    stops.push(`${rgbToHex(kelvinToRgb(kelvin))} ${Math.round(ratio * 100)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function TemperatureSlider({
  value,
  onChange,
  disabled = false,
  label = 'Kleurtemperatuur',
  throttleMs,
}: TemperatureSliderProps): ReactNode {
  return (
    <RangeField
      label={label}
      value={value}
      min={MIN_KELVIN}
      max={MAX_KELVIN}
      step={50}
      disabled={disabled}
      trackBackground={temperatureGradient()}
      formatValue={(current) => `${current} K`}
      onChange={onChange}
      {...(throttleMs === undefined ? {} : { throttleMs })}
    />
  );
}
