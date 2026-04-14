# Event Frequency Recorder — Technical Spec

Companion to [`PRD.md`](./PRD.md). This doc describes *how* to build it; the
PRD defines *what* to build. Where the two disagree, the PRD wins.

## Overview

A static single-page web app (no backend, no build step) that records binary
events and visualizes P(positive) across a 7-day × 4-block grid. Data is
persisted entirely on-device via SQLite compiled to WebAssembly, stored in
the Origin Private File System (OPFS). The app is served as plain HTML, CSS,
and ES modules; any static host (or `python -m http.server`) will run it.

## Tech stack

- **Frontend**: plain HTML + CSS + ES modules. No bundler, no transpiler, no
  framework. Loaded directly by the browser via `<script type="module">`.
- **Storage**: [`@sqlite.org/sqlite-wasm`][sqlite-wasm] with the OPFS VFS for
  durable, concurrent-safe, on-device SQLite. Vendored into `vendor/` at a
  pinned version so the app has no runtime network dependency.
- **Testing**: Node's built-in `node:test` runner. No dev dependencies for
  pure-logic tests; `better-sqlite3` added as a dev-only dependency for DB
  tests (see Testing).

[sqlite-wasm]: https://sqlite.org/wasm/doc/trunk/index.md

### Browser support

OPFS requires Chromium 108+, Firefox 111+, Safari 17+. If OPFS is
unavailable, `db.init()` throws a user-visible error ("This browser does not
support local storage for this app; please update your browser"). No in-memory
fallback — losing data silently would be worse than failing loudly.

## File layout

```
/index.html            # single page, three views: Log / List / Grid
/app.js                # view routing + event handlers (only file touching DOM)
/db.js                 # SQLite init, schema, CRUD
/aggregate.js          # pure functions: bucket mapping, P(positive) calc
/styles.css            # mobile-first styles
/vendor/sqlite-wasm/   # pinned sqlite-wasm build (jswasm/ contents)
/test/
  aggregate.test.js    # node:test — pure logic
  db.test.js           # node:test — CRUD against better-sqlite3
/package.json          # dev-only: better-sqlite3, test script
```

Rationale: one JS file per responsibility. `aggregate.js` is pure and
trivially testable. `db.js` owns all SQL. `app.js` is the only module that
touches the DOM.

## Data model

```sql
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT    NOT NULL,           -- ISO-8601 local, no tz suffix
  value     INTEGER NOT NULL CHECK(value IN (0, 1))
);
CREATE INDEX IF NOT EXISTS events_ts ON events(timestamp);
```

- `timestamp` is stored as a naive ISO-8601 string (`YYYY-MM-DDTHH:MM:SS`)
  produced from the device clock. Per the PRD, timezones are out of scope.
- `value` is `0` / `1` (JS booleans are coerced at the DB boundary).
- Index on `timestamp` keeps the reverse-chron list query cheap.

## CRUD API (`db.js`)

All functions are `async`. The module exports:

| Function                           | Returns          | Notes                               |
| ---------------------------------- | ---------------- | ----------------------------------- |
| `init()`                           | `void`           | Opens OPFS-backed DB, runs DDL.     |
| `insertEvent(timestamp, value)`    | `id: number`     | `value` coerced to 0/1.             |
| `updateEvent(id, timestamp, value)`| `void`           | Full replace of both fields.        |
| `deleteEvent(id)`                  | `void`           | No soft-delete.                     |
| `listEvents()`                     | `Event[]`        | Ordered `timestamp DESC, id DESC`.  |

`Event = { id: number, timestamp: string, value: 0 | 1 }`.

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

## Views

Single `index.html` with three sections toggled by a bottom tab bar (thumb
reach on mobile). Routing via `location.hash` so back-button works:
`#/log`, `#/list`, `#/grid`. Default is `#/log`.

### Log view (`#/log`)

- Two large buttons: **Positive** (green) and **Negative** (red), each ≥ 64px
  tall for tap targets.
- Tap → `db.insertEvent(new Date().toISOString(), 1|0)` → brief "✓ Saved"
  toast. No modal, no confirmation. Must feel instant.
- Below: a "Backdate" disclosure. When expanded:
  - `<input type="datetime-local">` defaulting to now.
  - Same Positive / Negative buttons, which use the picker's value instead
    of `new Date()`.

### List view (`#/list`)

- Reverse-chron `<ul>` from `db.listEvents()`.
- Each row:
  - Timestamp (formatted `Mon 14 Apr 2026 · 09:12`)
  - Value badge (green "+" or red "−")
  - Bucket label (e.g. "Mon · 09–12")
  - **Edit** button → row expands into an inline form with a
    `datetime-local` input, value toggle, Save / Cancel.
  - **Delete** button → `window.confirm("Delete this event?")`.
- After any mutation, re-render list and (lazily) invalidate the grid.

### Grid view (`#/grid`)

- 7-column × 4-row HTML `<table>`. Column headers Sun–Sat; row headers the
  block label (`00–09`, `09–12`, `12–17`, `17–24`).
- Each cell:
  - Top line: `NN%` (or `—` if `n = 0`)
  - Bottom line: `n = <count>`
  - Background shaded via `hsl(<P * 120>, 70%, 85%)` so red→green hints at
    P at a glance. Cells with `n = 0` are neutral gray.

After any create/update/delete, the grid recomputes from a fresh
`db.listEvents()` — in line with the PRD ("recompute on any create, update,
or delete") and safe at personal-scale volumes.

## Performance

- Personal-scale volumes (thousands of rows, not millions). Full-table read
  + in-memory aggregation is trivially fast and simpler than incremental
  updates.
- Live-mode tap: single prepared `INSERT`, no network, OPFS write is sub-ms.
  Meets the PRD's "near-instant" requirement.
- No pagination in the list view for v1; can revisit if row count exceeds
  a few thousand.

## Testing

Run with `node --test test/`.

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

Exercises the SQL directly. `sqlite-wasm` can run headless in Node but its
OPFS path doesn't apply there; for test simplicity we use `better-sqlite3`
with the same DDL and queries as a dev-only dependency. The production app
does not ship `better-sqlite3` — there's no bundler, so only files
referenced from `index.html` reach the browser.

Covered scenarios:

1. Fresh DB: `listEvents()` returns `[]`.
2. `insertEvent` → `listEvents()` returns the row with correct fields.
3. `updateEvent` modifies both timestamp and value.
4. `deleteEvent` removes the row; subsequent `listEvents()` omits it.
5. Ordering: three inserts at different timestamps → `listEvents()` returns
   them in descending timestamp order.

## Out of scope

Mirrors the PRD for locality:

- Timezone handling
- Rolling windows
- Multiple event types
- User-defined blocks
- Forecasting / prediction
- Cross-user aggregation
- Server / sync

## Open questions

_None at this time._
