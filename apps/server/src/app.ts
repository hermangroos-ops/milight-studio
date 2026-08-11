import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { API_BASE_PATH, type ApiError } from '@milight-studio/shared';
import addFormats from 'ajv-formats';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { BridgeRegistry } from './bridges/registry.js';
import type { Services } from './container.js';
import { AppError } from './errors.js';
import { registerEventRoutes } from './http/routes/events.js';
import { registerGroupRoutes } from './http/routes/groups.js';
import { registerLightRoutes } from './http/routes/lights.js';
import { registerSceneRoutes } from './http/routes/scenes.js';
import { registerSystemRoutes } from './http/routes/system.js';
import { APP_VERSION } from './version.js';

export interface BuildAppOptions {
  services: Services;
  bridges?: BridgeRegistry;
  /** Disable helmet + rate limiting; used by the test harness. */
  hardened?: boolean;
}

function toErrorBody(code: string, message: string, details?: { path: string; message: string }[]): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function resolveWebRoot(webRoot: string): string | null {
  const candidate = isAbsolute(webRoot) ? webRoot : resolve(process.cwd(), webRoot);
  return existsSync(candidate) ? candidate : null;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { services } = options;
  const { config } = services;
  const bridges = options.bridges ?? new BridgeRegistry();
  const hardened = options.hardened ?? config.isProduction;
  const startedAt = Date.now();

  const logger: FastifyServerOptions['logger'] = config.isTest
    ? false
    : {
        level: config.LOG_LEVEL,
        ...(config.isProduction ? {} : { transport: { target: 'pino-pretty' } }),
      };

  const serverOptions: FastifyServerOptions = {
    logger,
    ajv: {
      customOptions: { removeAdditional: false, coerceTypes: 'array', allErrors: true },
      // ajv-formats ships an `export =` style default that TypeScript cannot line up
      // with Ajv's `Plugin<T>` signature, hence the cast.
      plugins: [[addFormats, { mode: 'fast' }]] as unknown as NonNullable<
        FastifyServerOptions['ajv']
      >['plugins'],
    },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  };

  const app: FastifyInstance = Fastify(serverOptions);

  if (hardened) {
    await app.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    });
    // A LAN-only smart-home UI legitimately produces bursts (dragging a slider,
    // fanning a command out over a group), so the ceiling is generous and loopback
    // callers — the e2e stack, health probes, the bridges — are exempt entirely.
    await app.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      allowList: (request) => LOOPBACK_ADDRESSES.has(request.ip),
    });
  }

  await app.register(cors, {
    origin: config.CORS_ORIGINS.includes('*') ? true : config.CORS_ORIGINS,
    credentials: true,
  });

  await app.register(websocket);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Milight Studio API',
        description:
          'Control MiBoxer / Mi-Light bulbs through an esp8266_milight_hub: individual lights, ' +
          'user-defined groups and scenes, plus voice-assistant bridge status.',
        version: APP_VERSION,
      },
      servers: [{ url: API_BASE_PATH }],
      tags: [
        { name: 'system', description: 'Health, capabilities and bridges' },
        { name: 'lights', description: 'Individual lights' },
        { name: 'groups', description: 'User-defined groups of lights' },
        { name: 'scenes', description: 'Named collections of commands' },
      ],
    },
  });

  await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: false });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send(toErrorBody(error.code, error.message, error.details));
    }

    if (error.validation !== undefined) {
      return reply.code(400).send(
        toErrorBody(
          'validation_failed',
          'Request failed validation',
          error.validation.map((issue) => ({
            path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || '(root)',
            message: issue.message ?? 'Invalid value',
          })),
        ),
      );
    }

    if (error.statusCode === 429) {
      return reply.code(429).send(toErrorBody('rate_limited', 'Too many requests, slow down'));
    }

    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply.code(error.statusCode).send(toErrorBody('validation_failed', error.message));
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send(toErrorBody('internal_error', 'Something went wrong on the server'));
  });

  if (config.API_TOKEN !== undefined) {
    const expected = `Bearer ${config.API_TOKEN}`;
    // Registered on the root instance rather than inside the API plugin so that
    // unmatched paths under /api are rejected too — otherwise an anonymous caller
    // could use 404-vs-401 to probe which routes exist.
    app.addHook('onRequest', (request, reply, next) => {
      if (!request.url.startsWith(API_BASE_PATH)) {
        next();
        return;
      }
      if (request.headers.authorization !== expected) {
        void reply.code(401).send(toErrorBody('unauthorised', 'Missing or invalid API token'));
        return;
      }
      next();
    });
  }

  await app.register(
    (instance, _opts, done) => {
      registerSystemRoutes(instance, services, bridges, startedAt);
      registerLightRoutes(instance, services);
      registerGroupRoutes(instance, services);
      registerSceneRoutes(instance, services);
      registerEventRoutes(instance, services);
      done();
    },
    { prefix: API_BASE_PATH },
  );

  const webRoot = config.SERVE_WEB ? resolveWebRoot(config.WEB_ROOT) : null;
  if (config.SERVE_WEB && webRoot === null) {
    app.log.warn({ webRoot: config.WEB_ROOT }, 'Web UI not found; serving API only');
  }
  if (webRoot !== null) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    // Single page app: anything that is not an API call falls back to index.html.
    const isAppRoute = webRoot !== null && request.method === 'GET' && !request.url.startsWith(API_BASE_PATH);
    if (isAppRoute) return reply.sendFile('index.html');
    return reply.code(404).send(toErrorBody('not_found', `No route for ${request.method} ${request.url}`));
  });

  return app;
}
