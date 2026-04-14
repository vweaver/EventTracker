# Evaluation — Round 1

## Overall assessment

The Coder delivered all nine slices with clean separation of concerns, a
tight dependency posture, and a considered mobile-first visual language.
All 22 unit tests pass. Source-level review matches every spec
requirement I could verify statically. The Slice-9 unsupported-browser
error state was verified end-to-end in a real Chromium and reproduces
the TECH_SPEC.md message byte-for-byte with no view chrome leaking
through. Browser-level exercise of Slices 4–8 was not possible in this
harness due to a Chromium 141 headless limitation (see "Environment
limitation" below), so those slices are verified by source inspection +
unit tests only; no evidence of defects was found.

**Verdict: PASS.**

## Environment limitation (important caveat)

The preinstalled Chromium under `/opt/pw-browsers` is v141 and does NOT
expose `FileSystemFileHandle.prototype.createSyncAccessHandle` on the
main thread under Playwright's headless/headed launch — even with
`launchPersistentContext` and a user-data-dir, even under `xvfb-run`,
and even though `isSecureContext === true` on `http://localhost:8000/`.
The sqlite-wasm feature-gate at `vendor/sqlite-wasm/jswasm/sqlite3.mjs:15502`
requires that property and rejects `installOpfsSAHPoolVfs` with
"Missing required OPFS APIs." before spawning its worker. This is an
environment quirk of the headless-testing Chromium build, not a bug in
the coder's work; real consumer Chromium/Firefox/Safari expose the
prototype and the gate passes. I attempted to polyfill the prototype
via `addInitScript`, but downstream code actually calls the polyfilled
no-op and fails; I could not find a way to make the opfs-sahpool VFS
cross this gate in this Chromium build without patching vendored code,
which is off-limits.

Because of this, browser walkthroughs for Slices 4 through 8 were
replaced with static source inspection + unit-test coverage. Slice 9
was fully verified in-browser because its error path is exactly what
this environment hits naturally.

## Tests

- `npm test` → `node --test 'test/*.test.js'`
- Result: `tests 22 / pass 22 / fail 0` — GREEN.
- Coverage is exactly what TECH_SPEC.md "Testing" asks for plus two
  extra guards (timestamp-tie ordering, value CHECK constraint).

## Source-level verification (green)

| Check | Result |
| --- | --- |
| `db.js` imports only sqlite-wasm + `sql.js`; no `better-sqlite3` | PASS |
| `app.js` is the only file that touches `document`/`window` | PASS (grep: 20 hits all in `app.js`; 0 in `db.js` and `aggregate.js`) |
| `aggregate.js` is pure (no DOM, no SQL, no storage) | PASS |
| `package.json`: `better-sqlite3` under `devDependencies` only | PASS |
| `vendor/sqlite-wasm/VERSION` pins `3.51.2-build9` | PASS |
| No React/Vue/Svelte/FastAPI anywhere | PASS |
| No purple/indigo gradients, no glassmorphism, no "AI" ornaments in CSS | PASS |
| Live insert uses naive local ISO (`nowLocalIso`) not `toISOString` | PASS |
| Backdate and live both produce `YYYY-MM-DDTHH:MM:SS`; no mixed formats | PASS |
| DDL matches TECH_SPEC.md "Data model" verbatim (`sql.js` + `schema.sql`) | PASS |
| `OrderBy timestamp DESC, id DESC` | PASS |
| Half-open block boundaries in `aggregate.js` match TECH_SPEC Block table | PASS |
| Exact unsupported-browser message text (TECH_SPEC.md "Browser support") | PASS (verified in real browser, see Slice 9 below) |
| No silent in-memory fallback in `db.js` | PASS (`init()` rethrows as `OpfsUnavailableError`; `app.js` calls `renderUnsupported()` and strips tabbar) |
| HTML loads only `./app.js` + `./styles.css` — no CDN fetch | PASS |
| App boot issues no network requests beyond same-origin static files | PASS (traced: `/`, `styles.css`, `app.js`, `db.js`, `aggregate.js`, `sql.js`, `sqlite3.mjs`, `sqlite3.wasm`) |

## Slice 9 — browser-verified

Launched headless Chromium, loaded `http://localhost:8000/`. Without
any stub, this environment's Chromium throws "Missing required OPFS
APIs", which is exactly the failure mode Slice 9 targets. Observed:

- `.error-state h1` → `"Storage unavailable"`
- `.error-state p` → `"This browser does not support local storage for this app; please update your browser."` (exact match with TECH_SPEC.md)
- `body.className` → `"unsupported"`
- Tabbar count: 0 (nav chrome stripped)
- Positive-button count: 0 (Log view not rendered)
- Console errors include `OpfsUnavailableError`, confirming no
  silent fallback was attempted.

## Deviations from the Coder's declared list

- **Deviation #1 (`node --test 'test/*.test.js'`).** Cosmetic. The
  `npm test` script works, directly-invoked tests pass, no functional
  concern. Accepted.
- **Deviation #2 (naive local ISO everywhere).** Correct call. The
  slice text's `new Date().toISOString()` illustration would have
  produced UTC `Z`-suffixed strings that break bucket math for any
  non-UTC user (since the backdate picker emits naive-local), and
  TECH_SPEC.md "Data model" explicitly prescribes
  `YYYY-MM-DDTHH:MM:SS` with no tz suffix. The implementation is
  consistent across live (`nowLocalIso`) and backdate
  (`${raw}:00`) paths. No mixed-format contamination found by grep
  across `*.js`. Accepted.
- **Deviation #3 (no `?nopfs=1` toggle).** Acceptable because the
  error path is reachable by init-script stubbing (and, in this
  environment, naturally). Production code stays clean.

## Per-criterion scoring

### 1. Spec Conformance — 9/10 (threshold 7)

- PRD model (`events(id, timestamp, value)`), CRUD set, half-open
  blocks, 28 buckets with `p = null` at total=0, reverse-chron list,
  Grid P%+n cells, recompute-on-mutation — all present and correct.
- No out-of-scope features. No rolling windows, no multi-event
  types, no timezones, no sync, no AI.
- Deduction (-1): the displayed Grid "block" row headers match
  `BLOCKS[i].label` (`00–09`, `09–12`, `12–17`, `17–24`). PRD says
  "block 1: 00:00–09:00" etc. — the labels are a cosmetic 1-off
  (PRD numbers blocks 1..4, the code 0..3). This is an internal
  naming choice and doesn't change math; users see the hour ranges,
  not indices. Flagged for transparency only, not a bug.

### 2. Functionality & Reliability — 8/10 (threshold 7)

- `node --test` green (22/22).
- Slice 9 live-verified: exact error message, no chrome, no fallback.
- All other slices verified by source review and the unit tests
  that exercise the DDL/SQL and all bucket boundaries.
- Deduction (-2): I could not drive the UI against real OPFS in
  this harness, so persistence, tap→save, List edit/delete, and Grid
  recomputation are unverified at the browser level. The code path
  is straightforward and the SQL is already exercised in tests via
  shared `sql.js`, but this is still a coverage gap I refuse to
  paper over.

### 3. Mobile UX & Visual Polish — 7/10 (threshold 5)

- Mobile-first: `width=device-width`, `viewport-fit=cover`, bottom
  tab bar fixed with `env(safe-area-inset-bottom)`, `#app` max-width
  720px but `padding-bottom: calc(5rem + env(...))` so the grid
  clears the tabbar on iOS.
- Tap targets: Positive/Negative ≥ 140px tall (well above the 64px
  spec), tabbar tabs ≥ 56px, icon buttons ≥ 44×44, pill ≥ 48.
- Palette is explicit CSS custom properties (warm neutral `#faf7f1`,
  blue accent `#2a5bd7`, pos/neg greens/reds) with a
  `prefers-color-scheme: dark` override. No Tailwind/Bootstrap
  defaults, no purple-to-indigo gradients, no glassmorphism, no
  "✨" ornamentation.
- Typography: `ui-rounded` system body stack; serif display stack
  (Iowan Old Style → Palatino → Georgia) applied to view titles,
  tap-button glyphs, and grid percentages — i.e., a real
  considered display accent, not Inter-as-body.
- Grid uses `hsl(p*120, 70%, 85%)` for a red→yellow→green ramp with
  dark ink at fixed `#141414`; empty cells are a neutral
  `color-mix` gray with `—` and `n = 0`.
- Feedback animations: `rowIn` keyframe for list row entry, toast
  fade+slide, `:active` scale on tap targets. No decorative motion.
- Deduction (-3): Grid uses a 720px max-width (`#app`) so on wider
  phones/landscape it may feel constrained; on pure mobile portrait
  this is fine. I could not screenshot the live app at mobile
  viewport to sanity-check the rendered look in-browser, so I'm
  being conservative with the score. Nothing looks sloppy in source
  review.

### 4. Code Hygiene — 9/10 (threshold 5)

- `db.js` owns all SQL, never touches DOM (grep verified).
- `app.js` is the only DOM-touching file (grep verified).
- `aggregate.js` is pure (only `Date` calls, no DOM, no DB).
- `sql.js` is a nice bonus — shared SQL strings between production
  and tests make "tests share the SQL, not the driver" mechanical.
  It's also DOM-free and import-free.
- `package.json`: one `devDependencies` entry (`better-sqlite3`);
  zero runtime deps; `"type": "module"`; `node --test` script.
- Vendored sqlite-wasm pinned with a `VERSION` file.
- `schema.sql` exists as an extra human-readable copy of the DDL —
  not referenced at runtime; it's redundant with `sql.js`'s `DDL`
  export but kept in sync by the Coder. Minor; not flagged.
- Deduction (-1): `console.error` calls in `app.js` on insert /
  update / delete failures leak implementation detail (error
  stringification) without a structured debug channel. Acceptable
  for a single-user utility; not spec-violating.

## Bug list

None. No defects found that violate PRD.md or TECH_SPEC.md.

### Observations (not bugs)

- `app.js` emits a noisy warning in the console on OPFS init
  because sqlite-wasm's **default** OPFS VFS (separate from
  `opfs-sahpool`) also tries to auto-install and warns about
  COOP/COEP. This comes from vendored code, not from our app. It
  does NOT affect correctness because we use `opfs-sahpool`, not
  the default VFS. Not a bug, but if a future round wants silence
  it can pass `config.useSqlite3Worker1` tuning or the `.noOpfs`
  option to `sqlite3InitModule({ ... })`.
- Grid `block` indices (0..3) vs PRD's natural language
  "Block 1..4" — see scoring note above; cosmetic.

## Verdict

**PASS.**

- Every criterion meets or exceeds its threshold.
- `npm test` green.
- Slice 9 verified end-to-end in a real browser against the exact
  spec text.
- Slices 1–8 verified via source review + unit tests; no defects
  found. The only reason the scores aren't higher is that I refused
  to credit work I couldn't exercise in-browser in this harness.
