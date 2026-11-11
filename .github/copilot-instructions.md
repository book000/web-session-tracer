# Copilot code review instructions

Follow [`AGENTS.md`](../AGENTS.md) for the project overview, structure, and conventions. This file lists what to check when reviewing pull requests.

## Language

Deliverables (commit messages, PR text, review comments, code comments, documentation) and runtime messages are written in English. Do not request translations of quotations, technical identifiers, or generated files.

## Priorities

- **Credential masking is a hard requirement.** In `src/injected-script.ts`, `type="password"` fields must have their `value` and `key` replaced with `***` before the event is sent to Node. Flag any change that could let raw password values or keystrokes reach `SessionStorage`.
- **Do not log or persist sensitive values.** Captured values, network request/response bodies, and DOM content can contain secrets. Flag new logging that prints captured field values or full request bodies, and anything that would put recorded sessions under version control.
- **Fail-soft in the browser context.** Injected code must not throw in a way that breaks the traced page. Event sending is wrapped in `try/catch` and guards `typeof window.__wstEvent === 'function'`; flag removal of these guards.
- **Async cleanup and shutdown.** `SessionManager` / `PageTracer` manage per-tab lifecycles and a graceful shutdown on SIGINT/SIGTERM. Flag missing `await` or error handling on `stop()` paths, and listeners added without matching removal.
- **Centralized event IDs.** IDs are shared across tabs and must come from `SessionStorage.nextEventId()`.
- **Documentation stays in sync.** Env var changes need updates to `README.md` and `Dockerfile`; session format changes need updates to `sessions/README.md`.

## Do not flag

- Style and formatting that Prettier and ESLint already own; assume `pnpm lint` gates the PR.
- `src/injected-script.ts` is a string of browser-side JavaScript: `var` and function declarations there are intentional.
- Scoped `// eslint-disable-next-line <rule>` comments with a reason.
- The absence of tests; there is no test suite.
