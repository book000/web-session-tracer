# AGENTS.md

Guidance for AI coding agents and contributors. `CLAUDE.md` imports this file, and `.github/copilot-instructions.md` adds the review checklist.

## Language

- All deliverables are written in **English**: commit messages, PR/Issue titles and bodies, review comments, code comments and docstrings, and documentation (`README.md`, `sessions/README.md`, `AGENTS.md`, etc.).
- Exceptions (keep as is): quotations, technical identifiers, generated files, and external source text.
- Runtime messages (logs, errors) are English.
- Do not rewrite Git history to change the language of past commits.

## Overview

`web-session-tracer` connects to an already running Chrome over the Chrome DevTools Protocol (via `puppeteer-core`) and records user operations: click / keydown / input / submit, DOM mutations, network traffic, and DOM snapshots. Each operation is written to its own directory under `sessions/`. It is a CLI tool with no test suite; it is run manually against a live Chrome.

## Commands

```bash
pnpm install   # install dependencies (other package managers are rejected by preinstall)
pnpm start     # run the tracer (tsx ./src/main.ts)
pnpm dev       # watch mode (tsx watch)
pnpm lint      # prettier --check src + eslint + tsc; this is what CI runs
pnpm fix       # prettier --write src, then eslint --fix
```

There is no build step: `tsx` runs the TypeScript directly, and the Docker image also runs `pnpm start`. Node.js is pinned in `.node-version` (CI reads it) and pnpm in `package.json`.

## Structure

```
src/main.ts                    entry point: connects to Chrome, handles SIGINT/SIGTERM
src/config.ts                  reads all runtime config from environment variables
src/types.ts                   shared event/record types
src/storage.ts                 SessionStorage: writes the session directory and allocates event IDs
src/injected-script.ts         browser-side script, returned as a string
src/tracer/session-manager.ts  one run = one session; attaches a PageTracer per tab
src/tracer/page-tracer.ts      per-page recording
src/tracer/network-tracker.ts  collects network events over CDP
src/tracer/mutation-level.ts   classifies DOM change importance (levels 1 to 3)
sessions/README.md             schema of the recorded session files
```

Key facts to preserve when editing:

- `injected-script.ts` returns a **string** of browser-side JavaScript. It is not run in Node and not type-checked by `tsc`, so `var` and plain functions there are intentional. It removes the handlers and observer of a previous injection (`window.__wstHandlers` / `window.__wstObserver`) so repeated injections do not stack listeners.
- Event IDs are allocated centrally by `SessionStorage.nextEventId()` because multiple tabs share one storage; do not generate IDs per page.
- CDP `Network.*` event `timestamp` values are `MonotonicTime` (a monotonic clock), not Unix time. `NetworkTracker` converts them with the `wallTime - timestamp` offset taken from `requestWillBeSent`; never use `new Date(timestamp * 1000)`.
- Operation directories are named `ev<6-digit>-<frameType>-<type>` (e.g. `ev000001-main-navigation`). `event.json` and `snapshot.json` are pretty-printed JSON; `mutations.jsonl` and `network.jsonl` are append-only JSONL.

## Conventions

- TypeScript `strict` with `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns`. Imports inside the project are relative; the `@/*` alias in `tsconfig.json` is currently unused.
- Formatting is owned by Prettier (`.prettierrc.yml`: no semicolons, single quotes, `es5` trailing commas, 80 columns); run `pnpm fix` instead of hand-formatting. ESLint uses `@book000/eslint-config`; silence a rule only with a scoped `// eslint-disable-next-line <rule>` plus a reason, as `unicorn/no-process-exit` in `main.ts` does.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/); branches follow [Conventional Branch](https://conventional-branch.github.io) short form (`feat/...`, `fix/...`).
- Do not commit to Renovate PRs.

## Security

- **Password masking must be preserved.** In `injected-script.ts`, the `value` and `key` of `type="password"` fields are replaced with `***` before the event leaves the browser. Any change to event capture must keep this intact; otherwise recorded sessions leak credentials in plain text.
- Recorded sessions can contain sensitive page and network data. Never commit anything under `sessions/` except `sessions/README.md` (`.gitignore` excludes `sessions/session-*/`).
- Never commit secrets.

## Verification

No automated tests exist. To verify a change, start Chrome with `--remote-debugging-port=9222`, run `pnpm start`, operate the browser, and inspect `sessions/session-*/ops/`. Always run `pnpm lint` before committing; it is the only automated gate.

## Documentation update rules

- Env var changes in `src/config.ts`: update the table in `README.md` and the `ENV` lines in `Dockerfile`.
- Changes to the on-disk session format (`src/storage.ts`, `src/types.ts`): update `sessions/README.md`, whose schema is consumed by downstream and AI readers.
- Command or architecture changes: update this file and `README.md`.
