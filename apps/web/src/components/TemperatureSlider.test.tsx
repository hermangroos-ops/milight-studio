import { MAX_KELVIN, MIN_KELVIN } from '@milight-studio/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemperatureSlider, temperatureGradient } from './TemperatureSlider.js';

describe('TemperatureSlider', () => {
  it('spans the supported kelvin range and announces the value', () => {
    render(<TemperatureSlider value={4000} onChange={vi.fn()} />);

    const slider = screen.getByLabelText('Kleurtemperatuur');
    expect(slider).toHaveAttribute('min', String(MIN_KELVIN));
    expect(slider).toHaveAttribute('max', String(MAX_KELVIN));
    expect(slider).toHaveAttribute('aria-valuetext', '4000 K');
  });

  it('emits the new kelvin value', () => {
    const onChange = vi.fn();
    render(<TemperatureSlider value={4000} onChange={onChange} throttleMs={0} />);

    fireEvent.change(screen.getByLabelText('Kleurtemperatuur'), { target: { value: '5000' } });

    expect(onChange).toHaveBeenCalledWith(5000);
  });

  it('builds a warm-to-cool gradient from kelvinToRgb', () => {
    const gradient = temperatureGradient();

    expect(gradient.startsWith('linear-gradient(to right, #ff')).toBe(true);
    expect(gradient).toContain('100%');
    expect(gradient.split(',').length).toBeGreaterThan(5);
  });
});
