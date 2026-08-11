/**
 * Colour maths shared by the API, the UI and the voice-assistant bridges.
 *
 * Everything in the domain model is stored in device-independent units
 * (hue 0–359°, saturation 0–100%, brightness 0–100%, colour temperature in kelvin).
 * Conversion to whatever a specific transport wants (mireds for the Milight hub,
 * 0–254 for Hue/Matter, 0–1 for Alexa) happens at the edge, never in the model.
 */

/** Coolest white a MiBoxer CCT bulb can produce. */
export const MAX_KELVIN = 6500;
/** Warmest white a MiBoxer CCT bulb can produce. */
export const MIN_KELVIN = 2700;

/** Mired bounds accepted by esp8266_milight_hub's `color_temp` field. */
export const MIN_MIRED = 153;
export const MAX_MIRED = 370;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  hue: number;
  saturation: number;
  value: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Wrap a hue into the 0–359 range, handling negative and >360 input.
 *
 * Rounding happens before the final wrap on purpose: 359.7° must come out as 0, not
 * 360, because 360 is out of range for `hueSchema` and would make persisted state
 * fail its own validation.
 */
export function normaliseHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  // The double modulo also turns -0 into 0, which keeps JSON output tidy.
  const positive = ((hue % 360) + 360) % 360;
  return Math.round(positive) % 360;
}

export function kelvinToMired(kelvin: number): number {
  const safe = clamp(kelvin, MIN_KELVIN, MAX_KELVIN);
  return clamp(Math.round(1_000_000 / safe), MIN_MIRED, MAX_MIRED);
}

export function miredToKelvin(mired: number): number {
  const safe = clamp(mired, MIN_MIRED, MAX_MIRED);
  return clamp(Math.round(1_000_000 / safe), MIN_KELVIN, MAX_KELVIN);
}

/**
 * The hub also accepts a 0–100 "kelvin" percentage where 0 is the warmest white
 * and 100 the coolest. Some firmware builds handle this more reliably than mireds.
 */
export function kelvinToHubPercentage(kelvin: number): number {
  const safe = clamp(kelvin, MIN_KELVIN, MAX_KELVIN);
  return Math.round(((safe - MIN_KELVIN) / (MAX_KELVIN - MIN_KELVIN)) * 100);
}

export function hubPercentageToKelvin(percentage: number): number {
  const safe = clamp(percentage, 0, 100);
  return Math.round(MIN_KELVIN + (safe / 100) * (MAX_KELVIN - MIN_KELVIN));
}

export function hsvToRgb({ hue, saturation, value }: Hsv): Rgb {
  const h = normaliseHue(hue) / 60;
  const s = clamp(saturation, 0, 100) / 100;
  const v = clamp(value, 0, 100) / 100;

  const chroma = v * s;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = v - chroma;

  let rgb: [number, number, number];
  if (h < 1) rgb = [chroma, x, 0];
  else if (h < 2) rgb = [x, chroma, 0];
  else if (h < 3) rgb = [0, chroma, x];
  else if (h < 4) rgb = [0, x, chroma];
  else if (h < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = clamp(r, 0, 255) / 255;
  const green = clamp(g, 0, 255) / 255;
  const blue = clamp(b, 0, 255) / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
  }

  return {
    hue: normaliseHue(hue),
    saturation: max === 0 ? 0 : Math.round((delta / max) * 100),
    value: Math.round(max * 100),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return null;

  let digits = match[1] ?? '';
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((c) => c + c)
      .join('');
  }

  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

/**
 * Approximate sRGB rendering of a black-body colour temperature.
 * Used purely to preview white tones in the UI — never sent to a bulb.
 * Based on Tanner Helland's widely used piecewise approximation.
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const temp = clamp(kelvin, 1000, 40_000) / 100;

  const red = temp <= 66 ? 255 : clamp(329.698_727_446 * Math.pow(temp - 60, -0.133_204_759_2), 0, 255);

  const green =
    temp <= 66
      ? clamp(99.470_802_586_1 * Math.log(temp) - 161.119_568_166_1, 0, 255)
      : clamp(288.122_169_528_3 * Math.pow(temp - 60, -0.075_514_849_2), 0, 255);

  const blue =
    temp >= 66
      ? 255
      : temp <= 19
        ? 0
        : clamp(138.517_731_223_1 * Math.log(temp - 10) - 305.044_792_730_7, 0, 255);

  return { r: Math.round(red), g: Math.round(green), b: Math.round(blue) };
}

/** 0–100 percent to the 0–254 scale used by the Hue and Matter light clusters. */
export function percentToByte(percent: number): number {
  return Math.round((clamp(percent, 0, 100) / 100) * 254);
}

export function byteToPercent(byte: number): number {
  return Math.round((clamp(byte, 0, 254) / 254) * 100);
}
