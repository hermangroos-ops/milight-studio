# Contributing

Thanks for taking a look. This is a small project, so the process is light.

## Before you write code

- For a bug, open an issue with what you expected, what happened, your bulb's remote type, and
  the relevant log lines.
- For a feature, open an issue first. It is cheaper to disagree about scope in prose than in a
  pull request.

## The loop

```bash
pnpm install
pnpm run dev        # API on :8080, UI on :5173
pnpm run verify     # what CI runs: format, lint, types, all tests with coverage
```

`node tests/e2e/stack.mjs` gives you a fake hub plus the built app if you do not have hardware
at hand.

## What a good pull request looks like

- **A test that fails without your change.** Coverage thresholds (85% lines, 82% branches) are
  enforced, but the real bar is whether the test would catch a regression.
- **Conventional Commit messages** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
  optionally scoped (`fix(server): …`). The changelog and the version number are generated from
  them, so this is not decoration.
- **Comments that explain why.** If a line needs a comment saying what it does, rename something
  instead.
- **The boy-scout rule.** Leave the file cleaner than you found it: delete dead exports, drop
  unused parameters, remove commented-out code. A pull request that only deletes things is
  welcome, provided the tests still pass.
- **No new dependency without a reason in the description.** This project deliberately has few.

## Things that will get pushed back

- Disabling a lint rule or a test rather than fixing the cause.
- Adding a control to the UI without gating it on the capability table — a dual-white bulb must
  never show a colour wheel.
- Bypassing `MilightHubClient` to talk to the hub directly. The serial queue exists because the
  ESP8266 drops concurrent requests.
- Putting device-specific units (mireds, 0–254 bytes) in the domain model. Those belong at the
  edges.

## Architecture

Read [docs/architecture.md](docs/architecture.md) before a larger change; it explains which
decisions are load-bearing and why.
