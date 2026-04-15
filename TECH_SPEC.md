# Event Frequency Recorder — Technical Spec

Companion to [`PRD.md`](./PRD.md). This doc describes *how* to build it; the
PRD defines *what* to build. Where the two disagree, the PRD wins.

## Overview

A static single-page web app (no backend, no build step) that records binary
events and visualizes P(positive) across a 7-day × 4-block grid. Data is
persisted entirely on-device via IndexedDB. Credentials for optional
Telegram-based sync live in a separate IndexedDB object store, so snapshots
sent to Telegram only ever contain events — never the bot token or chat ID.
The app is served as plain HTML, CSS, and ES modules; any static host (or
`python -m http.server`) will run it.

## Tech stack

- **Frontend**: plain HTML + CSS + ES modules. No bundler, no transpiler, no
  framework. Loaded directly by the browser via `<script type="module">`.
- **Storage**: **IndexedDB** via a tiny hand-rolled promise wrapper around
  `indexedDB.open('eventtracker', 1)`. No third-party dependency (no idb,
  no Dexie). `init()` also calls `navigator.storage.persist()` to request
  persistent storage; a rejection is logged and ignored.
- **Sync (optional)**: Direct `fetch` against `https://api.telegram.org/`.
  No proxy, no backend. Multipart JSON snapshot upload via `sendDocument`;
  pull via `getUpdates` + `getFile`.
- **Testing**: Node's built-in `node:test` runner. `fake-indexeddb` is a
  dev-only dependency used by `test/db.test.js` to exercise the exact same
  `db.js` module in Node. `test/sync.test.js` uses a stubbed `fetch` to
  exercise `sync.js` and the pure `mergeSnapshots` helper.

### Browser support

