import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_ROUTE, parseRoute, useHashRoute } from './useHashRoute.js';

afterEach(() => {
  window.location.hash = '';
});

describe('parseRoute', () => {
  it('recognises the known routes', () => {
    expect(parseRoute('#/groepen')).toBe('groepen');
    expect(parseRoute('#scenes')).toBe('scenes');
    expect(parseRoute('#/instellingen')).toBe('instellingen');
  });

  it('falls back to the default for anything else', () => {
    expect(parseRoute('')).toBe(DEFAULT_ROUTE);
    expect(parseRoute('#/onzin')).toBe(DEFAULT_ROUTE);
  });
});

describe('useHashRoute', () => {
  it('starts from the current hash', () => {
    window.location.hash = '#/scenes';
    const { result } = renderHook(() => useHashRoute());

    expect(result.current.route).toBe('scenes');
  });

  it('navigates and writes the hash', () => {
    const { result } = renderHook(() => useHashRoute());

    act(() => {
      result.current.navigate('groepen');
    });

    expect(result.current.route).toBe('groepen');
    expect(window.location.hash).toBe('#/groepen');
  });

  it('follows external hash changes', () => {
    const { result } = renderHook(() => useHashRoute());

    act(() => {
      window.location.hash = '#/instellingen';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current.route).toBe('instellingen');
  });
});
