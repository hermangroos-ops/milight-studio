import { describe, expect, it } from 'vitest';

import {
  MAX_KELVIN,
  MAX_MIRED,
  MIN_KELVIN,
  MIN_MIRED,
  byteToPercent,
  clamp,
  hexToRgb,
  hsvToRgb,
  hubPercentageToKelvin,
  kelvinToHubPercentage,
  kelvinToMired,
  kelvinToRgb,
  miredToKelvin,
  normaliseHue,
  percentToByte,
  rgbToHex,
  rgbToHsv,
  type Rgb,
} from './color.js';

describe('clamp', () => {
  it.each([
    { value: 5, min: 0, max: 10, expected: 5 },
    { value: -1, min: 0, max: 10, expected: 0 },
    { value: 11, min: 0, max: 10, expected: 10 },
    { value: 0, min: 0, max: 0, expected: 0 },
    { value: -Infinity, min: 0, max: 10, expected: 0 },
    { value: Infinity, min: 0, max: 10, expected: 10 },
  ])('clamps $value into [$min, $max]', ({ value, min, max, expected }) => {
    expect(clamp(value, min, max)).toBe(expected);
  });

  it('maps NaN onto the lower bound rather than propagating it', () => {
    expect(clamp(Number.NaN, 3, 9)).toBe(3);
    expect(Number.isNaN(clamp(Number.NaN, 3, 9))).toBe(false);
  });
});

