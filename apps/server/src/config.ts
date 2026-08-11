import { z } from 'zod';

const booleanFromEnv = z
  .string()
  .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()));

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
);

export const configSchema = z.object({
  /** Port the HTTP API listens on. */
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Base URL of the esp8266_milight_hub, e.g. http://192.168.1.42 */
  MILIGHT_HUB_URL: z.url().default('http://milight-hub.local'),
  MILIGHT_HUB_TIMEOUT_MS: z.coerce.number().int().min(200).max(60_000).default(5_000),
  MILIGHT_HUB_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  MILIGHT_HUB_MIN_GAP_MS: z.coerce.number().int().min(0).max(1_000).default(40),
  /** How often to probe the hub for reachability. 0 disables the monitor. */
  MILIGHT_HUB_POLL_MS: z.coerce.number().int().min(0).max(600_000).default(30_000),

  DATA_DIR: z.string().default('./data'),

  /** Comma separated list of allowed CORS origins, or `*`. */
  CORS_ORIGINS: csv.default(['*']),

  /** Requests per minute per client, once hardening is on. Loopback is always exempt. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(100_000).default(3_000),

  /** When set, every /api request must send `Authorization: Bearer <token>`. */
  API_TOKEN: z.string().min(16).optional(),

  /** Serve the built web UI from the API process. */
  SERVE_WEB: booleanFromEnv.default(true),
  WEB_ROOT: z.string().default('../web/dist'),

  HUE_BRIDGE_ENABLED: booleanFromEnv.default(false),
  HUE_BRIDGE_PORT: z.coerce.number().int().min(1).max(65_535).default(80),
  /** LAN address advertised to Alexa. Auto-detected when empty. */
  HUE_BRIDGE_ADDRESS: z.string().default(''),

  MATTER_BRIDGE_ENABLED: booleanFromEnv.default(false),
  MATTER_BRIDGE_PORT: z.coerce.number().int().min(1).max(65_535).default(5540),
  MATTER_BRIDGE_PASSCODE: z.coerce.number().int().default(20_202_021),
  MATTER_BRIDGE_DISCRIMINATOR: z.coerce.number().int().min(0).max(4095).default(3840),
  MATTER_STORAGE_DIR: z.string().default('./data/matter'),
});

export type RawConfig = z.infer<typeof configSchema>;

export interface AppConfig extends RawConfig {
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

export class ConfigError extends Error {
  readonly issues: { path: string; message: string }[];

  constructor(issues: { path: string; message: string }[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  return {
    ...result.data,
    isProduction: result.data.NODE_ENV === 'production',
    isTest: result.data.NODE_ENV === 'test',
  };
}
