# Session Data Format

This directory contains the browser sessions recorded by web-session-tracer.
One session is one run of the tracer: it covers every page (tab) of the connected Chrome from start to stop.

> **Note for AI readers**: This document describes the complete schema of the session files.
> Timestamps are ISO 8601 UTC strings.
> `*.jsonl` files hold one JSON object per line; `*.json` files hold a single pretty-printed JSON object (`metadata.json` is compact).
> Use `jq` to query and filter the data.

Only this `README.md` is tracked by Git. Recorded sessions (`sessions/session-*/`) are ignored and must never be committed, because they can contain sensitive page and network data.

---

## Directory Structure

```
sessions/
└── session-YYYYMMDD-HHmmssSSS/          # One directory per recording session (local time)
    ├── metadata.json                    # Session metadata (single JSON object)
    └── ops/                             # One subdirectory per recorded operation
        ├── ev000001-main-navigation/    # Page load or URL change in the main frame
        │   ├── event.json               # The triggering event
        │   ├── snapshot.json            # Full DOM snapshot
        │   ├── mutations.jsonl          # DOM mutations observed during this op (N lines)
        │   └── network.jsonl            # Network events during this op (N lines)
        ├── ev000002-main-click/         # User click in the main frame
        │   ├── event.json
        │   ├── mutations.jsonl
        │   ├── network.jsonl
        │   ├── before.png               # Screenshot before the click (SCREENSHOT_ENABLED=true only)
        │   └── after.png                # Screenshot after the click (SCREENSHOT_ENABLED=true only)
        ├── ev000003-main-keydown/       # Key press
        ├── ev000004-main-input/         # Input value change
        ├── ev000005-main-submit/        # Form submission
        └── ev000006-iframe-navigation/  # Navigation inside an iframe (event.json only)
```

### Operation directory naming

Directories are named `ev{6-digit-zero-padded-counter}-{frameType}-{type}`, where:

- `frameType` is `main` (the top frame) or `iframe` (a subframe).
- `type` is one of `navigation`, `click`, `keydown`, `input`, `submit`.

The counter is global across the session (all tabs share it) and increases monotonically with each recorded event, so sorting directory names gives the order in which events were recorded.

### What is written to which directory

- `mutations.jsonl` and `network.jsonl` are appended to the **current** operation directory at the time the event occurs: the latest user action, or the latest main-frame navigation if no action has happened since.
  Events that occur before any operation directory exists are discarded.
- `iframe` navigations get their own directory with only `event.json`; they do not become the current directory and get no snapshot.
- A page that is already open when the tracer starts is recorded as an initial `navigation` (unless it is `about:blank`).
- `mutations.jsonl` and `network.jsonl` only exist if at least one such event was recorded for the operation.

---

## File Formats

### `metadata.json`

Written once at session start.

