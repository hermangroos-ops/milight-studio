/**
 * Boots the whole product for end-to-end tests: a fake Milight hub plus the real API
 * server serving the real built web UI.
 *
 * The fake hub records every request it receives and exposes them at `/__requests`, so a
 * browser test can assert that clicking a slider really produced the right radio command
 * instead of only checking that the UI moved.
 */
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB_PORT = Number(process.env.E2E_HUB_PORT ?? 8099);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8080);

const requests = [];

const hub = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');

    if (request.url === '/__requests') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(requests));
      return;
    }

    if (request.url === '/__reset') {
      requests.length = 0;
      response.writeHead(204).end();
      return;
    }

    let body;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    requests.push({ method: request.method, path: request.url, body });

    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/about') {
      response.end(JSON.stringify({ firmware: 'milight-hub', version: '1.11.0-e2e' }));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/gateways/')) {
      response.end(JSON.stringify({ state: 'OFF', level: 100, bulb_mode: 'white' }));
      return;
    }
    response.end(JSON.stringify({ success: true }));
  });
});

await new Promise((resolve) => hub.listen(HUB_PORT, '127.0.0.1', resolve));
process.stdout.write(`fake milight hub listening on ${HUB_PORT}\n`);

process.env.NODE_ENV = 'production';
process.env.PORT = String(API_PORT);
process.env.HOST = '127.0.0.1';
process.env.LOG_LEVEL = 'warn';
process.env.MILIGHT_HUB_URL = `http://127.0.0.1:${HUB_PORT}`;
process.env.MILIGHT_HUB_POLL_MS = '2000';
process.env.MILIGHT_HUB_MIN_GAP_MS = '0';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'milight-e2e-'));
process.env.SERVE_WEB = 'true';
process.env.WEB_ROOT = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));
process.env.HUE_BRIDGE_ENABLED = 'false';
process.env.MATTER_BRIDGE_ENABLED = 'false';

await import('../../apps/server/dist/main.js');
