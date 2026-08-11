# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository, rather than opening a public issue. Expect a first response within a week.

## Threat model, honestly stated

Milight Studio is designed to run **inside a home network**. It is not hardened for exposure to
the public internet, and you should not put it there.

What that means concretely:

- **There is no authentication by default.** Anyone who can reach the port can control your
  lights. Set `API_TOKEN` if your LAN is shared, but treat it as a speed bump, not a boundary.
- **The Hue bridge deliberately accepts any client.** That is how Alexa's local Hue discovery
  works — it never presses a link button — so the emulated bridge cannot meaningfully
  authenticate. Only enable it on a network you trust.
- **The Matter bridge uses a fixed commissioning passcode by default.** Change
  `MATTER_BRIDGE_PASSCODE` and `MATTER_BRIDGE_DISCRIMINATOR` if that matters to you. Once
  commissioned, the Matter fabric is properly authenticated and encrypted.
- **The MiLight radio protocol has no security at all.** Anyone within radio range with a €3
  remote can control your bulbs. No amount of application-layer work changes that.

If you want remote access, put it behind a VPN (WireGuard, Tailscale) rather than a port
forward. If you must expose it, terminate TLS at a reverse proxy, set `API_TOKEN`, and keep
`RATE_LIMIT_MAX` low.

## What the pipeline checks

Every push runs CodeQL (security-and-quality queries) and dependency review. Nightly runs add
Semgrep (`p/typescript`, `p/nodejs`, `p/secrets`), `pnpm audit` at moderate and above, gitleaks
over the full history, and a Trivy scan of the published container image that fails on
unfixed-excluded HIGH and CRITICAL findings. Dependabot opens grouped update pull requests
weekly.

## Supported versions

The latest released version is supported. This is a hobby project maintained by one person;
there is no long-term support branch.
