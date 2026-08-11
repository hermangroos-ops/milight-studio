import { buildApp } from './app.js';
import { BridgeRegistry } from './bridges/registry.js';
import { createHueBridge } from './bridges/hue/hue-bridge.js';
import { createMatterBridge } from './bridges/matter/matter-bridge.js';
import { ConfigError, loadConfig } from './config.js';
import { createServices } from './container.js';
import { APP_VERSION } from './version.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const services = await createServices(config);

  const logger = {
    info: (message: string, context?: Record<string, unknown>) => {
      console.warn(message, context ?? '');
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      console.warn(message, context ?? '');
    },
    error: (message: string, context?: Record<string, unknown>) => {
      console.error(message, context ?? '');
    },
  };

  const bridges = new BridgeRegistry(
    [createHueBridge({ config, services, logger }), createMatterBridge({ config, services, logger })],
    logger,
  );

  const app = await buildApp({ services, bridges });

  services.hubMonitor.start();
  await bridges.startAll();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down`);
    void (async () => {
      services.hubMonitor.stop();
      await bridges.stopAll();
      await app.close();
      await services.store.flush();
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    { version: APP_VERSION, hub: config.MILIGHT_HUB_URL },
    `Milight Studio ${APP_VERSION} listening on ${config.HOST}:${config.PORT}`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(78); // EX_CONFIG
  }
  console.error('Failed to start Milight Studio', error);
  process.exit(1);
});
