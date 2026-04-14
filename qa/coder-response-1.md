# Coder Round 1 Response

## Slices completed

All nine slices from `plan/slices.md` are committed on `master`:

1. **Slice 1** — Scaffolding, vendored sqlite-wasm (`3.51.2-build9`
   under `vendor/sqlite-wasm/jswasm/`), `db.init()` + empty list.
2. **Slice 2** — Full CRUD in `db.js` (`insertEvent`, `updateEvent`,
   `deleteEvent`, `listEvents`).
3. **Slice 3** — Pure `aggregate.js` (`bucketOf`, `aggregate`, plus
   exported `BLOCKS` and `DOW_LABELS` used by List and Grid views).
4. **Slice 4** — Log view live mode (Positive / Negative).
5. **Slice 5** — Backdate disclosure with `datetime-local` input.
6. **Slice 6** — List view with inline edit + `confirm()`-gated delete.
7. **Slice 7** — Grid view with recomputation on every CRUD
   (grid always re-renders from a fresh `listEvents()` → `aggregate()`).
8. **Slice 8** — Hash routing (`#/log`, `#/list`, `#/grid`) + bottom
   tab bar + mobile-first polish, custom-property palette, rounded
   system body font with a serif display accent for grid %.
9. **Slice 9** — OPFS-unavailable error state (`renderUnsupported()`
   prints the exact message from TECH_SPEC.md, strips nav chrome,
   no in-memory fallback).

## Slices deferred

None. All nine are in.

## Test output

`npm test` runs `node --test 'test/*.test.js'`:

```
# tests 22
# suites 0
# pass 22
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Coverage:
- `test/aggregate.test.js` (14 tests): every boundary from TECH_SPEC.md
  (08:59:59, 09:00:00, 11:59:59, 12:00:00, 16:59:59, 17:00:00, 23:59:59,
  00:00:00), day-of-week walk Sun→Sat, empty aggregate (28 keys all
  null), fully-positive / fully-negative buckets, mixed ratios, and a
  cross-bucket no-bleed assertion.
- `test/db.test.js` (8 tests): scenarios 1–5 from TECH_SPEC.md plus a
  same-timestamp-id-tiebreak ordering assertion and a CHECK-constraint
  guard that `value IN (0,1)` is enforced.

## Run locally

```
npm install                           # once, to get better-sqlite3 (dev-only)
npm test                              # unit tests
python3 -m http.server 8000           # from the repo root
# then open http://localhost:8000/ in a supported browser (Chromium 108+,
# Firefox 111+, or Safari 17+).
```

The app ships no runtime dependencies — `vendor/sqlite-wasm/jswasm/`
contains `sqlite3.mjs`, `sqlite3.wasm`, and
`sqlite3-opfs-async-proxy.js` pinned at `3.51.2-build9`
(see `vendor/sqlite-wasm/VERSION`).

## Deviations from TECH_SPEC.md

### 1. `node --test test/` command invocation

`CLAUDE.md` suggests `node --test test/`. On the Node 22.22.2 shipped
with this image, `node --test <dir>` treats the argument as a file and
fails with `ERR_MODULE_NOT_FOUND`. Two invocations work reliably:

- `npm test` (which runs `node --test 'test/*.test.js'`), or
- `node --test` (no args — auto-discovers `test/**/*.test.js`).

The `"test"` script in `package.json` uses the glob form so the
Evaluator can just run `npm test`.

### 2. Timestamp format: naive local ISO everywhere

TECH_SPEC.md "Data model" specifies naive ISO-8601 without a tz
suffix (`YYYY-MM-DDTHH:MM:SS`). The slice text for Slice 4/5 mentions
`new Date().toISOString()`, which would emit a `Z`-suffixed UTC
string. Mixing the two would break bucket math on non-UTC devices
because `aggregate.js` calls `getHours()` / `getDay()` on a `Date`
parsed from the stored string — `"2026-04-14T10:15:00Z"` is UTC and
maps to a different local hour than `"2026-04-14T10:15:00"`, and
backdated events (which use `datetime-local` → naive local) would
live in a different coordinate system from live events.

The Data-model format is the only one that works consistently, so
live inserts go through `nowLocalIso(new Date())` which produces
`YYYY-MM-DDTHH:MM:SS` from `getFullYear`, `getMonth`, etc. PRD
says "All timestamps use device system time"; per `CLAUDE.md`,
"Where PRD and tech spec disagree, the PRD wins." I treated the
`toISOString()` bullet in the slice text as illustrative rather
than binding and went with the Data-model format.

### 3. No user-facing switch for forcing the OPFS error state

Slice 9's acceptance criterion refers to "a browser where
`installOpfsSAHPoolVfs` is stubbed to throw." I did not add a
`?nopfs=1` toggle because it would be production-visible scope
creep. The error path lives in `db.js` → `OpfsUnavailableError`,
caught in `app.js`'s `start()` and surfaced via
`renderUnsupported()`. The Evaluator can exercise it by:

- Playwright `page.route()` intercepting `vendor/sqlite-wasm/jswasm/sqlite3.mjs`
  to inject a broken `installOpfsSAHPoolVfs`, or
- locally editing `db.js` to throw inside `init()`.

The error message is written via `textContent` so the exact
"This browser does not support local storage for this app; please
update your browser." text from TECH_SPEC.md "Browser support" is
reproducible byte-for-byte.

## Architecture notes

- `sql.js` was added as a tiny shared module containing the DDL and
  SQL query strings. `db.js` uses it in the browser against
  sqlite-wasm; `test/db.test.js` uses the same strings against
  `better-sqlite3`. This makes "tests share the SQL, not the driver"
  from TECH_SPEC.md "Testing → db.test.js" a mechanical fact rather
  than a convention that can drift.
- `app.js` is the only file that touches the DOM. `db.js` holds all
  SQL and the VFS bootstrap. `aggregate.js` is pure (only `Date`
  calls, no DOM, no DB).
- Styling uses CSS custom properties for the palette (warm neutrals,
  positive green, negative red) with a dark-scheme override via
  `prefers-color-scheme`. Fonts are a rounded system stack for body
  text and a serif (`Iowan Old Style` → `Palatino` → `Georgia`) as
  the display accent for view titles and grid percentages. No
  gradients, no glassmorphism, no purple.
- Grid cells that have events get `hsl(P * 120, 70%, 85%)` — red at
  P=0, yellow at P=0.5, green at P=1. Empty cells are a neutral
  warm gray with "—" and `n = 0`. Grid ink is fixed at dark
  `#141414` because the shaded backgrounds are always light
  regardless of color scheme.

## Known issues

- OPFS persistence is only actually exercised in a real browser; the
  unit tests drive `better-sqlite3`. This is by design per TECH_SPEC.md
  "Testing".
- The bottom tab bar uses fixed positioning. On browsers without
  `env(safe-area-inset-bottom)` support, the Grid cell gutter at the
  bottom edge may sit flush against the bar; the `#app` has
  `padding-bottom: calc(5rem + env(...))` which handles this on iOS.
