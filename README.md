# web-session-tracer

A tool that uses Puppeteer to automatically record user operations in a Chrome browser. Clicks, key presses, form submissions, page navigations, DOM changes, and network traffic are saved to one directory per operation.

## Features

- **User operations**: captures click / keydown / input / submit events
- **DOM changes**: records MutationObserver diffs, each with an importance level
- **Network traffic**: saves request, response, and finished events per operation
- **DOM snapshots**: saves the full DOM when the main frame navigates (optionally after every operation)
- **Screenshots**: optional PNGs before and after operations
- **Security**: masks the value and key presses of password fields as `***`
- **SPA support**: detects `pushState`-based navigation such as Vue Router and Next.js

> Recorded sessions can contain sensitive page content, request and response bodies, and typed values (only password fields are masked). Keep them private and do not commit them.

## Requirements

- Node.js (the version in [`.node-version`](.node-version); the code needs Node.js 22 or later)
- pnpm (the version is pinned in `package.json`)
- Chrome with the remote debugging port open

## Setup

```bash
pnpm install
```

## Usage

### 1. Start Chrome in remote debugging mode

```bash
/opt/google/chrome/chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-wst \
  --no-first-run
```

### 2. Start the tracer

```bash
pnpm start
```

The tracer connects to Chrome and starts a session. As you operate the browser, records accumulate in the `sessions/` directory. Stop it with `Ctrl+C` or by sending `SIGTERM`.

```
[Main] Connecting to Chrome: http://localhost:9222
[Main] Connected to Chrome
[SessionManager] Session started: session-20260223-020207294
[SessionManager] Output directory: /path/to/sessions/session-20260223-020207294
[PageTracer] Tracing started: https://example.com/
[Main] Tracing... (stop with Ctrl+C or SIGTERM)
```

### Running with Docker / docker compose

You can also run the tracer from a Docker image. Connecting to Chrome on the host requires `network_mode: host`.

```bash
# Build the image
docker build -t web-session-tracer .

# Start with docker compose (uses compose.yaml)
docker compose up
```

`compose.yaml` sets the following by default (see the file for the complete list):

```yaml
services:
  tracer:
    build: .
    network_mode: host        # connect to Chrome on the host (localhost:9222)
    volumes:
      - ./sessions:/sessions  # keep session data on the host
    environment:
      CHROME_URL: http://localhost:9222
      SESSION_DIR: /sessions
```

Chrome listens only on `127.0.0.1` by default, so the container has to share the host's network stack with `network_mode: host` to reach it.

To connect to Chrome on another host (started with `--remote-debugging-address=0.0.0.0`), override `CHROME_URL` with `docker compose run`. A shell variable is not enough, because `compose.yaml` sets `CHROME_URL` to a literal value:

```bash
docker compose run --rm -e CHROME_URL=http://192.168.1.10:9222 tracer
```

### 3. Inspect the records

```bash
ls sessions/session-*/ops/
```

See [`sessions/README.md`](sessions/README.md) for the details of the session files.

## Configuration (environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_URL` | `http://localhost:9222` | Chrome remote debugging URL |
| `SESSION_DIR` | `./sessions` | Where session data is stored |
| `NETWORK_BUFFER_SIZE` | `1000` | Maximum number of in-flight requests kept in memory (invalid or non-positive values fall back to the default) |
| `SCREENSHOT_ENABLED` | `false` | When `true`, saves screenshots before and after operations |
| `FULL_SNAPSHOT_ENABLED` | `false` | When `true`, saves a DOM snapshot after every user action as well (main-frame navigations are always snapshotted) |

Boolean variables are enabled only by the exact string `true`.

Example:

```bash
CHROME_URL=http://localhost:9222 SESSION_DIR=/data/sessions pnpm start
```

## Development

```bash
# Type check + lint + format check
pnpm lint

# Auto-fix
pnpm fix

# Watch mode (restarts on file changes)
pnpm dev
```

There is no test suite; `pnpm lint` is the only automated check.

## Architecture

```
Chrome
  ↓ Chrome DevTools Protocol (CDP)
SessionManager      - manages the whole session and attaches a PageTracer to each tab
  └── PageTracer    - records the operations of one page
        ├── injected script - captures click / keydown / input / submit and MutationObserver changes inside the browser
        ├── NetworkTracker  - collects network events over CDP
        └── SessionStorage  - writes the ops/ directories
```

## License

MIT
