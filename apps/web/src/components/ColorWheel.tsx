import { clamp, hsvToRgb, normaliseHue, rgbToHex } from '@milight-studio/shared';
import { useCallback, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { useThrottledCallback } from '../hooks/useThrottledCallback.js';

import './ColorWheel.css';

export interface Hsl {
  hue: number;
  saturation: number;
}

export interface ColorWheelProps {
  hue: number;
  saturation: number;
  onChange: (value: Hsl) => void;
  disabled?: boolean;
  label?: string;
  size?: number;
  throttleMs?: number;
}

const SEGMENTS = 36;
const HUE_STEP = 5;
const HUE_PAGE_STEP = 30;
const SATURATION_STEP = 5;

/** Position of the marker in the unit square of the wheel, as percentages. */
export function markerPosition(hue: number, saturation: number): { x: number; y: number } {
  const radians = (normaliseHue(hue) - 90) * (Math.PI / 180);
  const radius = clamp(saturation, 0, 100) / 100 / 2;
  return { x: 50 + Math.cos(radians) * radius * 100, y: 50 + Math.sin(radians) * radius * 100 };
}

/** Inverse of `markerPosition`: turn a point inside the wheel back into hue/saturation. */
export function pointToHsv(x: number, y: number, rect: { width: number; height: number }): Hsl {
  const centreX = rect.width / 2;
  const centreY = rect.height / 2;
  const dx = x - centreX;
  const dy = y - centreY;
  const radius = Math.min(centreX, centreY);
  const distance = Math.hypot(dx, dy);
  const hue = normaliseHue((Math.atan2(dy, dx) * 180) / Math.PI + 90);
  const saturation = radius === 0 ? 0 : Math.round(clamp((distance / radius) * 100, 0, 100));
  return { hue, saturation };
}

function nextFromKey(key: string, current: Hsl): Hsl | null {
  switch (key) {
    case 'ArrowRight':
      return { ...current, hue: normaliseHue(current.hue + HUE_STEP) };
    case 'ArrowLeft':
      return { ...current, hue: normaliseHue(current.hue - HUE_STEP) };
    case 'ArrowUp':
      return { ...current, saturation: Math.round(clamp(current.saturation + SATURATION_STEP, 0, 100)) };
    case 'ArrowDown':
      return { ...current, saturation: Math.round(clamp(current.saturation - SATURATION_STEP, 0, 100)) };
    case 'PageUp':
      return { ...current, hue: normaliseHue(current.hue + HUE_PAGE_STEP) };
    case 'PageDown':
      return { ...current, hue: normaliseHue(current.hue - HUE_PAGE_STEP) };
    case 'Home':
      return { ...current, saturation: 0 };
    case 'End':
      return { ...current, saturation: 100 };
    default:
      return null;
  }
}

export function describeColor(hue: number, saturation: number): string {
  return `Tint ${normaliseHue(hue)} graden, verzadiging ${Math.round(clamp(saturation, 0, 100))} procent`;
}

const wheelSegments = Array.from({ length: SEGMENTS }, (_, index) => {
  const from = (index / SEGMENTS) * 360;
  const to = ((index + 1) / SEGMENTS) * 360;
  return `${rgbToHex(hsvToRgb({ hue: from, saturation: 100, value: 100 }))} ${from}deg ${to}deg`;
}).join(', ');

export function ColorWheel({
  hue,
  saturation,
  onChange,
  disabled = false,
  label = 'Kleurenwiel',
  size = 208,
  throttleMs,
}: ColorWheelProps): ReactNode {
  const wheelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const emitDrag = useThrottledCallback(onChange, throttleMs);
  const marker = markerPosition(hue, saturation);
  const swatch = rgbToHex(hsvToRgb({ hue, saturation, value: 100 }));

  const handlePointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const element = wheelRef.current;
      if (!element || disabled) return;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      emitDrag(pointToHsv(event.clientX - rect.left, event.clientY - rect.top, rect));
    },
    [disabled, emitDrag],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const next = nextFromKey(event.key, { hue, saturation });
      if (!next) return;
      event.preventDefault();
      onChange(next);
    },
    [disabled, hue, saturation, onChange],
  );

  return (
    <div className="color-wheel">
      <div
        ref={wheelRef}
        className="color-wheel__disc"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={normaliseHue(hue)}
        aria-valuetext={describeColor(hue, saturation)}
        aria-disabled={disabled}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundImage: `radial-gradient(circle at 50% 50%, #ffffff 0%, rgba(255,255,255,0) 70%), conic-gradient(from 90deg, ${wheelSegments})`,
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          draggingRef.current = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture is a nicety; ignore environments that reject it.
          }
          handlePointer(event);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) handlePointer(event);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <span
          className="color-wheel__marker"
          aria-hidden="true"
          style={{ left: `${marker.x}%`, top: `${marker.y}%`, background: swatch }}
        />
      </div>
      <p className="color-wheel__readout">{describeColor(hue, saturation)}</p>
    </div>
  );
}
