import type { ServerEvent } from '@milight-studio/shared';
import type { FastifyInstance } from 'fastify';

import type { Services } from '../../container.js';
import { APP_VERSION } from '../../version.js';

/**
 * Live event stream.
 *
 * Every connected client gets the same `ServerEvent` objects the bridges see, so the UI
 * stays in sync when a command comes from another tab, a scene, or Alexa.
 */
export function registerEventRoutes(app: FastifyInstance, services: Services): void {
  app.get('/events', { websocket: true, schema: { hide: true } }, (socket) => {
    const send = (event: ServerEvent): void => {
      if (socket.readyState !== socket.OPEN) return;
      try {
        socket.send(JSON.stringify(event));
      } catch (error) {
        app.log.warn({ err: error }, 'Failed to push event to WebSocket client');
      }
    };

    send({ type: 'hello', serverTime: new Date().toISOString(), version: APP_VERSION });

    const unsubscribe = services.events.subscribe(send);
    socket.on('close', unsubscribe);
    socket.on('error', () => {
      unsubscribe();
    });
  });
}
