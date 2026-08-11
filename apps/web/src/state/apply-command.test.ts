import { describe, expect, it } from 'vitest';

import { makeState } from '../test-utils/index.js';

import { applyCommandLocally } from './apply-command.js';

describe('applyCommandLocally', () => {
  it('switches power on and off, and toggles', () => {
    const off = makeState({ power: 'off' });

    expect(applyCommandLocally(off, { power: 'on' }).power).toBe('on');
    expect(applyCommandLocally(off, { power: 'toggle' }).power).toBe('on');
    expect(applyCommandLocally(makeState({ power: 'on' }), { power: 'toggle' }).power).toBe('off');
    expect(applyCommandLocally(makeState({ power: 'on' }), { power: 'off' }).colorMode).toBe('off');
  });

  it('sets and steps brightness within bounds', () => {
    const state = makeState({ power: 'on', brightness: 50 });

    expect(applyCommandLocally(state, { brightness: 80 }).brightness).toBe(80);
    expect(applyCommandLocally(state, { brightness: 500 }).brightness).toBe(100);
    expect(applyCommandLocally(state, { brightnessStep: 20 }).brightness).toBe(70);
    expect(applyCommandLocally(state, { brightnessStep: -100 }).brightness).toBe(0);
  });

  it('applies hue and saturation and flips to colour mode', () => {
    const state = makeState({ power: 'on', colorMode: 'white' });
    const next = applyCommandLocally(state, { hue: 400, saturation: 120 });

    expect(next.hue).toBe(40);
    expect(next.saturation).toBe(100);
    expect(next.colorMode).toBe('color');
  });

  it('accepts a hex colour', () => {
    const next = applyCommandLocally(makeState({ power: 'on' }), { hex: '#00ff00' });

    expect(next.hue).toBe(120);
    expect(next.saturation).toBe(100);
    expect(next.colorMode).toBe('color');
  });

  it('ignores an unparseable hex colour', () => {
    const state = makeState({ power: 'on', hue: 10 });
    expect(applyCommandLocally(state, { hex: 'nonsense' }).hue).toBe(10);
  });

  it('applies colour temperature and white mode', () => {
    const state = makeState({ power: 'on', colorMode: 'color', saturation: 90 });

    expect(applyCommandLocally(state, { colorTemperature: 5000 }).colorTemperature).toBe(5000);
    expect(applyCommandLocally(state, { colorTemperature: 10_000 }).colorTemperature).toBe(6500);
    expect(applyCommandLocally(state, { colorTemperature: 1000 }).colorTemperature).toBe(2700);

    const white = applyCommandLocally(state, { whiteMode: true });
    expect(white.colorMode).toBe('white');
    expect(white.saturation).toBe(0);
  });

  it('turns the light on for night mode and clears it when switched off', () => {
    const night = applyCommandLocally(makeState({ power: 'off' }), { nightMode: true });
    expect(night).toMatchObject({ nightMode: true, power: 'on' });

    const cleared = applyCommandLocally(makeState({ power: 'on', nightMode: true }), { power: 'off' });
    expect(cleared.nightMode).toBe(false);
  });

  it('cycles effects', () => {
    const state = makeState({ power: 'on', effect: null });

    expect(applyCommandLocally(state, { effect: 'next' }).effect).toBe(0);
    expect(applyCommandLocally(makeState({ power: 'on', effect: 8 }), { effect: 'next' }).effect).toBe(0);
    expect(applyCommandLocally(state, { effect: 4 }).effect).toBe(4);
    expect(applyCommandLocally(state, { effect: 99 }).effect).toBe(8);
  });

  it('restores a colour mode when a light that was off comes back on', () => {
    const next = applyCommandLocally(makeState({ power: 'off', colorMode: 'off' }), { power: 'on' });
    expect(next.colorMode).toBe('white');
  });

  it('always stamps a fresh updatedAt', () => {
    const state = makeState({ updatedAt: '2000-01-01T00:00:00.000Z' });
    expect(applyCommandLocally(state, { power: 'on' }).updatedAt).not.toBe(state.updatedAt);
  });
});
