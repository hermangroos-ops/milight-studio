/**
 * Generates the PWA icons without pulling in an image dependency.
 *
 * `public/icon.svg` is written as a segmented hue wheel (SVG has no conic gradient),
 * and the PNGs are rasterised by hand: raw RGBA scanlines, deflated with node:zlib
 * and wrapped in the minimal PNG chunk structure.
 *
 * Run with: node apps/web/scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BACKGROUND = { r: 0x12, g: 0x14, b: 0x1a };
/** Wheel radius as a fraction of the canvas, small enough to survive maskable cropping. */
const WHEEL_RADIUS = 0.31;
const SEGMENTS = 24;

function hsvToRgb(hue, saturation, value) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = value - chroma;
  const table = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = table[Math.min(5, Math.floor(h))];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

const toHex = ({ r, g, b }) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

function buildSvg(size) {
  const centre = size / 2;
  const radius = size * WHEEL_RADIUS;
  const slices = [];
  for (let i = 0; i < SEGMENTS; i += 1) {
    const from = (i / SEGMENTS) * 2 * Math.PI - Math.PI / 2;
    const to = ((i + 1.02) / SEGMENTS) * 2 * Math.PI - Math.PI / 2;
    const x1 = (centre + Math.cos(from) * radius).toFixed(2);
    const y1 = (centre + Math.sin(from) * radius).toFixed(2);
    const x2 = (centre + Math.cos(to) * radius).toFixed(2);
    const y2 = (centre + Math.sin(to) * radius).toFixed(2);
    const fill = toHex(hsvToRgb((i / SEGMENTS) * 360, 1, 1));
    slices.push(
      `<path d="M${centre} ${centre} L${x1} ${y1} A${radius} ${radius} 0 0 1 ${x2} ${y2} Z" fill="${fill}"/>`,
    );
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Milight Studio">`,
    `<rect width="${size}" height="${size}" rx="${(size * 0.22).toFixed(0)}" fill="${toHex(BACKGROUND)}"/>`,
    ...slices,
    `<circle cx="${centre}" cy="${centre}" r="${(radius * 0.42).toFixed(2)}" fill="${toHex(BACKGROUND)}"/>`,
    `<circle cx="${centre}" cy="${centre}" r="${(radius * 0.2).toFixed(2)}" fill="#ffffff"/>`,
    '</svg>',
  ].join('');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Anti-aliased coverage of a disc, sampled on a 2x2 grid per pixel. */
function coverage(x, y, centre, radius) {
  let hits = 0;
  for (const dx of [0.25, 0.75]) {
    for (const dy of [0.25, 0.75]) {
      const distance = Math.hypot(x + dx - centre, y + dy - centre);
      if (distance <= radius) hits += 1;
    }
  }
  return hits / 4;
}

function buildPng(size) {
  const centre = size / 2;
  const radius = size * WHEEL_RADIUS;
  const innerRadius = radius * 0.42;
  const dotRadius = radius * 0.2;
  const raw = Buffer.alloc((size * 4 + 1) * size);

  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const wheel = hsvToRgb(hue, 1, 1);
      let colour = BACKGROUND;
      const onWheel = coverage(x, y, centre, radius) - coverage(x, y, centre, innerRadius);
      if (onWheel > 0) {
        colour = {
          r: Math.round(BACKGROUND.r + (wheel.r - BACKGROUND.r) * onWheel),
          g: Math.round(BACKGROUND.g + (wheel.g - BACKGROUND.g) * onWheel),
          b: Math.round(BACKGROUND.b + (wheel.b - BACKGROUND.b) * onWheel),
        };
      }
      const dot = coverage(x, y, centre, dotRadius);
      if (dot > 0) {
        colour = {
          r: Math.round(colour.r + (255 - colour.r) * dot),
          g: Math.round(colour.g + (255 - colour.g) * dot),
          b: Math.round(colour.b + (255 - colour.b) * dot),
        };
      }
      raw[offset] = colour.r;
      raw[offset + 1] = colour.g;
      raw[offset + 2] = colour.b;
      raw[offset + 3] = 255;
      offset += 4;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon.svg'), `${buildSvg(512)}\n`);
writeFileSync(join(OUT_DIR, 'icon-192.png'), buildPng(192));
writeFileSync(join(OUT_DIR, 'icon-512.png'), buildPng(512));
process.stdout.write(`icons written to ${OUT_DIR}\n`);
