# Getting your lights into Alexa

There are three ways to reach Alexa from a self-hosted controller. They are not equivalent, and
the differences matter enough to be worth reading before you pick one.

|                    | **Matter bridge** (built in) | **Hue emulation** (built in)        | **Custom Smart Home Skill**                     |
| ------------------ | ---------------------------- | ----------------------------------- | ----------------------------------------------- |
| Colour             | ✅ full hue/saturation       | ❌ on/off + brightness only         | ✅ full                                         |
| Colour temperature | ✅                           | ❌                                  | ✅                                              |
| Cost               | free                         | free                                | free, but needs an AWS account                  |
| Cloud dependency   | none — LAN only              | none — LAN only                     | AWS Lambda + public HTTPS + OAuth               |
| Requirements       | a Matter-capable Echo        | any Echo that still supports Hue V1 | Amazon developer account, TLS certificate, DDNS |
| Effort             | ~10 minutes                  | ~2 minutes                          | an evening                                      |
| Future-proof       | yes                          | **no — being phased out**           | yes                                             |

**Recommendation: use the Matter bridge.** Use Hue emulation only if you have no Matter-capable
Echo and can live without colour control by voice.

---

## Option 1 — Matter bridge (recommended)

Alexa treats Milight Studio as a Matter _bridge_: one device that exposes many "bridged"
lights. Each light, each group and each scene becomes its own endpoint, so
"Alexa, zet de woonkamer op 30 procent" and "Alexa, zet filmavond aan" both work.

**You need**

- A Matter-capable Echo acting as the hub: 4th-generation Echo or Echo Dot and later, Echo Hub,
  or a recent Echo Show. Older Echos cannot commission Matter devices.
- IPv6 enabled on your LAN. Matter will not commission without it — this is the single most
  common failure.
- Host networking if you run in Docker. Matter uses mDNS and needs to share the host's network
  stack.

**Enable it**

```bash
MATTER_BRIDGE_ENABLED=true
MATTER_BRIDGE_PORT=5540          # optional
MATTER_STORAGE_DIR=/data/matter  # keep this on a persistent volume
```

On start, the pairing code is written to the log and exposed at `GET /api/v1/bridges`:

```json
{
  "bridges": [
    {
      "name": "matter",
      "enabled": true,
      "running": true,
      "detail": "Matter bridge listening on port 5540 with 7 bridged device(s). Add it in the Alexa app with manual pairing code 34970112332 …"
    }
  ]
}
```

In the Alexa app: **Devices → + → Add Device → Other → Matter → I don't have a QR code** and type
the manual pairing code.

Full operator guide, limits and troubleshooting: [docs/matter.md](matter.md).

---

## Option 2 — Emulated Hue bridge (legacy fallback)

Milight Studio can pretend to be a Philips Hue bridge from 2015. Alexa discovers it over the
LAN with no account linking at all — which is why it is the fastest thing to try — but Alexa's
built-in Hue V1 path only ever sends on/off and brightness. **You will not get colour or colour
temperature by voice.** Amazon has also stopped supporting V1 bridges on newer hardware
(Echo Pop and Echo Spot are reported not to work at all), so treat this as a fallback.

**Enable it**

```bash
HUE_BRIDGE_ENABLED=true
HUE_BRIDGE_PORT=80          # must be 80; Alexa ignores the advertised port
HUE_BRIDGE_ADDRESS=         # leave empty to auto-detect the LAN address
```

Port 80 is privileged. Either publish it from the container (`-p 80:80`), or grant the
capability when running from source:

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(command -v node)"
```

Then say _"Alexa, ontdek apparaten"_. Your lights, groups and scenes all appear as lights;
turning a "scene light" on runs the scene.

If discovery finds nothing: confirm the app is reachable on port 80 from another machine on the
LAN, check that the container is on the host network (SSDP is multicast and does not cross a
bridge network), and keep the number of exposed devices under about 49 — beyond that Alexa
silently discovers none. Use `exposeToVoice: false` on the lights you do not need by voice.

---

## Option 3 — Your own Alexa Smart Home Skill

Full capability, no Matter hardware needed, but a real project. The outline:

1. Create a **Smart Home** skill (payload version 3) in the Amazon Developer console, using the
   same Amazon account as your Echos. Dutch is a supported smart-home locale and maps to the
   "Europe and India" region, i.e. AWS `eu-west-1`.
2. The service endpoint must be an **AWS Lambda ARN** — the HTTPS-endpoint option exists only
   for custom skills. The Lambda then calls your instance over public HTTPS on port 443 with a
   publicly trusted certificate. Let's Encrypt via DuckDNS works; self-signed is rejected.
3. Set up **account linking** with an OAuth2 authorization-code grant. You need to run an
   authorisation server; `API_TOKEN` alone is not enough.
4. Implement `Alexa.Discovery`, `Alexa.PowerController`, `Alexa.BrightnessController`,
   `Alexa.ColorController`, `Alexa.ColorTemperatureController`, `Alexa.EndpointHealth` and
   `Alexa.SceneController`. Report each light and each group as its own `LIGHT` endpoint —
   Alexa has no concept of a discoverable group.
5. For proactive state updates, request the "Send Alexa Events" permission, handle
   `Alexa.Authorization/AcceptGrant`, and POST `ChangeReport` messages to the European event
   gateway at `https://api.eu.amazonalexa.com/v3/events`.

Because MiLight radio is one-way, report the shadow state and derive
`Alexa.EndpointHealth.connectivity` from whether the _hub_ is reachable, not the bulb.

This route is deliberately not implemented here: the Matter bridge gives the same capabilities
without an AWS account, a public TLS endpoint or an OAuth server. If you do build it, the
`VoiceBridge` interface in `apps/server/src/bridges/types.ts` is where it slots in.

---

## Choosing what Alexa sees

Every light, group and scene has an `exposeToVoice` flag (**"Tonen aan spraakassistent"** in the
UI). Turn it off for anything you only ever control from the app. It keeps the voice model
smaller, avoids name collisions, and keeps you under the per-bridge endpoint limits.

Naming tips that make voice control pleasant:

- Give groups the names you would actually say: "woonkamer", "keuken", "buiten".
- Avoid names that are prefixes of each other ("bank" and "banklamp" will be confused).
- Scenes read best as an activity: "filmavond", "opstaan", "alles uit".
- After adding anything new, say _"Alexa, ontdek apparaten"_ — neither bridge can push a new
  device into Alexa's list on its own.