IndexedDB is available in every browser EventTracker targets (Chromium,
Firefox, Safari, Brave — desktop and Android). If `indexedDB.open` rejects
(rare: strict private-mode policies on some browsers), `db.init()` throws a
tagged `StorageUnavailableError` and `app.js` surfaces the error screen
described in [Error state](#error-state). No in-memory fallback — losing
data silently would be worse than failing loudly.

### Deployment

The app is deployed to **GitHub Pages** (branch-deploy from `master`) at
`https://vweaver.github.io/EventTracker/`. GitHub Pages serves static files
only; no custom headers. That is fine: IndexedDB needs no special headers,
no cross-origin isolation, no SharedArrayBuffer. The previous implementation
used `sqlite-wasm` with the `opfs-sahpool` VFS, which broke on Brave Android
in practice — hence the pivot to IndexedDB.

## File layout

```
/index.html                # single page, four views: Log / List / Grid / Settings
/app.js                    # view routing + event handlers (only file touching DOM)
/db.js                     # IndexedDB init + CRUD + settings access
/aggregate.js              # pure functions: bucket mapping, P(positive) calc
/sync.js                   # pure network layer for Telegram + mergeSnapshots
/styles.css                # mobile-first styles
/manifest.webmanifest      # PWA manifest (installable on Android)
/assets/icon.svg           # app icon (referenced by manifest; SVG for crisp sizing)
/test/
  aggregate.test.js        # node:test — pure logic
  db.test.js               # node:test — CRUD against fake-indexeddb
  sync.test.js             # node:test — mergeSnapshots + fetch stub
/package.json              # dev-only: fake-indexeddb, test script
```

Rationale: one module per responsibility. `aggregate.js` and `sync.js` are
pure and trivially testable. `db.js` owns all storage. `app.js` is the only
module that touches the DOM.

## Data model

Two IndexedDB object stores, both on database `eventtracker` (version 1):

- `events` — `{ keyPath: 'id', autoIncrement: true }`, with a single index
  `by_timestamp` on the `timestamp` field. Each record:

  ```js
  { id: number, timestamp: string, value: 0 | 1 }
  ```

  - `timestamp` is a naive ISO-8601 string (`YYYY-MM-DDTHH:MM:SS`) produced
    from the device clock. Per the PRD, timezones are out of scope.
  - `value` is normalized to `0` / `1` at the storage boundary.

- `settings` — `{ keyPath: 'key' }`. Each record: `{ key: string, value: any }`.
  Used for the Telegram bot token, chat ID, and the `deviceTag` (a short
  random suffix tagged onto outgoing snapshot captions so the user can tell
  devices apart in their Telegram chat).

The two stores are deliberately separate: `exportAll()` only touches
`events`, so credentials cannot leak into a pushed snapshot.

## CRUD API (`db.js`)

All functions are `async`. The module exports:

| Function                           | Returns          | Notes                                        |
| ---------------------------------- | ---------------- | -------------------------------------------- |
| `init()`                           | `void`           | Opens IndexedDB, creates stores/indexes, requests persistent storage. |
| `insertEvent(timestamp, value)`    | `id: number`     | `value` coerced to 0/1.                      |
| `updateEvent(id, timestamp, value)`| `void`           | Full replace of both fields.                 |
| `deleteEvent(id)`                  | `void`           | No soft-delete.                              |
| `listEvents()`                     | `Event[]`        | Ordered `timestamp DESC, id DESC`.           |
| `exportAll()`                      | `Event[]`        | Same shape as `listEvents()`; used by sync.  |
| `replaceAll(events)`               | `void`           | Single transaction: clear + put each. Used by merge. |
| `getSetting(key)`                  | `any`            | `undefined` if missing.                      |
| `setSetting(key, value)`           | `void`           | Upserts into `settings`.                     |
| `deleteSetting(key)`               | `void`           | Removes a key from `settings`.               |

`Event = { id: number, timestamp: string, value: 0 | 1 }`.

`listEvents()` opens a cursor on `by_timestamp` in `prev` direction into an
array, then runs a final stable sort on `(timestamp desc, id desc)` to match
the old sqlite `ORDER BY timestamp DESC, id DESC` semantics exactly (the
cursor alone ties on timestamp, insertion-order).

`StorageUnavailableError` is thrown from `init()` when IndexedDB is
unavailable or the open request errors.

## Bucket mapping (`aggregate.js`, pure)

```js
// Returns { dow: 0..6 (Sun..Sat), block: 0..3 }
export function bucketOf(date) { ... }

// Returns Map<"dow,block", { positive, total, p }>
// Always returns all 28 keys; p === null when total === 0.
export function aggregate(events) { ... }
```

Block boundaries use `date.getHours()` with half-open intervals:

| Block | Hours | `getHours()` range |
| ----- | ----- | ------------------ |
| 0     | 00–09 | 0..8               |
| 1     | 09–12 | 9..11              |
| 2     | 12–17 | 12..16             |
| 3     | 17–24 | 17..23             |

Day-of-week uses `date.getDay()` directly (Sun=0).

## Telegram sync (`sync.js` + `mergeSnapshots`)

`sync.js` is pure network + data; it does not touch the DOM and does not
import `db.js` for its own state. `app.js` orchestrates sync by reading
events via `db.exportAll()` / writing via `db.replaceAll()`.

### API

- `pushSnapshot({ token, chatId, events, deviceTag })`
  → `{ ok: true, messageId: number }` on success.
  Posts `multipart/form-data` to
  `https://api.telegram.org/bot<TOKEN>/sendDocument`:
  - `chat_id`: the numeric chat id
  - `document`: a `Blob` of the events JSON, filename `eventtracker.json`,
    MIME `application/json`
  - `caption`: `eventtracker-<isoTimestamp>-<deviceTag>` (plain text only;
    no token, no secrets)

- `pullLatest({ token, chatId })`
  → `{ events, messageId, capturedAt } | null` when no snapshot is found.
  Calls `getUpdates?offset=-100&timeout=0` (returns the last 100 updates
  regardless of the 24h default window), finds the most-recent update
  where `message.chat.id === chatId`, `message.document.mime_type` is
  `application/json`, and the caption starts with `eventtracker-`.
  Downloads the file via `getFile` + the `https://api.telegram.org/file/...`
  endpoint and parses it as JSON.

- `getMe({ token })` → `{ ok, result }` — used by the Settings "Test
  connection" button.

- `detectChatId({ token })` → `number | null` — wraps `getUpdates` and
  returns the most-recent message's `chat.id` for the user to confirm.

### Merge policy (`mergeSnapshots(local, remote)`, pure)

Exported from `sync.js` so it can be unit-tested without stubbing `fetch`.
Keys events by `id`:

- Unknown ids from remote are **inserted**.
- Ids present in both sides with differing payload: prefer the side whose
  `timestamp` is later (lexicographic comparison on the ISO-8601 string);
  ties prefer remote.
- Ids present locally but absent remotely are **preserved** — a one-way
  merge. Removing locally because a peer didn't know about the row would
  be unsafe for a sync-assist tool.

Returns `{ events, added, updated, removed }` where `events` is the merged
set (sorted the same way as `listEvents()`), and `added`/`updated`/`removed`
are integers for a short status line in the UI. `removed` is always 0 in
the current merge policy, but is returned for future compatibility.

### Credentials

The bot token, chat ID, and `deviceTag` live in the `settings` object store.
They are never written into `events` or into a pushed snapshot. "Forget
credentials" removes them from `settings` without touching `events`.

### Auto-sync in `app.js`

- **Auto-push**: module-level debounce handle; every CRUD schedules a push
  5000 ms later and resets the timer. If credentials aren't configured, the
  push is a no-op. Never fires during an in-flight pull+merge.
- **Auto-pull**: on app start, if credentials exist, `app.js` runs a pull +
  merge before the first view renders.
- **Settings view** shows a small status badge: `Idle / Syncing /
  Last synced <relative> / Error: <short message>`. No toast spam.

## Views

Single `index.html` with four sections toggled by a bottom tab bar (thumb
reach on mobile). Routing via `location.hash` so back-button works:
`#/log`, `#/list`, `#/grid`, `#/settings`. Default is `#/log`.

### Log view (`#/log`)

- Two large buttons: **Positive** (green) and **Negative** (red), each ≥ 64px
  tall for tap targets.
- Tap → `db.insertEvent(now, 1|0)` → brief "✓ Saved" toast. No modal.
- Below: a "Backdate" disclosure with a `<input type="datetime-local">` and
  the same Positive / Negative pair.

### List view (`#/list`)

- Reverse-chron `<ul>` from `db.listEvents()`.
- Each row: formatted timestamp, value badge, bucket label, Edit, Delete
  (with `window.confirm`).
- After any mutation, re-render.

### Grid view (`#/grid`)

- 7×4 HTML `<table>`. Column headers Sun–Sat, row headers block labels.
- Each cell: `NN%` top / `n = <count>` bottom; background shaded
  `hsl(<P*120>, 70%, 85%)`; `n === 0` cells neutral gray with `—`.

### Settings view (`#/settings`)

- Fields: **Bot token** (password input), **Chat ID** (number input).
- Buttons: **Test connection** (calls `getMe`), **Detect chat ID**
  (reads the latest message addressed to the bot), **Sync now** (pull then
  push), **Forget credentials**.
- Shows the sync-status badge and the `deviceTag`.

### Error state

`db.init()` failure → `app.js` renders a full-screen error with the exact
copy: *"This browser doesn't support local storage. Please use a current
version of Chrome, Firefox, or Brave."* No view chrome is mounted; no
writes can succeed.

## PWA manifest

`/manifest.webmanifest` declares `name`, `short_name`, `start_url: "./"`,
`display: "standalone"`, a `theme_color` matching the CSS palette, and a
single `assets/icon.svg` icon with `purpose: "any maskable"`. No service
worker in v1; IndexedDB already handles durable offline storage for our
use-case and a service worker adds cache-invalidation headaches.

## Testing

Run with `node --test 'test/*.test.js'` (invoked via `npm test`; Node 22
requires the glob).

### `aggregate.test.js`

- `bucketOf` boundary cases: 08:59:59, 09:00:00, 11:59:59, 12:00:00,
  16:59:59, 17:00:00, 23:59:59, 00:00:00.
- Day-of-week mapping: a known date per day-of-week.
- `aggregate()`:
  - Empty input → all 28 buckets present, every `p === null`.
  - Mixed input → correct counts, correct ratios.
  - Single bucket with all-positive → `p === 1`.
  - Single bucket with all-negative → `p === 0`.

### `db.test.js`

Exercises the real `db.js` module on top of `fake-indexeddb/auto`. Covered:

1. Fresh DB: `listEvents()` returns `[]`.
2. `insertEvent` returns an id; row retrievable with `value === 1`.
3. `insertEvent(..., false)` persists as `value === 0`.
4. `updateEvent` modifies both timestamp and value.
5. `deleteEvent` removes the row.
6. Ordering: three inserts → `listEvents()` returns descending timestamp.
7. Tie-breaker: same timestamp → id descending.
8. `exportAll()` returns the same shape as `listEvents()`.
9. `replaceAll(events)` wipes and repopulates atomically.
10. `getSetting` / `setSetting` / `deleteSetting` round-trip a value.

### `sync.test.js`

- `pushSnapshot` builds a `FormData` with `chat_id`, `document`
  (JSON blob), and a caption starting with `eventtracker-`. Stubbed
  `fetch` captures the request and asserts.
- `mergeSnapshots`:
  - Remote-only ids are inserted.
  - Id present both sides with identical payload is not counted as updated.
  - Id present both sides, remote newer → remote wins.
  - Id present both sides, local newer → local wins.
  - Id present both sides, equal timestamps → remote wins.
  - Local-only ids are preserved.

## Out of scope

Mirrors the PRD for locality:

- Timezone handling
- Rolling windows
- Multiple event types
- User-defined blocks
- Forecasting / prediction
- Cross-user aggregation

(Server / sync is no longer out of scope — the optional Telegram sync
described above is in scope. Multi-user aggregation remains out.)

## Open questions

_None at this time._
