# Milight Studio

Self-hosted control for MiBoxer / Mi-Light lights. Per-bulb brightness, colour and colour
temperature, user-defined groups, scenes, and Alexa support — all on your own LAN, with no
Chinese cloud and no subscription.

[![CI](https://github.com/OWNER/milight-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/milight-studio/actions/workflows/ci.yml)
[![CodeQL](https://github.com/OWNER/milight-studio/actions/workflows/codeql.yml/badge.svg)](https://github.com/OWNER/milight-studio/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Nederlands?** Zie [docs/nl/snelstart.md](docs/nl/snelstart.md) voor de installatiegids in het Nederlands.

---

## Why this exists

The stock **WL-Box1** gateway is locked to Futlight's cloud: no local API, no web interface,
and an Alexa skill that is not usable in the Dutch store. Replacing it with an
[`esp8266_milight_hub`](https://github.com/sidoh/esp8266_milight_hub) — an ESP8266 plus an
NRF24L01+ radio that speaks the Mi-Light protocol directly — gives you a local REST API.

Milight Studio is the layer on top of that: a real app with a real domain model.

```
Alexa ⇄ Matter bridge ─┐
                       ├─ Milight Studio ⇄ HTTP ⇄ esp8266_milight_hub ⇄ 2.4 GHz ⇄ bulbs
Browser / PWA ⇄ REST ──┘
```

Your existing physical remotes keep working; the hub sniffs their presses.

## What you get

- **Per-light control** — power, brightness, hue/saturation, colour temperature, the built-in
  dynamic modes and night mode. Controls are gated on what each bulb protocol can actually do,
  so a dual-white bulb never shows a colour wheel.
- **Groups that are not radio zones** — a group can mix protocols, device ids and rooms.
  Commands fan out per member and partial failures are reported instead of swallowed.
- **Scenes** — capture the current state of any set of lights and groups, replay with one tap
  or one voice command.
- **Alexa** — via a local **Matter bridge** (full colour, no cloud, no subscription) with an
  emulated Hue bridge as a legacy fallback. See [docs/alexa.md](docs/alexa.md).
- **A progressive web app** — mobile-first, installable, dark by default, keyboard accessible,
  and live-updating over a WebSocket so every open tab stays in sync.
- **An honest API** — OpenAPI 3.1 generated from the same Zod schemas that validate requests,
  served at `/docs`.

## Quick start

### Docker (recommended)

```bash
docker run -d --name milight-studio \
  -p 8080:8080 \
  -v milight-studio-data:/data \
  -e MILIGHT_HUB_URL=http://192.168.1.42 \
  --restart unless-stopped \
  ghcr.io/OWNER/milight-studio:latest
```

Open <http://localhost:8080>. Multi-arch images are published for `amd64` and `arm64`, so the
same tag runs on a Raspberry Pi.

For the Matter bridge you need host networking and IPv6:

```bash
docker run -d --name milight-studio \
  --network host \
  -v milight-studio-data:/data \
  -e MILIGHT_HUB_URL=http://192.168.1.42 \
  -e MATTER_BRIDGE_ENABLED=true \
  ghcr.io/OWNER/milight-studio:latest
```

Or use the provided [`docker-compose.yml`](docker-compose.yml).

### From source

```bash
corepack enable
pnpm install
pnpm run build
MILIGHT_HUB_URL=http://192.168.1.42 node apps/server/dist/main.js
```

## Setting up your lights

1. Build and flash the hub — [docs/hardware.md](docs/hardware.md) walks through the ~€20 of
   parts, the wiring and the firmware.
2. Open **Instellingen → Lamp toevoegen** and enter the bulb's radio address. Either take over
   the pairing of an existing remote (read the device id off the hub's sniffer view) or pick a
   fresh device id and pair the bulb.
3. Group the lights per room, build a few scenes, and switch on a voice bridge.

## Configuration

Every setting is an environment variable; see [`.env.example`](.env.example) for the annotated
list. The ones that matter:

| Variable                 | Default                    | Meaning                                                        |
| ------------------------ | -------------------------- | -------------------------------------------------------------- |
| `MILIGHT_HUB_URL`        | `http://milight-hub.local` | Base URL of your esp8266_milight_hub                           |
| `PORT` / `HOST`          | `8080` / `0.0.0.0`         | Where the API and UI listen                                    |
| `DATA_DIR`               | `./data`                   | Where lights, groups, scenes and shadow state are stored       |
| `API_TOKEN`              | _unset_                    | When set, every `/api` request needs `Authorization: Bearer …` |
| `MATTER_BRIDGE_ENABLED`  | `false`                    | Publish lights to Alexa over Matter                            |
| `HUE_BRIDGE_ENABLED`     | `false`                    | Legacy Hue emulation (needs port 80)                           |
| `MILIGHT_HUB_MIN_GAP_MS` | `40`                       | Minimum gap between hub requests; raise it if commands drop    |

## Documentation

| Document                                     | What is in it                               |
| -------------------------------------------- | ------------------------------------------- |
| [docs/architecture.md](docs/architecture.md) | How the pieces fit together and why         |
| [docs/hardware.md](docs/hardware.md)         | Parts list, wiring, flashing, pairing       |
| [docs/alexa.md](docs/alexa.md)               | Choosing and configuring a voice bridge     |
| [docs/matter.md](docs/matter.md)             | Matter bridge operator guide                |
| [docs/api.md](docs/api.md)                   | REST and WebSocket reference                |
| [docs/development.md](docs/development.md)   | Local setup, test strategy, release process |
| [docs/nl/snelstart.md](docs/nl/snelstart.md) | Nederlandse snelstartgids                   |

## Testing

The pipeline runs every layer on every push:

| Layer         | Tool                                           | What it protects                                                                                          |
| ------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Unit          | Vitest                                         | Colour maths, protocol translation, domain services                                                       |
| Integration   | Vitest + a fake hub over real HTTP             | Retries, request serialisation, persistence, WebSocket                                                    |
| API contract  | Vitest + `app.inject`                          | Status codes, error envelopes, response shapes validated against the shared schemas, OpenAPI completeness |
| UI            | Vitest + Testing Library                       | Component behaviour and capability gating                                                                 |
| End-to-end    | Playwright, two viewports                      | Real browser against the real server and the real built UI                                                |
| Accessibility | axe-core in Playwright                         | WCAG 2.1 A/AA on every screen, plus keyboard-only journeys                                                |
| Mutation      | Stryker (nightly)                              | Whether the tests would notice if the code were wrong                                                     |
| Load          | k6 (nightly)                                   | Latency under a slider-dragging burst                                                                     |
| Security      | CodeQL, Semgrep, `pnpm audit`, gitleaks, Trivy | Code, dependencies, secrets, container image                                                              |

```bash
pnpm run verify      # format, lint, types, all vitest projects with coverage
pnpm run test:e2e    # Playwright
```

## Licence

MIT — see [LICENSE](LICENSE).

`esp8266_milight_hub` is an independent project by Chris Mullins (sidoh); Milight Studio talks
to it but does not include it. "MiBoxer", "Mi-Light" and "Philips Hue" are trademarks of their
respective owners and are used here only to describe compatibility.