```json
{"sessionId":"session-20260223-020207294","startTime":"2026-02-22T17:02:07.294Z","chromeUrl":"http://localhost:9222"}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Unique session identifier. Matches the directory name. |
| `startTime` | string | ISO 8601 UTC timestamp when the session started. |
| `chromeUrl` | string | Chrome remote debugging URL used for this session. |

---

### `event.json`

One JSON object per operation directory. It describes the triggering event.

#### Navigation event

Recorded when a frame navigates to a new URL, detected through Puppeteer's `framenavigated` event.
This covers both cross-document navigations and same-document history API transitions (`pushState` / `replaceState`).

```json
{
  "eventId": "session-20260223-020207294-ev000002",
  "sessionId": "session-20260223-020207294",
  "frameUrl": "https://vuejs.org/guide/introduction.html",
  "timestamp": "2026-02-22T17:02:18.930Z",
  "type": "navigation",
  "url": "https://vuejs.org/guide/introduction.html",
  "frameType": "main"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | string | Event ID, unique within the session. Its `evNNNNNN` suffix matches the directory name. |
| `sessionId` | string | Parent session ID. |
| `frameUrl` | string | URL associated with the event. For navigations, this is the destination URL. |
| `timestamp` | string | ISO 8601 UTC timestamp. |
| `type` | `"navigation"` | Discriminator field. |
| `url` | string | Destination URL. |
| `frameType` | `"main"` \| `"iframe"` | Whether the navigation happened in the main frame or in an iframe. |

#### User action event

Recorded when the user interacts with the page, captured by DOM event listeners (capture phase) injected into the page.

```json
{
  "eventId": "session-20260223-020207294-ev000004",
  "sessionId": "session-20260223-020207294",
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
| `frameUrl` | string | URL of the page's main frame when the event was saved, even if the action happened inside an iframe. The frame itself is recorded only in the directory name (`main` / `iframe`). |
| `action` | string | One of `"click"`, `"keydown"`, `"input"`, `"submit"`. |
| `tagName` | string | HTML tag name of the target element (uppercase). |
| `elementId` | string | `id` attribute of the target element. Empty string if absent. |
| `className` | string | `class` attribute of the target element. Empty string if absent. |
| `value` | string | Current value of the element for `input`. Always `""` for `click`, `keydown` and `submit`. Password fields are masked as `"***"`. |
| `key` | string? | Key name (`keydown` only, e.g. `"Enter"`, `"a"`). Password fields produce `"***"`. |
| `screenshotBefore` | string? | Path relative to the session directory, e.g. `ops/ev000002-main-click/before.png`. Only for `click` / `submit` with `SCREENSHOT_ENABLED=true`. |
| `screenshotAfter` | string? | Path relative to the session directory, e.g. `ops/ev000002-main-click/after.png`. Only with `SCREENSHOT_ENABLED=true`. |

`click` and `submit` are saved about 500 ms after they happen (and `timestamp` is taken at that time), so that the DOM mutations they cause are recorded in the same directory.

---

### `mutations.jsonl`

One line per MutationObserver callback batch. Each line is a JSON object holding all DOM changes reported in that batch.
It is absent for operations that produced no DOM mutations (for example, a click that triggered no UI change).

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
| `maxLevel` | 1 \| 2 \| 3 | Highest `level` among the changes in this batch. Use it for batch-level filtering. |
| `changes` | array | The individual DOM changes in this batch. |

#### Change-level fields (`changes[]`)

| Field | Type | Description |
|-------|------|-------------|
| `mutationType` | string | One of `"childList"`, `"attributes"`, `"characterData"`. |
| `targetPath` | string | XPath of the changed node (e.g. `/html[1]/body[1]/div[2]`). For text nodes, the XPath of the parent element. Empty string if it could not be resolved. |
| `level` | 1 \| 2 \| 3 | Significance level (see below). |
| `addedNodes` | string[]? | Node names of added children (`childList` only, present only if non-empty). May include `"#text"` and `"#comment"`. |
| `removedNodes` | string[]? | Node names of removed children (`childList` only, present only if non-empty). |
| `attributeName` | string? | Name of the changed attribute (`attributes` only). |
| `attributeValue` | string \| null? | Attribute value after the change (`attributes` only). `null` means the attribute was removed. |
| `oldValue` | string \| null? | Attribute value before the change (`attributes` only). |
| `characterData` | string? | New text content of the node (`characterData` only). |

#### Mutation significance levels

Each change carries a `level` (1 to 3) computed by heuristic rules, so you can filter afterwards without losing any raw data.
Rules are checked in this order.

| Level | Label | Criteria | Typical examples |
|-------|-------|----------|-----------------|
| **1** | noise | Changes inside `<head>`, or `childList` changes that add/remove only `SCRIPT`, `LINK`, `META`, `STYLE`, `NOSCRIPT` or `#comment` nodes | Script injection, stylesheet loading |
| **3** | significant | Changes to attributes that affect what the user sees: `class`, `style`, `hidden`, `disabled`, `value`, `checked`, `selected`, `open`, `src`, `href`, `alt`, `title` and any `aria-*`; or `childList` changes that add/remove at least one element node other than `SCRIPT`, `LINK`, `META`, `STYLE` and `NOSCRIPT` | Modal open/close, content replacement, SPA route change |
| **2** | minor | Everything else: `characterData` changes, `data-*` and other attribute changes, `#text`-only `childList` changes | Framework internal state, text node updates |

**Recommended jq recipes:**

```bash
# Show only batches that contain at least one significant change
jq 'select(.maxLevel >= 3)' mutations.jsonl

# Extract only significant changes from every batch
jq '{timestamp, changes: [.changes[] | select(.level == 3)]} | select(.changes | length > 0)' mutations.jsonl

# Count changes by level
jq -s '[.[].changes[].level] | group_by(.) | map({level: .[0], count: length})' mutations.jsonl

# Strip noise (level 1) and show the remaining changes
jq '{timestamp, maxLevel, changes: [.changes[] | select(.level >= 2)]} | select(.changes | length > 0)' mutations.jsonl
```

---

### `network.jsonl`

One line per CDP network event recorded while the operation was current.
Three event types are recorded for each HTTP request.
Failed loads (`Network.loadingFailed`) are not recorded.

Common fields:

| Field | Description |
|-------|-------------|
| `eventId` | `<epoch-ms>-<random>` identifier (not the session-prefixed form used by `event.json`). |
| `sessionId` | Parent session ID. |
| `frameUrl` | URL of the document that issued the request. Empty string for `network_response` / `network_finished` if the request itself was not observed. |
| `timestamp` | Wall-clock time (ISO 8601 UTC, millisecond precision) derived from the CDP `wallTime` of the request's `requestWillBeSent`. The response and finished events of a request use that request's own offset, or the latest known offset of the same CDP session if the request itself was not observed. If no reference is known yet (for example, requests already in flight when tracing started), the time the event was received by Node.js is recorded instead, so such events may deviate slightly from the true time. |
| `requestId` | CDP request ID. Use it to correlate request, response and finished events. |
| `url` | Request URL. Empty string for `network_finished` if the request was not observed. |

#### `network_request`

```json
{
  "eventId": "1740274800000-3vntbfc",
  "sessionId": "session-20260223-020207294",
  "frameUrl": "https://vuejs.org/",
  "timestamp": "2026-02-22T17:02:18.975Z",
  "type": "network_request",
  "requestId": "2773915.196",
  "url": "https://fonts.googleapis.com/css2?family=Inter",
  "method": "GET",
  "headers": { "Referer": "https://vuejs.org/" },
  "postData": "key=value"
}
```

| Field | Description |
|-------|-------------|
| `method` | HTTP method (`GET`, `POST`, etc.). |
| `headers` | Request headers as key-value pairs. |
| `postData` | Request body for POST/PUT (omitted if absent). Chrome returns at most 65536 bytes (`maxPostDataSize`). |

#### `network_response`

```json
{
  "type": "network_response",
  "requestId": "2773915.196",
  "url": "https://fonts.googleapis.com/css2?family=Inter",
  "status": 200,
  "mimeType": "text/css",
  "headers": { "content-type": "text/css; charset=utf-8" }
}
```

(`eventId`, `sessionId`, `frameUrl` and `timestamp` are omitted from this and the next example.)

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

### `snapshot.json`

A single pretty-printed JSON object: the raw response of the CDP `DOMSnapshot.captureSnapshot` call (with `computedStyles` empty), taken after the operation.
It is present in every main-frame `navigation` directory, and in the directory of every user action when `FULL_SNAPSHOT_ENABLED=true`.
It is absent if the capture failed.

It is typically large. For most analysis tasks, `mutations.jsonl` is more efficient.

---

### `before.png` / `after.png`

PNG screenshots, present only when the tracer was started with `SCREENSHOT_ENABLED=true`.

- `before.png`: taken immediately before the action (`click` and `submit` only).
- `after.png`: taken after the action (all user action types; for `click` / `submit` after the 500 ms wait).

---

## Querying with jq

Run these from inside a session directory.

### Reconstruct the event timeline

```bash
jq -s 'sort_by(.timestamp)[] | {timestamp, type: (.action // .type), url: (.url // .frameUrl)}' ops/*/event.json
```

### Find all clicks

```bash
jq '{timestamp, tagName, elementId, className}' ops/*-click/event.json
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
cat ops/*/network.jsonl | jq -r 'select(.type == "network_response") | .mimeType' | sort | uniq -c | sort -rn
```

### Correlate requests with their responses

```bash
jq -s 'group_by(.requestId)[] | {requestId: .[0].requestId, url: .[0].url, events: map(.type)}' ops/ev000001-main-navigation/network.jsonl
```
