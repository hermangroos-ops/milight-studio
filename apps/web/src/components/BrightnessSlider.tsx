import { hsvToRgb, rgbToHex } from '@milight-studio/shared';
import type { ReactNode } from 'react';

import { RangeField } from './RangeField.js';

export interface BrightnessSliderProps {
  value: number;
  onChange: (brightness: number) => void;
  disabled?: boolean;
  label?: string;
  /** Colour the light is currently showing, used to tint the track. */
  hue?: number;
  saturation?: number;
  throttleMs?: number;
}

export function BrightnessSlider({
  value,
  onChange,
  disabled = false,
  label = 'Helderheid',
  hue = 0,
  saturation = 0,
  throttleMs,
}: BrightnessSliderProps): ReactNode {
  const bright = rgbToHex(hsvToRgb({ hue, saturation, value: 100 }));
  const track = `linear-gradient(to right, #0b0d12, ${bright})`;

  return (
    <RangeField
      label={label}
      value={value}
      min={0}
      max={100}
      disabled={disabled}
      trackBackground={track}
      formatValue={(current) => `${current}%`}
      onChange={onChange}
      {...(throttleMs === undefined ? {} : { throttleMs })}
    />
  );
}
