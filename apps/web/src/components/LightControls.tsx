import type { LightCommand, LightState } from '@milight-studio/shared';
import type { ReactNode } from 'react';

import type { CapabilitySet } from '../state/capabilities.js';

import { BrightnessSlider } from './BrightnessSlider.js';
import { ColorWheel } from './ColorWheel.js';
import { EffectPicker } from './EffectPicker.js';
import { TemperatureSlider } from './TemperatureSlider.js';

import './LightControls.css';

export interface LightControlsProps {
  capabilities: CapabilitySet;
  state: LightState;
  onCommand: (command: LightCommand) => void;
  disabled?: boolean;
  /** Distinguishes the controls of several cards on the same screen. */
  nameSuffix?: string;
}

/**
 * Renders only the controls the light's protocol actually supports. Anything a
 * remote type cannot do is never shown, rather than shown and rejected.
 */
export function LightControls({
  capabilities,
  state,
  onCommand,
  disabled = false,
  nameSuffix = '',
}: LightControlsProps): ReactNode {
  const suffix = nameSuffix ? ` — ${nameSuffix}` : '';

  return (
    <div className="light-controls">
      {capabilities.has('brightness') && capabilities.brightnessMode === 'absolute' ? (
        <BrightnessSlider
          value={state.brightness}
          hue={state.hue}
          saturation={state.colorMode === 'color' ? state.saturation : 0}
          disabled={disabled}
          label={`Helderheid${suffix}`}
          onChange={(brightness) => {
            onCommand({ brightness });
          }}
        />
      ) : null}

      {capabilities.has('brightness') && capabilities.brightnessMode === 'relative' ? (
        <div className="light-controls__steps">
          <span className="light-controls__steps-label">{`Helderheid${suffix}`}</span>
          <button
            type="button"
            className="button button--small"
            disabled={disabled}
            onClick={() => {
              onCommand({ brightnessStep: -10 });
            }}
          >
            Dimmen
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={disabled}
            onClick={() => {
              onCommand({ brightnessStep: 10 });
            }}
          >
            Feller
          </button>
        </div>
      ) : null}

      {capabilities.has('colorTemperature') ? (
        <TemperatureSlider
          value={state.colorTemperature}
          disabled={disabled}
          label={`Kleurtemperatuur${suffix}`}
          onChange={(colorTemperature) => {
            onCommand({ colorTemperature });
          }}
        />
      ) : null}

      {capabilities.has('color') ? (
        <ColorWheel
          hue={state.hue}
          saturation={state.saturation}
          disabled={disabled}
          label={`Kleurenwiel${suffix}`}
          onChange={({ hue, saturation }) => {
            onCommand({ hue, saturation });
          }}
        />
      ) : null}

      {capabilities.has('effects') && capabilities.effectCount > 0 ? (
        <EffectPicker
          value={state.effect}
          count={capabilities.effectCount}
          disabled={disabled}
          onSelect={(effect) => {
            onCommand(effect === null ? { whiteMode: true } : { effect });
          }}
          onNext={() => {
            onCommand({ effect: 'next' });
          }}
        />
      ) : null}

      <div className="light-controls__actions">
        {capabilities.has('whiteMode') ? (
          <button
            type="button"
            className="button button--small"
            disabled={disabled}
            onClick={() => {
              onCommand({ whiteMode: true });
            }}
          >
            Wit licht
          </button>
        ) : null}
        {capabilities.has('nightMode') ? (
          <button
            type="button"
            className="button button--small"
            disabled={disabled}
            onClick={() => {
              onCommand({ nightMode: true });
            }}
          >
            Nachtmodus
          </button>
        ) : null}
      </div>
    </div>
  );
}