describe('normaliseHue', () => {
  it.each([
    { input: 0, expected: 0 },
    { input: 359, expected: 359 },
    { input: 360, expected: 0 },
    { input: 361, expected: 1 },
    { input: 720, expected: 0 },
    { input: 400, expected: 40 },
    { input: -1, expected: 359 },
    { input: -30, expected: 330 },
    { input: -400, expected: 320 },
    { input: 120.4, expected: 120 },
  ])('normalises $input to $expected', ({ input, expected }) => {
    expect(normaliseHue(input)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns 0 for the non-finite value %p',
    (value) => {
      expect(normaliseHue(value)).toBe(0);
    },
  );

  // -360 % 360 is -0, which is not < 0, so the sign survives the wrap. Harmless for
  // JSON and arithmetic, but worth pinning down so a refactor cannot change it silently.
  it('returns negative zero for exact negative multiples of 360', () => {
    expect(normaliseHue(-360) + 0).toBe(0);
    expect(normaliseHue(-720) + 0).toBe(0);
  });
});

describe('kelvin and mired conversion', () => {
  it('clamps kelvin at both bounds before converting', () => {
    expect(kelvinToMired(0)).toBe(kelvinToMired(MIN_KELVIN));
    expect(kelvinToMired(1_000_000)).toBe(kelvinToMired(MAX_KELVIN));
    expect(kelvinToMired(MIN_KELVIN)).toBe(MAX_MIRED);
  });

  it('never leaves the mired range the hub accepts', () => {
    for (let kelvin = MIN_KELVIN; kelvin <= MAX_KELVIN; kelvin += 50) {
      const mired = kelvinToMired(kelvin);
      expect(mired).toBeGreaterThanOrEqual(MIN_MIRED);
      expect(mired).toBeLessThanOrEqual(MAX_MIRED);
    }
  });

  it('clamps mired at both bounds before converting', () => {
    expect(miredToKelvin(0)).toBe(MAX_KELVIN);
    expect(miredToKelvin(MIN_MIRED - 1)).toBe(MAX_KELVIN);
    expect(miredToKelvin(10_000)).toBe(miredToKelvin(MAX_MIRED));
    expect(miredToKelvin(MAX_MIRED)).toBeGreaterThanOrEqual(MIN_KELVIN);
  });

  it('round trips kelvin to mired and back within rounding error', () => {
    for (let kelvin = MIN_KELVIN; kelvin <= MAX_KELVIN; kelvin += 100) {
      const roundTripped = miredToKelvin(kelvinToMired(kelvin));
      expect(Math.abs(roundTripped - kelvin)).toBeLessThanOrEqual(45);
    }
  });

  it('is monotonically decreasing: warmer kelvin means a higher mired value', () => {
    expect(kelvinToMired(2700)).toBeGreaterThan(kelvinToMired(4000));
    expect(kelvinToMired(4000)).toBeGreaterThan(kelvinToMired(6500));
  });
});

describe('hub kelvin percentage', () => {
  it.each([
    { kelvin: MIN_KELVIN, percentage: 0 },
    { kelvin: MAX_KELVIN, percentage: 100 },
    { kelvin: 4600, percentage: 50 },
  ])('maps $kelvin K onto $percentage %', ({ kelvin, percentage }) => {
    expect(kelvinToHubPercentage(kelvin)).toBe(percentage);
    expect(hubPercentageToKelvin(percentage)).toBe(kelvin);
  });

  it('clamps out-of-range input at both ends', () => {
    expect(kelvinToHubPercentage(1000)).toBe(0);
    expect(kelvinToHubPercentage(99_999)).toBe(100);
    expect(hubPercentageToKelvin(-20)).toBe(MIN_KELVIN);
    expect(hubPercentageToKelvin(500)).toBe(MAX_KELVIN);
  });

  it('round trips every whole percentage', () => {
    for (let percentage = 0; percentage <= 100; percentage += 1) {
      expect(kelvinToHubPercentage(hubPercentageToKelvin(percentage))).toBe(percentage);
    }
  });
});

describe('hsvToRgb / rgbToHsv', () => {
  const sextants: { name: string; hue: number; rgb: Rgb }[] = [
    { name: 'red', hue: 0, rgb: { r: 255, g: 0, b: 0 } },
    { name: 'yellow', hue: 60, rgb: { r: 255, g: 255, b: 0 } },
    { name: 'green', hue: 120, rgb: { r: 0, g: 255, b: 0 } },
    { name: 'cyan', hue: 180, rgb: { r: 0, g: 255, b: 255 } },
    { name: 'blue', hue: 240, rgb: { r: 0, g: 0, b: 255 } },
    { name: 'magenta', hue: 300, rgb: { r: 255, g: 0, b: 255 } },
  ];

  it.each(sextants)('converts fully saturated $name both ways', ({ hue, rgb }) => {
    expect(hsvToRgb({ hue, saturation: 100, value: 100 })).toEqual(rgb);
    expect(rgbToHsv(rgb)).toEqual({ hue, saturation: 100, value: 100 });
  });

  it.each([15, 45, 75, 135, 195, 255, 315, 345])('round trips the mid-sextant hue %i', (hue) => {
    const back = rgbToHsv(hsvToRgb({ hue, saturation: 100, value: 100 }));
    expect(Math.abs(back.hue - hue)).toBeLessThanOrEqual(1);
    expect(back.saturation).toBe(100);
    expect(back.value).toBe(100);
  });

  it.each([0, 25, 50, 75, 100])('treats a grey of value %i as unsaturated', (value) => {
    const rgb = hsvToRgb({ hue: 210, saturation: 0, value });
    expect(rgb.r).toBe(rgb.g);
    expect(rgb.g).toBe(rgb.b);

    const hsv = rgbToHsv(rgb);
    expect(hsv.saturation).toBe(0);
    expect(hsv.hue).toBe(0);
    expect(Math.abs(hsv.value - value)).toBeLessThanOrEqual(1);
  });

  it('clamps out-of-range saturation and value', () => {
    expect(hsvToRgb({ hue: 0, saturation: 400, value: 400 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ hue: 0, saturation: -10, value: -10 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('wraps an out-of-range hue before converting', () => {
    expect(hsvToRgb({ hue: 480, saturation: 100, value: 100 })).toEqual(
      hsvToRgb({ hue: 120, saturation: 100, value: 100 }),
    );
  });

  it('reports black as fully unsaturated with zero value', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ hue: 0, saturation: 0, value: 0 });
  });

  it('clamps out-of-range rgb channels', () => {
    expect(rgbToHsv({ r: 999, g: -20, b: -20 })).toEqual({ hue: 0, saturation: 100, value: 100 });
  });
});

describe('hexToRgb', () => {
  it.each([
    { hex: '#ffffff', expected: { r: 255, g: 255, b: 255 } },
    { hex: 'ffffff', expected: { r: 255, g: 255, b: 255 } },
    { hex: '#000000', expected: { r: 0, g: 0, b: 0 } },
    { hex: '#fff', expected: { r: 255, g: 255, b: 255 } },
    { hex: 'fff', expected: { r: 255, g: 255, b: 255 } },
    { hex: '#f00', expected: { r: 255, g: 0, b: 0 } },
    { hex: '#FF8800', expected: { r: 255, g: 136, b: 0 } },
    { hex: '  #ff8800  ', expected: { r: 255, g: 136, b: 0 } },
    { hex: '#AbCdEf', expected: { r: 171, g: 205, b: 239 } },
  ])('parses $hex', ({ hex, expected }) => {
    expect(hexToRgb(hex)).toEqual(expected);
  });

  it.each(['', '#', '#ff', '#ffff', '#fffff', '#fffffff', 'ggg', '#ggg', 'rebeccapurple', '# fff'])(
    'rejects %p',
    (hex) => {
      expect(hexToRgb(hex)).toBeNull();
    },
  );

  it('round trips through rgbToHex', () => {
    for (const hex of ['#000000', '#010203', '#ff8800', '#ffffff']) {
      expect(rgbToHex(hexToRgb(hex)!)).toBe(hex);
    }
  });
});

describe('rgbToHex', () => {
  it.each([
    { rgb: { r: 0, g: 0, b: 0 }, expected: '#000000' },
    { rgb: { r: 1, g: 2, b: 3 }, expected: '#010203' },
    { rgb: { r: 255, g: 255, b: 255 }, expected: '#ffffff' },
    { rgb: { r: 15, g: 16, b: 17 }, expected: '#0f1011' },
  ])('pads every channel to two digits for $expected', ({ rgb, expected }) => {
    expect(rgbToHex(rgb)).toBe(expected);
  });

  it('clamps and rounds out-of-range channels', () => {
    expect(rgbToHex({ r: -50, g: 300, b: 127.6 })).toBe('#00ff80');
  });
});

describe('kelvinToRgb', () => {
  it('renders warm temperatures redder and cool ones bluer', () => {
    const warm = kelvinToRgb(2000);
    const cool = kelvinToRgb(9000);
    expect(warm.r).toBeGreaterThanOrEqual(cool.r);
    expect(warm.b).toBeLessThan(cool.b);
  });

  it('is monotonic-ish: red never rises and blue never falls as kelvin rises', () => {
    let previous = kelvinToRgb(1000);
    for (let kelvin = 1500; kelvin <= 12_000; kelvin += 500) {
      const current = kelvinToRgb(kelvin);
      expect(current.r).toBeLessThanOrEqual(previous.r);
      expect(current.b).toBeGreaterThanOrEqual(previous.b);
      previous = current;
    }
  });

  it('keeps every channel inside the 0–255 byte range', () => {
    for (const kelvin of [0, 500, 1000, 1900, 2000, 6600, 40_000, 100_000]) {
      const rgb = kelvinToRgb(kelvin);
      for (const channel of [rgb.r, rgb.g, rgb.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('saturates to white-ish above 6600 K', () => {
    const hot = kelvinToRgb(6600);
    expect(hot.r).toBe(255);
    expect(hot.b).toBe(255);
  });

  it('has no blue at all below 1900 K', () => {
    expect(kelvinToRgb(1500).b).toBe(0);
  });
});

describe('percentToByte / byteToPercent', () => {
  it.each([
    { percent: 0, byte: 0 },
    { percent: 50, byte: 127 },
    { percent: 100, byte: 254 },
  ])('maps $percent % onto $byte', ({ percent, byte }) => {
    expect(percentToByte(percent)).toBe(byte);
  });

  it.each([
    { byte: 0, percent: 0 },
    { byte: 127, percent: 50 },
    { byte: 254, percent: 100 },
  ])('maps $byte back onto $percent %', ({ byte, percent }) => {
    expect(byteToPercent(byte)).toBe(percent);
  });

  it('clamps out-of-range input on both sides', () => {
    expect(percentToByte(-5)).toBe(0);
    expect(percentToByte(150)).toBe(254);
    expect(byteToPercent(-5)).toBe(0);
    expect(byteToPercent(500)).toBe(100);
  });

  it('round trips every whole percentage', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(byteToPercent(percentToByte(percent))).toBe(percent);
    }
  });
});
