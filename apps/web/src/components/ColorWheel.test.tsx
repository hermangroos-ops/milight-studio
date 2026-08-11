import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ColorWheel, describeColor, markerPosition, pointToHsv } from './ColorWheel.js';

function renderWheel(hue = 100, saturation = 50): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  render(<ColorWheel hue={hue} saturation={saturation} onChange={onChange} />);
  return { onChange };
}

describe('ColorWheel accessibility', () => {
  it('exposes slider semantics', () => {
    renderWheel(210, 80);
    const wheel = screen.getByRole('slider', { name: 'Kleurenwiel' });

    expect(wheel).toHaveAttribute('aria-valuenow', '210');
    expect(wheel).toHaveAttribute('aria-valuemin', '0');
    expect(wheel).toHaveAttribute('aria-valuemax', '359');
    expect(wheel).toHaveAttribute('aria-valuetext', 'Tint 210 graden, verzadiging 80 procent');
    expect(wheel).toHaveAttribute('tabindex', '0');
  });

  it('is reachable by keyboard', async () => {
    const user = userEvent.setup();
    renderWheel();

    await user.tab();

    expect(screen.getByRole('slider', { name: 'Kleurenwiel' })).toHaveFocus();
  });
});

describe('ColorWheel keyboard interaction', () => {
  it('changes hue with left and right arrows', () => {
    const { onChange } = renderWheel(100, 50);
    const wheel = screen.getByRole('slider', { name: 'Kleurenwiel' });

    fireEvent.keyDown(wheel, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 105, saturation: 50 });

    fireEvent.keyDown(wheel, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 95, saturation: 50 });
  });

  it('changes saturation with up and down arrows', () => {
    const { onChange } = renderWheel(100, 50);
    const wheel = screen.getByRole('slider', { name: 'Kleurenwiel' });

    fireEvent.keyDown(wheel, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 100, saturation: 55 });

    fireEvent.keyDown(wheel, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 100, saturation: 45 });
  });

  it('supports page and home/end shortcuts and wraps the hue', () => {
    const { onChange } = renderWheel(350, 50);
    const wheel = screen.getByRole('slider', { name: 'Kleurenwiel' });

    fireEvent.keyDown(wheel, { key: 'PageUp' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 20, saturation: 50 });

    fireEvent.keyDown(wheel, { key: 'PageDown' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 320, saturation: 50 });

    fireEvent.keyDown(wheel, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 350, saturation: 0 });

    fireEvent.keyDown(wheel, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith({ hue: 350, saturation: 100 });
  });

  it('ignores other keys and does nothing when disabled', () => {
    const onChange = vi.fn();
    const view = render(<ColorWheel hue={0} saturation={0} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Kleurenwiel' }), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();

    view.rerender(<ColorWheel hue={0} saturation={0} onChange={onChange} disabled />);
    const wheel = screen.getByRole('slider', { name: 'Kleurenwiel' });
    fireEvent.keyDown(wheel, { key: 'ArrowRight' });

    expect(onChange).not.toHaveBeenCalled();
    expect(wheel).toHaveAttribute('tabindex', '-1');
  });
});

describe('ColorWheel pointer geometry', () => {
  it('maps points back to hue and saturation', () => {
    const rect = { width: 200, height: 200 };

    expect(pointToHsv(100, 0, rect)).toEqual({ hue: 0, saturation: 100 });
    expect(pointToHsv(200, 100, rect)).toEqual({ hue: 90, saturation: 100 });
    expect(pointToHsv(100, 100, rect)).toEqual({ hue: 90, saturation: 0 });
    expect(pointToHsv(0, 0, { width: 0, height: 0 })).toEqual({ hue: 90, saturation: 0 });
  });

  it('places the marker at the centre for zero saturation', () => {
    expect(markerPosition(0, 0)).toEqual({ x: 50, y: 50 });
    expect(markerPosition(90, 100).x).toBeCloseTo(100, 5);
  });

  it('ignores pointer events when the element has no layout', () => {
    const { onChange } = renderWheel();
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Kleurenwiel' }), {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits hue and saturation while dragging across a laid-out wheel', () => {
    const { onChange } = renderWheel(0, 0);
    const wheel = screen.getByRole('slider', { name: 'Kleurenwiel' });
    vi.spyOn(wheel, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 200,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(wheel, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(wheel, { pointerId: 1 });
    fireEvent.pointerMove(wheel, { clientX: 100, clientY: 0, pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ hue: 90, saturation: 100 });
  });
});

describe('describeColor', () => {
  it('clamps and normalises before describing', () => {
    expect(describeColor(-10, 150)).toBe('Tint 350 graden, verzadiging 100 procent');
  });
});
