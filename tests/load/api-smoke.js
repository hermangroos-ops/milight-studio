/* eslint-disable */
/**
 * k6 load profile for the Milight Studio API.
 *
 * The realistic worst case is not thousands of users — it is one household hammering a
 * brightness slider while Alexa polls state and two browser tabs are open. This profile
 * models that: a steady read load plus a burst of writes, asserting that the serial hub
 * queue never turns into unbounded latency.
 *
 * Run against the e2e stack:  k6 run tests/load/api-smoke.js
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8080/api/v1';

const commandLatency = new Trend('command_latency', true);

export const options = {
  scenarios: {
    readers: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      exec: 'read',
    },
    writers: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      stages: [
        { target: 20, duration: '10s' },
        { target: 60, duration: '10s' },
        { target: 5, duration: '10s' },
      ],
      exec: 'write',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:readers}': ['p(95)<250'],
    command_latency: ['p(95)<1500'],
  },
};

export function setup() {
  const created = http.post(
    `${BASE}/lights`,
    JSON.stringify({
      name: `Load test ${Date.now()}`,
      room: 'Load',
      deviceId: '0x0f0f',
      remoteType: 'rgb_cct',
      groupId: 4,
    }),
    { headers: { 'content-type': 'application/json' } },
  );

  if (created.status !== 201) {
    throw new Error(`Could not create the load-test light: ${created.status} ${created.body}`);
  }
  return { lightId: created.json('id') };
}

export function read() {
  group('read', () => {
    const health = http.get(`${BASE}/health`);
    check(health, { 'health is 200': (r) => r.status === 200 });

    const lights = http.get(`${BASE}/lights`);
    check(lights, {
      'lights is 200': (r) => r.status === 200,
      'lights has a body': (r) => Array.isArray(r.json('lights')),
    });
  });
  sleep(1);
}

export function write(data) {
  const brightness = 1 + Math.floor(Math.random() * 99);
  const response = http.put(
    `${BASE}/lights/${data.lightId}/state`,
    JSON.stringify({ power: 'on', brightness }),
    { headers: { 'content-type': 'application/json' } },
  );

  commandLatency.add(response.timings.duration);
  check(response, { 'command accepted': (r) => r.status === 200 });
}

export function teardown(data) {
  http.del(`${BASE}/lights/${data.lightId}`);
}
