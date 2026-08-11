import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const empty: NodeJS.ProcessEnv = {};

describe('loadConfig: defaults', () => {
  it('produces a complete configuration from an empty environment', () => {
    expect(loadConfig(empty)).toEqual({
      PORT: 8080,
      RATE_LIMIT_MAX: 3_000,
      HOST: '0.0.0.0',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      MILIGHT_HUB_URL: 'http://milight-hub.local',
      MILIGHT_HUB_TIMEOUT_MS: 5_000,
      MILIGHT_HUB_RETRIES: 2,
      MILIGHT_HUB_MIN_GAP_MS: 40,
      MILIGHT_HUB_POLL_MS: 30_000,
      DATA_DIR: './data',
      CORS_ORIGINS: ['*'],
      SERVE_WEB: true,
      WEB_ROOT: '../web/dist',
      HUE_BRIDGE_ENABLED: false,
      HUE_BRIDGE_PORT: 80,
      HUE_BRIDGE_ADDRESS: '',
      MATTER_BRIDGE_ENABLED: false,
      MATTER_BRIDGE_PORT: 5540,
      MATTER_BRIDGE_PASSCODE: 20_202_021,
      MATTER_BRIDGE_DISCRIMINATOR: 3840,
      MATTER_STORAGE_DIR: './data/matter',
      isProduction: false,
      isTest: false,
    });
  });

  it('ignores environment variables it does not know about', () => {
    expect(loadConfig({ PATH: '/usr/bin', SHELL: '/bin/sh' }).PORT).toBe(8080);
  });

  it('leaves API_TOKEN unset by default', () => {
    expect(loadConfig(empty).API_TOKEN).toBeUndefined();
  });
});

describe('loadConfig: coercion', () => {
  it.each([
    { env: { PORT: '3000' }, key: 'PORT' as const, expected: 3000 },
    { env: { MILIGHT_HUB_TIMEOUT_MS: '250' }, key: 'MILIGHT_HUB_TIMEOUT_MS' as const, expected: 250 },
    { env: { MILIGHT_HUB_RETRIES: '0' }, key: 'MILIGHT_HUB_RETRIES' as const, expected: 0 },
    { env: { MILIGHT_HUB_MIN_GAP_MS: '0' }, key: 'MILIGHT_HUB_MIN_GAP_MS' as const, expected: 0 },
    { env: { MILIGHT_HUB_POLL_MS: '0' }, key: 'MILIGHT_HUB_POLL_MS' as const, expected: 0 },
    { env: { HUE_BRIDGE_PORT: '8081' }, key: 'HUE_BRIDGE_PORT' as const, expected: 8081 },
    { env: { MATTER_BRIDGE_DISCRIMINATOR: '0' }, key: 'MATTER_BRIDGE_DISCRIMINATOR' as const, expected: 0 },
  ])('coerces $env into a number', ({ env, key, expected }) => {
    expect(loadConfig(env)[key]).toBe(expected);
  });

  it('accepts a negative matter passcode because it is unbounded', () => {
    expect(loadConfig({ MATTER_BRIDGE_PASSCODE: '-1' }).MATTER_BRIDGE_PASSCODE).toBe(-1);
  });

  it.each(['development', 'test', 'production'])('accepts NODE_ENV=%s', (NODE_ENV) => {
    const config = loadConfig({ NODE_ENV });
    expect(config.NODE_ENV).toBe(NODE_ENV);
    expect(config.isProduction).toBe(NODE_ENV === 'production');
    expect(config.isTest).toBe(NODE_ENV === 'test');
  });

  it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])(
    'accepts LOG_LEVEL=%s',
    (LOG_LEVEL) => {
      expect(loadConfig({ LOG_LEVEL }).LOG_LEVEL).toBe(LOG_LEVEL);
    },
  );
});

