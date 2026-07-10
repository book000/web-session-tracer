# CLAUDE.md

## Project overview

`web-session-tracer` connects to an already-running Chrome instance over the
Chrome DevTools Protocol (via `puppeteer-core`) and records user operations:
click / keydown / input / submit, DOM mutations, network traffic, and DOM
snapshots. Each operation is written to its own directory under `sessions/`.
This is a CLI/daemon tool with no test suite; it is run manually against a
live Chrome.

## Development commands

- `pnpm start` — run the tracer (`tsx ./src/main.ts`).
- `pnpm dev` — watch mode; restarts on file change (`tsx watch`).
- `pnpm lint` — the full gate: `lint:prettier`, `lint:eslint`, `lint:tsc`
  (Prettier check + ESLint + `tsc` type check). This is what CI runs.
- `pnpm fix` — auto-fix: `fix:prettier` then `fix:eslint`.

There is no build step in normal use (`tsx` runs the TypeScript directly);
the Docker image also runs via `pnpm start`.

## Package manager & runtime

- **pnpm only.** `preinstall` runs `only-allow pnpm`; do not use `npm` or
  `yarn`. Version is pinned in `package.json` `packageManager`.
- Node.js version is pinned in `.node-version` (currently 24.x). CI reads it
  from that file.

## Architecture

```
main.ts            entry point; connects to Chrome, wires signals, shutdown
 └ SessionManager  one run = one session; attaches a PageTracer per page/tab
    └ PageTracer    per-page recording; owns the three sources below
       ├ injected-script.ts  runs INSIDE the browser (returned as a string):
       │                     event listeners + MutationObserver -> __wstEvent()
       ├ NetworkTracker      collects network events over CDP
       └ SessionStorage (storage.ts)  writes ops/ directories to disk
 config.ts          reads all runtime config from environment variables
 types.ts           shared event/record type definitions
 tracer/mutation-level.ts  classifies mutation importance
```

Key facts to preserve when editing:

- `injected-script.ts` returns a **string** of browser-side JS. It is not run
  in Node; it is `checkJs`-linted with JSDoc types. It re-installs handlers on
  every injection and removes the previous ones via `window.__wstHandlers` /
  `window.__wstObserver` so multiple sessions don't stack listeners.
- Event IDs are allocated centrally by `SessionStorage.nextEventId()` because
  multiple tabs share one storage; do not generate IDs per-page.
- Op directory names are `ev<6-digit>-<frameType>-<type>` (e.g.
  `ev000001-main-navigation`). `event.json`/`snapshot.json` are pretty JSON;
  `mutations.jsonl`/`network.jsonl` are append-only JSONL.

## Coding conventions

- TypeScript `strict` with `noUnusedLocals`/`noUnusedParameters`/
  `noImplicitReturns`. Intra-project imports are relative (e.g. `./types`,
  `./tracer/session-manager`); the `@/*` alias is defined in `tsconfig.json`
  but currently unused, so keep using relative imports to match existing files.
- Formatting is owned by Prettier (`.prettierrc.yml`): no semicolons, single
  quotes, `es5` trailing commas, 80-col width. Do not hand-format against it;
  run `pnpm fix`.
- ESLint config is `@book000/eslint-config`. Silence a rule only with a
  scoped `// eslint-disable-next-line <rule>` plus reason, as existing code
  does (e.g. `unicorn/no-process-exit` in `main.ts`).
- Comments and log messages are written in Japanese, matching the codebase.

## Security

- **Password masking must be preserved.** In `injected-script.ts`, fields with
  `type="password"` have their `value` and `key` replaced with `***` before
  the event leaves the browser. Any change touching event capture must keep
  masking intact — recorded sessions are otherwise plaintext credential leaks.
- Sessions may contain sensitive page/network data. Never commit anything
  under `sessions/` except the checked-in `sessions/README.md`.

## Testing / verification

No automated tests exist. To verify a change: start Chrome with
`--remote-debugging-port=9222`, run `pnpm start`, perform operations in the
browser, and inspect the resulting `sessions/session-*/ops/` output. Always
run `pnpm lint` before committing — it is the only automated gate.

## Git conventions

- Commit messages follow Conventional Commits with a **Japanese** description
  (matching existing history), e.g. `fix: ...`, `feat: ...`, `chore(deps): ...`.

## Documentation update rules

- Env var changes in `config.ts` → update the table in `README.md` and the
  `ENV` lines in `Dockerfile`.
- Changes to the on-disk session format (`storage.ts`) → update
  `sessions/README.md` (its schema is consumed by downstream/AI readers).
- Architecture or command changes → update this file.
