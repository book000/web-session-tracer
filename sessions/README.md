# Session Data Format

This directory contains recorded browser sessions captured by web-session-tracer.
Each session represents a continuous recording period with a single Chrome instance.

> **Note for AI readers**: This document describes the complete data schema for session files.
> All files use newline-delimited JSON (JSONL) or plain JSON. Timestamps are ISO 8601 UTC.
> Use `jq` to query and filter the data efficiently.

---

## Directory Structure

```
sessions/
└── session-YYYYMMDD-HHmmss/        # One directory per recording session
    ├── metadata.json               # Session metadata (single JSON object)
    └── ops/                        # One subdirectory per recorded operation
        ├── ev000001-navigation/    # Page load or URL change
        │   ├── event.jsonl         # The triggering event (1 line)
        │   ├── snapshot.jsonl      # Full DOM snapshot (navigation only, 1 line)
        │   ├── mutations.jsonl     # DOM mutations observed during this op (N lines)
        │   └── network.jsonl       # Network events during this op (N lines)
        ├── ev000002-click/         # User click
        │   ├── event.jsonl
        │   ├── mutations.jsonl
        │   ├── network.jsonl
        │   ├── before.png          # Screenshot before click (SCREENSHOT_ENABLED=true only)
        │   └── after.png           # Screenshot after click (SCREENSHOT_ENABLED=true only)
        ├── ev000003-keydown/       # Key press
        ├── ev000004-input/         # Input value change
        └── ev000005-submit/        # Form submission
```

### Operation directory naming

Directories are named `ev{6-digit-zero-padded-counter}-{type}`, where `type` is one of:
`navigation`, `click`, `keydown`, `input`, `submit`.

Operations are strictly ordered by their zero-padded counter. The counter is global across
the session and increments monotonically with each recorded event.

---

## File Formats

### `metadata.json`

Recorded once at session start. Contains session-level metadata.

