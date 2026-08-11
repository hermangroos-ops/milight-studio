# Matter bridge

Milight Studio can publish its lights, groups and scenes as a **Matter bridge**. This is the
recommended way to reach Amazon Alexa: a Matter-capable Echo talks to the bridge directly over
your LAN, with full colour and colour-temperature control, no cloud account, no AWS Lambda and
no subscription.

The bridge is optional and off by default. If it fails to start, the REST API and the web UI
keep working; the failure is reported through `GET /api/v1/bridges`.

## Prerequisites

- **A Matter-capable Echo.** Echo (4th gen), Echo Dot (5th gen), Echo Show 8/10/15/21 and the
  newer Echo Studio act as Matter controllers. Older Echos cannot commission a Matter device.
  The Echo must be on the same LAN as the server.
- **IPv6 on the LAN.** Matter is IPv6-only for its operational traffic. Your router must hand
  out IPv6 (link-local addresses are enough) and IPv6 must not be disabled on the host. Without
  IPv6 the bridge fails to start with a `Cannot bind to {::}:5540` error.
- **mDNS reachable between server and Echo.** Commissioning and discovery use mDNS on UDP 5353.
  VLAN separation or "client isolation" on the Wi-Fi access point will break this.
- **Host networking for Docker.** Bridge-mode Docker networking hides mDNS and IPv6 from the
  LAN. Run the container with `network_mode: host` (Linux). Docker Desktop on macOS and Windows
  has no host networking, so run the server directly on the host there.
- **A writable storage directory.** The bridge persists its fabric, keys and endpoint numbers;
  deleting that directory is a factory reset and forces re-commissioning.

## Configuration

| Variable                      | Default         | Meaning                                                                      |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `MATTER_BRIDGE_ENABLED`       | `false`         | Switches the bridge on. Accepts `1`, `true`, `yes`, `on`.                    |
| `MATTER_BRIDGE_PORT`          | `5540`          | UDP port for Matter operational traffic.                                     |
| `MATTER_BRIDGE_PASSCODE`      | `20202021`      | Commissioning passcode (8 digits). Change it before exposing a real network. |
| `MATTER_BRIDGE_DISCRIMINATOR` | `3840`          | 12-bit id (0–4095) that distinguishes this device while commissioning.       |
| `MATTER_STORAGE_DIR`          | `./data/matter` | Where the fabric, keys and endpoint numbers are persisted.                   |

matter.js itself reads `MATTER_LOG_LEVEL` (`debug`, `info`, `notice`, `warn`, `error`, `fatal`)
if you need more detail while troubleshooting.

Docker Compose example:

```yaml
services:
  milight-studio:
    image: ghcr.io/example/milight-studio:latest
    network_mode: host
    environment:
      MATTER_BRIDGE_ENABLED: 'true'
      MATTER_BRIDGE_PASSCODE: '43219876'
      MATTER_BRIDGE_DISCRIMINATOR: '1234'
      MATTER_STORAGE_DIR: /data/matter
    volumes:
      - ./data:/data
```

## Commissioning from the Alexa app

1. Start the server with the bridge enabled. On startup it logs a line such as:

   ```
   Matter bridge listening on port 5540 with 12 bridged device(s). Add it in the Alexa app
   with manual pairing code 34970112332 (QR payload: MT:-24J0AFN00KA0648G00)
   ```

   The same line is returned by `GET /api/v1/bridges` as the `detail` field of the `matter`
   bridge, so you can read it from the UI instead of scraping the logs.

2. In the Alexa app: **Devices → + → Add Device → Other → Matter**.
3. Alexa asks whether the device has a Matter logo/QR code. Choose **Try Numeric Code
   instead** and type the 11-digit manual pairing code.
4. Alexa finds the bridge on the LAN, commissions it and then enumerates every bridged
   endpoint. Each light, group and scene shows up as its own device named after the entity.
5. Assign rooms in the Alexa app as you like — Alexa's own grouping is independent of ours.

After commissioning, the log line changes to `already commissioned`; the pairing code stays in
`detail` for adding a second controller later (Alexa, Google Home and Apple Home can share the
bridge through multi-admin).

## What gets exposed

Only entities with `exposeToVoice: true` are published. Each becomes a _bridged endpoint_ under
one aggregator, with a `BridgedDeviceBasicInformation` cluster carrying its name, reachability
and a stable unique id derived from our uuid.

| Source                         | Matter device type                | Notes                                          |
| ------------------------------ | --------------------------------- | ---------------------------------------------- |
| `rgb_cct`, `fut089` lights     | Extended Color Light (0x010D)     | Colour + tunable white.                        |
| `rgbw`, `rgb`, `fut020` lights | Extended Color Light (0x010D)     | See "colour-only bulbs" below.                 |
| `cct`, `fut091` lights         | Color Temperature Light (0x010C)  | Tunable white only.                            |
| Groups                         | Union of their members' abilities | Extended Color / Color Temperature / Dimmable. |
| Scenes                         | On/Off Light (0x0100)             | "On" runs the scene, then falls back to off.   |

