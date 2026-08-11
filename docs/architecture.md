# Architecture

## The shape of the system

```
                    ┌──────────────────────────────────────────┐
   Browser / PWA ───▶│  Fastify HTTP API   (/api/v1)            │
   (React 19)    ◀───│  WebSocket          (/api/v1/events)     │
                    │  OpenAPI + Swagger  (/docs)              │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────┐
                    │  Domain services                         │
                    │  LightService · GroupService ·           │
                    │  SceneService · HubMonitor · EventBus     │
                    └───────┬───────────────────────┬──────────┘
                            │                       │
              ┌─────────────▼──────────┐  ┌─────────▼─────────────┐
              │  Store (JSON, atomic)  │  │  Voice bridges         │
              │  lights/groups/scenes  │  │  Matter · Hue emulation│
              │  + shadow state        │  └─────────┬─────────────┘
              └────────────────────────┘            │
                            │                       ▼
              ┌─────────────▼──────────┐      Alexa / Echo
              │  MilightHubClient      │
              │  serial queue + retry  │
              └─────────────┬──────────┘
                            ▼
                 esp8266_milight_hub  ──2.4 GHz──▶  bulbs
```

## Packages

| Package                   | Responsibility                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared`         | The domain vocabulary: entities, Zod schemas, remote-type capability table, colour maths. Zero runtime dependencies beyond Zod. Imported by the server _and_ the browser, so the contract cannot drift. |
| `packages/milight-client` | Everything that knows what `esp8266_milight_hub` looks like on the wire: the typed client, the retry policy, the serial queue, and the translation between our commands and the hub's JSON.             |
| `apps/server`             | HTTP, persistence, domain services, voice bridges.                                                                                                                                                      |
| `apps/web`                | The progressive web app.                                                                                                                                                                                |

The dependency direction is strictly one-way: `web → shared`, `server → shared + milight-client`,
`milight-client → shared`. Nothing depends on the server.

## Decisions worth knowing

### Everything device-independent lives in the model

The domain stores hue in degrees, brightness and saturation in percent, and colour temperature
in kelvin. Mireds, 0–254 bytes and Alexa's 0–1 floats only appear at the edges — in
`milight-client`, in the Hue bridge, in the Matter bridge. That is what makes it possible to
add a third voice ecosystem without touching a service.

### Shadow state, because the radio is one-way

MiLight bulbs never report back. There is no "is the light on?" question that can be answered
truthfully — only "what did we last tell it?". The `states` map in the store is that shadow,
updated optimistically after a command succeeds at the hub. `reachable` therefore describes the
_hub_, not the bulb. `POST /lights/:id/refresh` folds in whatever the hub remembers, which also
picks up presses of a physical remote when the hub is sniffing.

### A serial queue in front of the hub

The ESP8266 runs a single-threaded web server and a radio that needs a few milliseconds between
packets. Concurrent requests produce dropped commands and connection resets. Every hub call
therefore goes through `SerialQueue`, which enforces strict FIFO order and a configurable
minimum gap. This is also why a group command fans out sequentially rather than with
`Promise.all` — the parallelism would be an illusion and the failure mode would be worse.

### Groups are ours, not the radio's

MiLight has "zones" — up to 4 or 8 per device id, tied to one protocol. Those are modelled as
part of a light's address (`deviceId` + `remoteType` + `groupId`). A **group** in Milight Studio
is a user-level concept that can span protocols and device ids. Mixing the two would have made
"all lights in the living room" impossible for a household with both RGB+CCT bulbs and a dual
white strip.

### Capabilities are data, not conditionals

`REMOTE_TYPE_PROFILES` in `packages/shared` is the single table describing what each protocol
can do. The UI renders controls from it, the translator drops unsupported fields from it, and
the bridges pick device types from it. Adding a new bulb protocol is one table entry plus a
translation branch.

### Validation happens twice, on purpose

Route schemas are generated from the Zod schemas with `z.toJSONSchema`, so Fastify's AJV rejects
structurally invalid requests _and_ the OpenAPI document is generated from the same source.
Handlers then re-parse with Zod, which catches the cross-field rules JSON Schema cannot express
(“you cannot set a colour and a colour temperature in the same command”) and hands the handler a
fully typed value.

### Persistence is a JSON file written atomically

The dataset is a few kilobytes of lights, groups and scenes. A database would be a liability on
an SD card. `FilePersistence` writes to a temp file and renames over the target, so a power cut
leaves either the old document or the new one — never a truncated one. Writes are debounced and
`flush()` runs on shutdown.

### Bridges are optional and isolated

A `VoiceBridge` starts, stops and reports status. `BridgeRegistry` starts them best-effort: a
bridge that throws is logged and reported as `running: false`, and the API keeps working.
`@matter/main` is imported lazily so an installation with the Matter bridge disabled never pays
for loading it — and neither does the test suite.

## Request lifetime, end to end

`PUT /api/v1/lights/{id}/state {"power":"on","brightness":40}`

1. AJV validates the body against the generated JSON Schema.
2. `parseWith(lightCommandSchema, …)` re-parses it and applies cross-field rules.
3. `LightService.command` looks the light up and calls `validateCommand` for semantic conflicts.
4. `buildHubCommandBody` translates to the hub's vocabulary, dropping anything the protocol
   cannot do and ordering the keys so the hub applies power before brightness.
5. `MilightHubClient` queues the request, retries transient failures with backoff, and either
   resolves or raises a typed error.
6. `applyCommandToState` updates the shadow state; the store schedules a persist.
7. `EventBus` emits `light.state`; the WebSocket pushes it to every tab and every bridge.
8. The handler returns the updated light.

A failure at step 5 marks the light unreachable, emits that as an event too, and maps to
`503 hub_unreachable` or `502 hub_error` in the shared error envelope.
