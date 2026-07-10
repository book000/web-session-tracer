# Copilot code review instructions

`web-session-tracer` is a TypeScript (`tsx` + `puppeteer-core`) tool that
connects to a running Chrome over the DevTools Protocol and records user
operations, DOM mutations, network traffic, and DOM snapshots into
`sessions/`. Use these notes when reviewing pull requests.

## Priorities

- **Credential masking is a hard requirement.** In `src/injected-script.ts`,
  `type="password"` fields must have their `value` and `key` replaced with
  `***` before the event is sent to Node. Flag any change to event capture
  that could let raw password values or keystrokes reach `SessionStorage`.
- **Do not log or persist sensitive values.** Recorded `value`, network
  request/response bodies, and DOM content can contain secrets. Flag new
  logging that prints captured field values or full request bodies.
- **Fail-soft in the browser context.** Code injected into the page must not
  throw in a way that breaks the traced page. Event sending is wrapped in a
  `try/catch` and guards `typeof window.__wstEvent === 'function'`; flag
  removal of these guards.
- **Async cleanup and shutdown.** `SessionManager`/`PageTracer` manage per-tab
  lifecycles and a graceful shutdown on SIGINT/SIGTERM. Flag missing
  `await`/error handling on `stop()` paths, listeners added without matching
  removal, or event-ID generation moved out of `SessionStorage.nextEventId()`
  (IDs are shared across tabs and must stay centralized).

## Conventions enforced by tooling

- Formatting is enforced by Prettier (`.prettierrc.yml`: no semicolons, single
  quotes, `es5` trailing commas, 80-col) and linting by ESLint
  (`@book000/eslint-config`). Do not raise style/formatting nits that these
  tools already own; assume `pnpm lint` (`prettier --check`, `eslint`, `tsc`)
  gates the PR.
- TypeScript is `strict` with `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns`. Prefer flagging real type-safety regressions (new
  `any`, unchecked casts) over cosmetic issues.

## Known patterns — do NOT flag

- `src/injected-script.ts` is a **string** of browser-side JS type-checked via
  JSDoc + `checkJs`. `var`, `function` declarations, and non-null-ish DOM
  casts there are intentional (browser compatibility), not Node style
  violations.
- Scoped `// eslint-disable-next-line <rule>` comments (e.g.
  `unicorn/no-process-exit` in `src/main.ts`) are intentional.
- Comments and `console.log` messages are in Japanese by project convention;
  do not request English translations.
- There is no test suite; do not request that PRs add or update unit tests.

## Commits

Commit messages use Conventional Commits with Japanese descriptions.
