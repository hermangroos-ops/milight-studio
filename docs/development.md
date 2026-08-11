# Development

## Getting set up

Requirements: Node 22.11+ and pnpm 10 (`corepack enable` gives you the pinned version).

```bash
pnpm install
pnpm run build          # builds the packages, the server and the web bundle
pnpm run dev            # server on :8080 with reload, Vite dev server on :5173
```

`pnpm run dev` runs the API and the UI in parallel; the Vite dev server proxies `/api` (and the
WebSocket) to the API, so open <http://localhost:5173>.

Point it at a hub with `MILIGHT_HUB_URL`. If you do not have one at hand, the e2e stack includes
a fake:

```bash
node tests/e2e/stack.mjs   # fake hub on :8099, API + built UI on :8080
```

## Layout

```
packages/shared           domain model, Zod schemas, colour maths        ← no dependencies
packages/milight-client   typed hub client, serial queue, translation
apps/server               Fastify API, services, persistence, bridges
apps/web                  React 19 progressive web app
tests/e2e                 Playwright specs + the stack script
tests/load                k6 profiles
```

Dependencies point one way only. If you find yourself wanting the server from `shared`, the
abstraction is in the wrong place.

## The one command that matters

```bash
pnpm run verify     # format:check + lint + typecheck + every vitest project with coverage
```

CI runs exactly this, plus Playwright, plus the container build. If `verify` is green locally,
CI is very unlikely to surprise you.

## Test strategy

Nine layers, each answering a question the others cannot.

| Layer         | Command                          | Question it answers                                                                                 |
| ------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unit          | `pnpm run test:unit`             | Is the maths right? Does the translator drop what a protocol cannot do?                             |
| Integration   | `pnpm run test:integration`      | Against a real HTTP hub: do retries, request serialisation, persistence and the WebSocket behave?   |
| API contract  | `pnpm run test:api`              | Are status codes, error envelopes and response shapes what the OpenAPI document promises?           |
| UI            | `pnpm run test -- --project web` | Do components render the right controls and call the right commands?                                |
| End-to-end    | `pnpm run test:e2e`              | Does a real browser, driving the real UI against the real server, produce the right radio commands? |
| Accessibility | part of `test:e2e`               | Zero axe violations on every screen, and can you do it all from the keyboard?                       |
| Mutation      | `pnpm run test:mutation`         | Would the tests actually notice if the code were wrong?                                             |
| Load          | `pnpm run test:load`             | Does dragging a slider while Alexa polls keep latency sane?                                         |
| Security      | CI                               | CodeQL, Semgrep, `pnpm audit`, gitleaks, Trivy on the image                                         |

Some conventions that keep the suite trustworthy:

- **No real time and no real network.** Services take an injectable `Clock` and id generator;
  the hub client takes an injectable `fetch` and `sleep`. Tests that need a hub use the fake in
  `apps/server/tests/helpers/fake-hub-server.ts`, which is a real HTTP server on an ephemeral
  port — so the retry logic is exercised for real, deterministically.
- **Assert against the shared schemas.** API tests run `lightWithStateSchema.parse(body)` rather
  than hand-written expectations, so the contract cannot drift without a test noticing.
- **One test guards the docs.** An API test asserts that every registered route appears in the
  generated OpenAPI document with a summary and a documented success response.
- **Accessible locators only in e2e.** `getByRole`/`getByLabel`, never a CSS class. If a test
  cannot find a control by its accessible name, neither can a screen reader.

Mutation testing runs nightly rather than per-push — it takes minutes, not seconds. The break
thresholds are set just under the current score; raise them when you improve the suite.

## Adding a bulb protocol

1. Add the id to `REMOTE_TYPES` and a profile to `REMOTE_TYPE_PROFILES` in
   `packages/shared/src/remote-types.ts` — capabilities, group range, brightness mode, effects.
2. Extend `buildHubCommandBody` and `applyCommandToState` in
   `packages/milight-client/src/translate.ts` if the protocol needs anything special.
3. Add it to the device-type mapping in `apps/server/src/bridges/matter/device-mapping.ts`.
4. Tests are table-driven over `REMOTE_TYPES`, so several will fail until the new entry is
   handled everywhere. That is the point.

The UI needs no change: it renders from the capability table.

## Commits and releases

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(web): add a colour-temperature preset row
fix(server): keep group membership when renaming a group
docs(alexa): explain the Matter endpoint limit
chore(deps): bump fastify to 5.7.0
```

`release-please` reads them, opens a release PR with a generated changelog, and on merge tags
the release and publishes a multi-arch image to `ghcr.io`. `feat` bumps the minor, `fix` the
patch, and a `!` or `BREAKING CHANGE:` footer bumps the major. Nothing is released by hand.

A pre-commit hook runs ESLint and Prettier on staged files. `git commit --no-verify` skips it,
but CI will not.

## Boy-scout rule

Leave the code cleaner than you found it. Concretely: if you touch a file with a dead export,
delete it. If a comment explains _what_ the line does, replace it with one that explains _why_,
or delete it. If you add a branch, add the test that would fail without it. Removing code is a
legitimate pull request, provided the tests still pass.