```json
{
  "sessionId": "session-20260223-020207",
  "startTime": "2026-02-22T17:02:07.294Z",
  "chromeUrl": "http://localhost:9204"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Unique session identifier. Matches the directory name. |
| `startTime` | string | ISO 8601 UTC timestamp when the session started. |
| `chromeUrl` | string | Chrome remote debugging URL used for this session. |

---

### `event.jsonl`

One line per operation directory. Describes the triggering event.

#### Navigation event

Emitted when the main frame or an iframe navigates to a new URL, including SPA
history-API transitions (`pushState` / `replaceState`).

```json
{
  "eventId": "session-20260223-020207-ev000002",
  "sessionId": "session-20260223-020207",
  "frameUrl": "https://vuejs.org/guide/introduction.html",
  "timestamp": "2026-02-22T17:02:18.930Z",
  "type": "navigation",
  "url": "https://vuejs.org/guide/introduction.html",
  "frameType": "main"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | string | Globally unique event ID within the session. |
| `sessionId` | string | Parent session ID. |
| `frameUrl` | string | `window.location.href` of the frame at the moment the event was recorded. |
| `timestamp` | string | ISO 8601 UTC timestamp. |
| `type` | `"navigation"` | Discriminator field. |
| `url` | string | Destination URL. |
| `frameType` | `"main"` \| `"iframe"` | Whether the navigation happened in the main frame or an iframe. |

#### User action event

Emitted when the user interacts with the page. Captured via DOM event listeners
injected into the page.

```json
{
  "eventId": "session-20260223-020207-ev000004",
  "sessionId": "session-20260223-020207",
  "frameUrl": "https://vuejs.org/",
  "timestamp": "2026-02-22T16:54:43.306Z",
  "type": "user_action",
  "action": "click",
  "tagName": "SPAN",
  "elementId": "",
  "className": "DocSearch-Button-Placeholder",
  "value": ""
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"user_action"` | Discriminator field. |
| `action` | string | One of `"click"`, `"keydown"`, `"input"`, `"submit"`. |
| `tagName` | string | HTML tag name of the target element (uppercase). |
| `elementId` | string | `id` attribute of the target element. Empty string if absent. |
| `className` | string | `class` attribute of the target element. Empty string if absent. |
| `value` | string | Current value of the element (for `input`/`submit`). Always `""` for `click`. Password fields are masked as `"***"`. |
| `key` | string? | Key name (for `keydown` only, e.g. `"Enter"`, `"a"`). Password fields produce `"***"`. |
| `screenshotBefore` | string? | Relative path to pre-action screenshot within the session dir. Only present when `SCREENSHOT_ENABLED=true`. |
| `screenshotAfter` | string? | Relative path to post-action screenshot. Only present when `SCREENSHOT_ENABLED=true`. |

---

### `mutations.jsonl`

One line per MutationObserver callback batch. Each line is a JSON object containing
all DOM changes observed in that micro-task batch.

**Not present** for operation types that produced no DOM mutations (e.g., a click that
triggered no UI change).

```json
{
  "timestamp": "2026-02-22T17:02:18.980Z",
  "maxLevel": 3,
  "changes": [
    {
      "mutationType": "attributes",
      "targetPath": "/html[1]",
      "level": 3,
      "attributeName": "class",
      "attributeValue": "prefer-composition prefer-sfc",
      "oldValue": null
    },
    {
      "mutationType": "childList",
      "targetPath": "/html[1]/head[1]",
      "level": 1,
      "addedNodes": ["SCRIPT"]
    }
  ]
}
```

#### Record-level fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 UTC timestamp when the batch was received by Node.js. |
| `maxLevel` | 1 \| 2 \| 3 | Maximum `level` value among all changes in this batch. Use for batch-level filtering. |
| `changes` | array | List of individual DOM changes in this batch. |

#### Change-level fields (`changes[]`)

| Field | Type | Description |
|-------|------|-------------|
| `mutationType` | string | One of `"childList"`, `"attributes"`, `"characterData"`. |
| `targetPath` | string | XPath of the changed node (e.g. `/html[1]/body[1]/div[2]`). Empty string for document-level changes. |
| `level` | 1 \| 2 \| 3 | Significance level (see below). |
| `addedNodes` | string[]? | Tag names of added child nodes (`"childList"` only). May include `"#text"`, `"#comment"`. |
| `removedNodes` | string[]? | Tag names of removed child nodes (`"childList"` only). |
| `attributeName` | string? | Name of the changed attribute (`"attributes"` only). |
| `attributeValue` | string \| null \| undefined | New attribute value after the change (`"attributes"` only). `null` means the attribute was removed. |
| `oldValue` | string \| null \| undefined | Previous attribute value (`"attributes"` only). |
| `characterData` | string? | New text content of the node (`"characterData"` only). |

#### Mutation significance levels

Each change carries a `level` field (1–3) computed by heuristic rules, allowing
post-hoc filtering without losing any raw data.

| Level | Label | Criteria | Typical examples |
|-------|-------|----------|-----------------|
| **1** | noise | `<head>` mutations; additions/removals of `SCRIPT`, `LINK`, `META`, `STYLE`, `NOSCRIPT`, `#comment` nodes only | Script injection, stylesheet loading |
| **2** | minor | `characterData` changes; `data-*` attribute changes; `#text`-only `childList` changes; other non-UI attributes | Framework internal state, text node updates |
| **3** | significant | `class`, `style`, `hidden`, `disabled`, `aria-*` attribute changes; element additions/removals in `<body>` | Modal open/close, content replace, SPA route change |

**Recommended jq recipes:**

```bash
# Show only batches that contain at least one significant change
jq 'select(.maxLevel >= 3)' mutations.jsonl

# Extract only significant changes from every batch
jq '{timestamp, changes: [.changes[] | select(.level == 3)]} | select(.changes | length > 0)' mutations.jsonl

# Count changes by level
jq '[.changes[].level] | group_by(.) | map({level: .[0], count: length})' mutations.jsonl

# Strip noise (level 1) and show remaining
jq '{timestamp, maxLevel, changes: [.changes[] | select(.level >= 2)]} | select(.changes | length > 0)' mutations.jsonl
```

---

### `network.jsonl`

One line per CDP network event captured during the operation window. Three event
types are recorded for each HTTP request.

**Note**: `frameUrl` may be a CDP internal hash string rather than a URL for requests
that were already in-flight when the operation began.

#### `network_request`

```json
{
  "eventId": "session-20260223-020207-ev000002-3vntbfc",
  "sessionId": "session-20260223-020207",
  "frameUrl": "https://vuejs.org/",
  "timestamp": "2026-02-22T17:02:18.975Z",
  "type": "network_request",
  "requestId": "2773915.196",
  "url": "https://fonts.googleapis.com/css2?family=Inter",
  "method": "GET",
  "headers": { "Referer": "https://vuejs.org/", "..." : "..." },
  "postData": "key=value"
}
```

| Field | Description |
|-------|-------------|
| `requestId` | CDP request ID. Use to correlate request → response → finished events. |
| `url` | Request URL. |
| `method` | HTTP method (`GET`, `POST`, etc.). |
| `headers` | Request headers as key-value pairs. |
| `postData` | Request body for POST/PUT (omitted if absent). |

#### `network_response`

```json
{
  "type": "network_response",
  "requestId": "2773915.196",
  "url": "https://fonts.googleapis.com/css2?family=Inter",
  "status": 200,
  "mimeType": "text/css",
  "headers": { "content-type": "text/css; charset=utf-8", "...": "..." }
}
```

| Field | Description |
|-------|-------------|
| `status` | HTTP status code. |
| `mimeType` | Response MIME type. |
| `headers` | Response headers. |

#### `network_finished`

```json
{
  "type": "network_finished",
  "requestId": "2773915.196",
  "url": "https://fonts.googleapis.com/css2?family=Inter",
  "encodedDataLength": 38696
}
```

| Field | Description |
|-------|-------------|
| `encodedDataLength` | Total bytes transferred (encoded / compressed). |

---

### `snapshot.jsonl`

One line. Present **only** in `navigation` operation directories. Contains the full
DOM snapshot captured immediately after the page settled, using the CDP
`DOMSnapshot.captureSnapshot` API. The structure is a raw CDP response object.

This is typically a large object. For most analysis tasks, `mutations.jsonl` is
more efficient.

---

### `before.png` / `after.png`

PNG screenshots. Only present when the tracer was started with `SCREENSHOT_ENABLED=true`.

- `before.png`: Captured immediately before the user action (available for `click` and `submit`).
- `after.png`: Captured after the action settled (available for all user action types).

---

## Querying with jq

### Reconstruct the event timeline

```bash
# Print all events in order across all ops
for f in ops/*/event.jsonl; do cat "$f"; done | jq -s 'sort_by(.timestamp)[] | {timestamp, type: (.type // .action), url: (.url // .frameUrl)}'
```

### Find all clicks

```bash
for f in ops/*-click/event.jsonl; do cat "$f"; done | jq '{timestamp, tagName, elementId, className}'
```

### Find significant DOM changes after clicks

```bash
for d in ops/*-click; do
  echo "=== $d ==="
  jq 'select(.maxLevel >= 3) | {timestamp, changes: [.changes[] | select(.level == 3) | {mutationType, targetPath, attributeName, addedNodes}]}' "$d/mutations.jsonl" 2>/dev/null
done
```

### Summarize network activity by MIME type

```bash
for f in ops/*/network.jsonl; do cat "$f"; done | jq -r 'select(.type == "network_response") | .mimeType' | sort | uniq -c | sort -rn
```

### Correlate a request with its response

```bash
jq -s 'group_by(.requestId)[] | {requestId: .[0].requestId, url: .[0].url, events: map(.type)}' ops/ev000002-navigation/network.jsonl
```