**Colour-only bulbs.** Matter's device library has no "colour without colour temperature"
light: it defines On/Off, Dimmable, Color Temperature and Extended Color lights, and Extended
Color Light makes the colour-temperature feature mandatory. RGB and RGBW bulbs are therefore
published as Extended Color Lights. When Alexa asks such a bulb for a warm white, the bridge
sends "switch to white" for bulbs that have a white channel (RGBW) and logs the request as
unsupported for bulbs that do not (RGB, FUT020).

**Groups as lights.** Alexa cannot do anything useful with Matter _groups_, so every exposed
group is published as an ordinary bridged light. That is what makes "Alexa, zet woonkamer aan"
work. Commands are fanned out to the members; a member that cannot honour part of a command
simply ignores it. The group reports "on" when any member is on, and its brightness is the
average of the members that are on.

**Scenes.** A scene endpoint is a switch that only has a meaningful "on". Activating it runs
the scene and the endpoint reports off again about 1.5 seconds later, so it can be triggered
repeatedly. "Alexa, turn off Filmavond" does nothing by design.

**Toggle-only and step-only protocols.** FUT020 has no absolute on/off, so the bridge only
sends a toggle when our shadow state disagrees with what Alexa asked for. RGB bulbs cannot be
set to an absolute brightness, so an absolute level from Alexa is translated into a relative
step against the shadow state.

## Endpoint limit

Alexa stops enumerating a bridge somewhere around **50 bridged devices**; the Matter
specification allows far more, but Alexa is the limiting factor in practice. The server logs a
warning when the bridge starts with more than 50 endpoints. If you hit it, set
`exposeToVoice: false` on the lights you never address by voice — the individual bulbs of a
group are usually the first candidates, since the group itself is already exposed.

## Adding, renaming and removing entities

The bridge follows the event stream, so no restart is needed in the normal cases:

- **A new light, group or scene** with `exposeToVoice: true` is added as a bridged endpoint
  immediately. Alexa does not notice new endpoints on its own — say "Alexa, discover devices"
  or use **Devices → + → Add Device** once.
- **A rename** updates the endpoint's `nodeLabel`. Alexa keeps the name you gave the device in
  its own app, so you may want to rename it there as well.
- **Hiding** an entity (`exposeToVoice: false`) or **deleting** it removes the endpoint. Alexa
  will show it as unresponsive until you remove it in the app.
- **State changes** from the UI, the API or a physical remote are pushed to the matching
  endpoint, including the aggregate state of every group the light belongs to.
- **A capability change** — changing a light's `remoteType` from, say, `cct` to `rgb_cct` —
  changes the Matter device type, which is fixed for the lifetime of an endpoint. The bridge
  replaces the endpoint automatically, but the endpoint number changes, so Alexa needs a fresh
  discovery and may show a duplicate until the stale device is removed in the app.

Restarting the server never requires re-commissioning: the fabric lives in
`MATTER_STORAGE_DIR`.

## Troubleshooting

**`Cannot bind to {::}:5540 (code EAFNOSUPPORT)`** — the host has no IPv6. Enable IPv6 on the
host and the LAN; Matter cannot work without it.

**`EADDRINUSE` on 5540** — another Matter application (Home Assistant's Matter server, a second
Milight Studio instance) already uses the port. Set `MATTER_BRIDGE_PORT` to something else.

**Alexa says "device not found" while commissioning** — mDNS is not reaching the Echo. Check
that the container uses host networking, that the server and the Echo are on the same subnet
and VLAN, and that the access point does not have client/AP isolation enabled.

**Commissioning succeeds but no devices appear** — nothing has `exposeToVoice: true`, or the
bridge started before the store was loaded. Check `GET /api/v1/bridges` for the endpoint count
in the `detail` string.

**Some devices are missing** — you are probably past Alexa's ~50 endpoint limit; see above.

**Commands are acknowledged but the lights do not change** — the bridge answers Alexa first and
talks to the hub in the background, precisely so a slow hub cannot make Alexa report a timeout.
Look for `Matter: command for '<name>' failed` in the logs; the underlying cause is the hub, not
the bridge.

**A device is greyed out / unresponsive in Alexa** — the light's `reachable` flag is false,
which means the hub could not be reached the last time we tried. Fix the hub connection and the
flag clears on the next successful command.

**Start over** — stop the server, delete `MATTER_STORAGE_DIR`, remove the bridge in the Alexa
app and commission again. This invalidates every fabric, so all controllers must be re-added.

## Notes for developers

- The bridge lives in `apps/server/src/bridges/matter/`. `attribute-mapping.ts` and
  `device-mapping.ts` are pure and unit tested; `bridged-endpoints.ts` and `matter-node.ts`
  hold everything that touches `@matter/main`.
- The bridge advertises the CSA development vendor id `0xFFF1`. matter.js is not certified, and
  neither is this bridge; that is fine for self-hosted use but not for a product you sell.
- matter.js manages the process runtime by default. The bridge disables its signal handling and
  exit-code handling (`runtime.signals`, `runtime.exitcode`) so the API server keeps owning the
  process lifecycle.
