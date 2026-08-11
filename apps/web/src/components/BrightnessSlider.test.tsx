import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrightnessSlider } from './BrightnessSlider.js';

function drag(slider: HTMLElement, values: readonly number[]): void {
  for (const value of values) {
    fireEvent.change(slider, { target: { value: String(value) } });
  }
}

describe('BrightnessSlider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is labelled and reports its value as a percentage', () => {
    render(<BrightnessSlider value={42} onChange={vi.fn()} />);

    const slider = screen.getByLabelText('Helderheid');
    expect(slider).toHaveAttribute('aria-valuetext', '42%');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
  });

  it('throttles a rapid drag but always sends the final value', () => {
    const onChange = vi.fn();
    render(<BrightnessSlider value={0} onChange={onChange} throttleMs={120} />);
    const slider = screen.getByLabelText('Helderheid');

    drag(slider, [5, 10, 15, 20, 25, 30, 35, 40]);

    // Leading edge only: the rest collapses into one trailing call.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(5);

    vi.advanceTimersByTime(120);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(40);
    expect(onChange.mock.calls.length).toBeLessThan(8);
  });

  it('lets a slow drag through on every step', () => {
    const onChange = vi.fn();
    render(<BrightnessSlider value={0} onChange={onChange} throttleMs={120} />);
    const slider = screen.getByLabelText('Helderheid');

    drag(slider, [10]);
    vi.advanceTimersByTime(200);
    drag(slider, [20]);
    vi.advanceTimersByTime(200);
    drag(slider, [30]);
    vi.advanceTimersByTime(200);

    expect(onChange.mock.calls.flat()).toEqual([10, 20, 30]);
  });

  it('flushes a pending value when the component unmounts mid-drag', () => {
    const onChange = vi.fn();
    const view = render(<BrightnessSlider value={0} onChange={onChange} throttleMs={120} />);
    const slider = screen.getByLabelText('Helderheid');

    drag(slider, [10, 90]);
    view.unmount();

    expect(onChange).toHaveBeenLastCalledWith(90);
  });

  it('re-syncs when the value changes from outside', () => {
    const view = render(<BrightnessSlider value={10} onChange={vi.fn()} />);
    view.rerender(<BrightnessSlider value={80} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Helderheid')).toHaveValue('80');
  });

  it('can be disabled and relabelled', () => {
    render(<BrightnessSlider value={10} onChange={vi.fn()} disabled label="Helderheid — Bank" />);

    expect(screen.getByLabelText('Helderheid — Bank')).toBeDisabled();
  });
});
