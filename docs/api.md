# API reference

Base path `/api/v1`. Everything is JSON. Interactive documentation, generated from the same
schemas that validate the requests, is served at **`/docs`**; the raw OpenAPI 3.1 document is at
**`/docs/json`**.

When `API_TOKEN` is set, every request under `/api/v1` needs `Authorization: Bearer <token>`.

## Errors

Every non-2xx response uses one envelope:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request body failed validation",
    "details": [{ "path": "brightness", "message": "Too big: expected number to be <=100" }]
  }
}
```

| Code                     | Status | Meaning                                                       |
| ------------------------ | ------ | ------------------------------------------------------------- |
| `validation_failed`      | 400    | The request body, params or query are wrong                   |
| `unauthorised`           | 401    | Missing or wrong bearer token                                 |
| `not_found`              | 404    | No such light, group, scene or route                          |
| `conflict`               | 409    | Duplicate radio address, or a group/scene name already in use |
| `unsupported_capability` | 422    | The bulb protocol cannot do any part of this command          |
| `rate_limited`           | 429    | Too many requests (loopback callers are exempt)               |
| `internal_error`         | 500    | A bug; check the logs                                         |
| `hub_error`              | 502    | The hub answered, but with an error                           |
| `hub_unreachable`        | 503    | The hub could not be reached at all                           |

## Commands

Every "control" endpoint takes the same command object. All fields are optional, but at least
one must be present.

```jsonc
{
  "power": "on", // "on" | "off" | "toggle"
  "brightness": 40, // 0–100
  "brightnessStep": -10, // relative, for protocols without absolute brightness
  "hue": 210, // 0–359
  "saturation": 80, // 0–100
  "hex": "#3366ff", // alternative to hue/saturation
  "colorTemperature": 2900, // kelvin, 2700–6500
  "whiteMode": true, // drop colour, go to plain white
  "nightMode": true, // the bulbs' own dim night mode
  "effect": 3, // 0–8, or "next"
  "effectSpeed": "up", // "up" | "down"
  "transitionMs": 2000, // fade duration
}
```

Rules the schema cannot express, enforced by the service and returned as `validation_failed`:

- A colour and a colour temperature cannot be set in the same command.
- A colour and `whiteMode` cannot be set in the same command.
- `brightness` and `brightnessStep` are mutually exclusive, and `brightnessStep` cannot be 0.
- `hex` cannot be combined with `hue`/`saturation`.

Fields a protocol does not support are dropped silently; if _nothing_ in the command survives,
the request fails with `unsupported_capability` and lists what was dropped.

## Endpoints

### System

| Method | Path            | Description                                                                       |
| ------ | --------------- | --------------------------------------------------------------------------------- |
| `GET`  | `/health`       | `status`, version, uptime and hub reachability. `degraded` when the hub is down   |
| `GET`  | `/remote-types` | Every supported bulb protocol with its capabilities, group range and effect count |
| `GET`  | `/bridges`      | Status of each voice bridge, including the Matter pairing code                    |

### Lights

| Method   | Path                   | Description                                                                               |
| -------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `GET`    | `/lights`              | `{ "lights": [...] }`, each with its shadow state                                         |
| `POST`   | `/lights`              | Add a light by radio address → `201`                                                      |
| `GET`    | `/lights/{id}`         | One light                                                                                 |
| `PATCH`  | `/lights/{id}`         | Rename, move room, change address or voice exposure. Only the fields you send are changed |
| `DELETE` | `/lights/{id}`         | `204`; also removed from groups and scene steps                                           |
| `PUT`    | `/lights/{id}/state`   | Send a command                                                                            |
| `POST`   | `/lights/{id}/refresh` | Re-read what the hub remembers, picking up physical remote presses                        |
| `POST`   | `/lights/{id}/pair`    | Pairing command — power-cycle the bulb first                                              |
| `POST`   | `/lights/{id}/unpair`  | Unbind the bulb from this address                                                         |

Creating a light:

```json
{
  "name": "Bureau",
  "room": "Studeerkamer",
  "deviceId": "0x1f2a",
  "remoteType": "rgb_cct",
  "groupId": 1,
  "exposeToVoice": true
}
```

`deviceId` accepts one to four hex digits with either casing of the `0x` prefix and is stored
canonically as `0x1f2a`. `groupId` must be within the range of the remote type — `GET
/remote-types` lists `maxGroupId` for each.

### Groups

| Method   | Path                  | Description                        |
| -------- | --------------------- | ---------------------------------- |
| `GET`    | `/groups`             | All groups                         |
| `POST`   | `/groups`             | Create → `201`                     |
| `GET`    | `/groups/{id}`        | One group                          |
| `GET`    | `/groups/{id}/lights` | Members with their state           |
| `PATCH`  | `/groups/{id}`        | Rename or change members           |
| `DELETE` | `/groups/{id}`        | `204`; member lights are untouched |
| `PUT`    | `/groups/{id}/state`  | Fan a command out to every member  |

A group command answers `200` with the members that succeeded and the ones that did not:

```json
{ "group": { ... }, "lights": [ ... ],
  "failed": [{ "lightId": "…", "code": "hub_unreachable", "message": "…" }] }
```

It only fails outright — with the first underlying error — when **no** member could be reached.

### Scenes

| Method                 | Path                    | Description             |
| ---------------------- | ----------------------- | ----------------------- |
| `GET`                  | `/scenes`               | All scenes              |
| `POST`                 | `/scenes`               | Create → `201`          |
| `GET` `PATCH` `DELETE` | `/scenes/{id}`          | Read, update, delete    |
| `POST`                 | `/scenes/{id}/activate` | Run every step in order |

A scene is a list of steps, each aimed at a light or a group:

```json
{
  "name": "Filmavond",
  "steps": [
    {
      "targetType": "group",
      "targetId": "…",
      "command": { "power": "on", "brightness": 15, "hex": "#ff7700" }
    },
    { "targetType": "light", "targetId": "…", "command": { "power": "off" } }
  ]
}
```

Activation reports `appliedSteps` and any `failed` steps; a failing step does not abort the rest.

## Live updates

`GET /api/v1/events` upgrades to a WebSocket. The server sends a `hello` frame, then one JSON
message per state change. Every message is a discriminated union on `type`:

`hello` · `light.created` · `light.updated` · `light.deleted` · `light.state` ·
`group.created` · `group.updated` · `group.deleted` · `scene.created` · `scene.updated` ·
`scene.deleted` · `scene.activated` · `hub.status`

```js
const socket = new WebSocket(`ws://${location.host}/api/v1/events`);
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'light.state') applyState(message.lightId, message.state);
};
```

Every change goes through this stream, whatever caused it — the UI, a scene, or Alexa — so a
client that listens never needs to poll.

## A note on state

MiLight radio is one-way: bulbs never report back. `state` is therefore what we last told the
bulb, not what the bulb measured, and `reachable` describes the _hub_. This is a property of the
hardware, not a limitation of this API.