describe('loadConfig: boolean parsing', () => {
  it.each(['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON', ' true ', '  on'])('reads %p as true', (value) => {
    expect(loadConfig({ HUE_BRIDGE_ENABLED: value }).HUE_BRIDGE_ENABLED).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', '', 'nope', 'enabled', '2', 'y', 'tru e'])(
    'reads %p as false',
    (value) => {
      expect(loadConfig({ HUE_BRIDGE_ENABLED: value }).HUE_BRIDGE_ENABLED).toBe(false);
    },
  );

  it.each(['SERVE_WEB', 'HUE_BRIDGE_ENABLED', 'MATTER_BRIDGE_ENABLED'] as const)(
    'applies the same rules to %s',
    (key) => {
      expect(loadConfig({ [key]: 'on' })[key]).toBe(true);
      expect(loadConfig({ [key]: 'off' })[key]).toBe(false);
    },
  );

  it('turns the SERVE_WEB default of true off when asked', () => {
    expect(loadConfig({ SERVE_WEB: '0' }).SERVE_WEB).toBe(false);
  });
});

describe('loadConfig: csv parsing', () => {
  it.each([
    { value: 'https://a.example', expected: ['https://a.example'] },
    { value: 'a,b,c', expected: ['a', 'b', 'c'] },
    { value: ' a , b ,  c ', expected: ['a', 'b', 'c'] },
    { value: 'a,,b', expected: ['a', 'b'] },
    { value: ',,,', expected: [] },
    { value: '', expected: [] },
    { value: '   ', expected: [] },
    { value: '*', expected: ['*'] },
  ])('parses $value into $expected', ({ value, expected }) => {
    expect(loadConfig({ CORS_ORIGINS: value }).CORS_ORIGINS).toEqual(expected);
  });
});

describe('loadConfig: validation failures', () => {
  it.each([
    { env: { PORT: '0' }, path: 'PORT' },
    { env: { PORT: '65536' }, path: 'PORT' },
    { env: { PORT: 'http' }, path: 'PORT' },
    { env: { PORT: '80.5' }, path: 'PORT' },
    { env: { NODE_ENV: 'staging' }, path: 'NODE_ENV' },
    { env: { LOG_LEVEL: 'verbose' }, path: 'LOG_LEVEL' },
    { env: { MILIGHT_HUB_URL: 'not-a-url' }, path: 'MILIGHT_HUB_URL' },
    { env: { MILIGHT_HUB_TIMEOUT_MS: '10' }, path: 'MILIGHT_HUB_TIMEOUT_MS' },
    { env: { MILIGHT_HUB_TIMEOUT_MS: '999999' }, path: 'MILIGHT_HUB_TIMEOUT_MS' },
    { env: { MILIGHT_HUB_RETRIES: '6' }, path: 'MILIGHT_HUB_RETRIES' },
    { env: { MILIGHT_HUB_RETRIES: '-1' }, path: 'MILIGHT_HUB_RETRIES' },
    { env: { MILIGHT_HUB_MIN_GAP_MS: '5000' }, path: 'MILIGHT_HUB_MIN_GAP_MS' },
    { env: { MILIGHT_HUB_POLL_MS: '600001' }, path: 'MILIGHT_HUB_POLL_MS' },
    { env: { API_TOKEN: 'too-short' }, path: 'API_TOKEN' },
    { env: { HUE_BRIDGE_PORT: '0' }, path: 'HUE_BRIDGE_PORT' },
    { env: { MATTER_BRIDGE_DISCRIMINATOR: '4096' }, path: 'MATTER_BRIDGE_DISCRIMINATOR' },
  ])('rejects $env by pointing at $path', ({ env, path }) => {
    const error = (() => {
      try {
        loadConfig(env);
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(ConfigError);
    const issues = (error as ConfigError).issues;
    expect(issues.map((issue) => issue.path)).toContain(path);
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
  });

  it('reports every problem at once and renders them into the message', () => {
    try {
      loadConfig({ PORT: '0', NODE_ENV: 'staging', MILIGHT_HUB_URL: 'nope' });
      expect.unreachable('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.name).toBe('ConfigError');
      expect(configError.issues.map((issue) => issue.path).sort()).toEqual([
        'MILIGHT_HUB_URL',
        'NODE_ENV',
        'PORT',
      ]);
      expect(configError.message).toContain('Invalid configuration');
      expect(configError.message).toContain('- PORT:');
    }
  });

  it('accepts an API token of exactly the minimum length', () => {
    expect(loadConfig({ API_TOKEN: 'x'.repeat(16) }).API_TOKEN).toBe('x'.repeat(16));
  });

  it('reads process.env when no environment is supplied', () => {
    expect(() => loadConfig()).not.toThrow();
  });
});
