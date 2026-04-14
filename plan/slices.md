# EventTracker — Build Slices

Ordered, executable build plan. Each slice ends in a working, testable state.
Later slices assume all earlier slices still pass their acceptance criteria.
References to the tech spec use headings from [`TECH_SPEC.md`](../TECH_SPEC.md);
product rules cite [`PRD.md`](../PRD.md).

Stack is fixed: plain HTML + ES modules, sqlite-wasm with `opfs-sahpool`,
`node:test` with `better-sqlite3` as a dev-only dependency. See TECH_SPEC.md
"Tech stack" and "Deployment & VFS choice". Do not deviate.

---

## Slice 1 — Scaffolding, vendored sqlite-wasm, `db.init()` + empty list

**Goal.** Stand up the file skeleton from TECH_SPEC.md "File layout",
vendor sqlite-wasm, and prove the DB opens end-to-end with the
`opfs-sahpool` VFS plus a working `node:test` path using `better-sqlite3`.

**Scope.**
- Create `index.html`, `app.js`, `db.js`, `aggregate.js`, `styles.css` as
  empty-but-valid stubs per TECH_SPEC.md "File layout".
- Vendor `@sqlite.org/sqlite-wasm` at a pinned version under
  `vendor/sqlite-wasm/jswasm/` (files referenced by the init sketch in
  TECH_SPEC.md "Deployment & VFS choice").
- Implement `db.init()` to install `opfs-sahpool` VFS, open the DB, and
  run the DDL from TECH_SPEC.md "Data model" (table + index).
- Implement `listEvents()` stub sufficient for the empty-DB test.
- Create `package.json` with `"test": "node --test test/"`, dev
  dependency `better-sqlite3` only, and `"type": "module"`.
- `test/db.test.js` runs the same DDL + `listEvents()` query against
  `better-sqlite3` (see TECH_SPEC.md "Testing" — production code does not
  import `better-sqlite3`; tests share the SQL, not the driver).
- `index.html` loads `app.js` as an ES module and calls `db.init()`.

**Acceptance criteria.**
- Given a fresh clone, when the evaluator runs `node --test test/`, then
  `db.test.js` scenario 1 (fresh DB → `listEvents()` returns `[]`) passes
  and the full run is green.
- Given the app served by `python3 -m http.server 8000`, when the
  evaluator opens `/` in a supported Chromium, then the page loads with
  **no console errors** and `db.init()` resolves.
- Given the repo, when the evaluator inspects it, then `vendor/sqlite-wasm/`
  contains the pinned `opfs-sahpool`-capable build and **no** network
  fetch for sqlite happens at runtime (TECH_SPEC.md "Tech stack" — vendored).
- Given `package.json`, when the evaluator inspects it, then
  `better-sqlite3` is under `devDependencies` only and no other runtime
  dependencies are listed.

---

## Slice 2 — Full CRUD in `db.js`

**Goal.** Implement the CRUD API exactly as specified in TECH_SPEC.md
"CRUD API (`db.js`)".

**Scope.**
- Implement `insertEvent(timestamp, value)`, `updateEvent(id, timestamp,
  value)`, `deleteEvent(id)`, and finalize `listEvents()` ordered
  `timestamp DESC, id DESC`.
- Coerce `value` to 0/1 at the DB boundary per TECH_SPEC.md "Data model".
- Extend `test/db.test.js` to cover scenarios 1–5 from TECH_SPEC.md
  "Testing → db.test.js".

**Acceptance criteria.**
- Given an empty DB, when `insertEvent('2026-04-14T10:15:00', true)` runs,
  then `listEvents()` returns exactly one row with `value === 1` and the
  returned `id` matches the row's `id`.
- Given an inserted event, when `updateEvent(id, '2026-04-13T09:00:00',
  false)` runs, then `listEvents()` reflects both the new timestamp and
  `value === 0`.
- Given an inserted event, when `deleteEvent(id)` runs, then
  `listEvents()` no longer contains that id.
- Given three events at timestamps `T1 < T2 < T3`, when `listEvents()`
  runs, then the returned order is `[T3, T2, T1]`.
- Given `node --test test/`, then all `db.test.js` cases are green.

---

## Slice 3 — Pure aggregation in `aggregate.js`

**Goal.** Implement `bucketOf(date)` and `aggregate(events)` per
TECH_SPEC.md "Bucket mapping (`aggregate.js`, pure)" and PRD.md
"Time Blocks" and "Aggregation".

**Scope.**
- `bucketOf(date)` returns `{ dow: 0..6, block: 0..3 }` using
  `date.getDay()` and `date.getHours()` against the half-open ranges in
  TECH_SPEC.md's Block table.
- `aggregate(events)` returns a `Map<"dow,block", { positive, total, p }>`
  with all 28 keys always present, `p === null` when `total === 0`.
- `test/aggregate.test.js` covers every case listed in TECH_SPEC.md
  "Testing → aggregate.test.js".

**Acceptance criteria.**
- Given a `Date` at `08:59:59`, when `bucketOf` runs, then `block === 0`.
- Given a `Date` at `09:00:00`, when `bucketOf` runs, then `block === 1`
  (half-open `[start, end)` per PRD.md "Time Blocks").
- Given boundary `Date`s at `11:59:59`, `12:00:00`, `16:59:59`, `17:00:00`,
  `23:59:59`, `00:00:00`, when `bucketOf` runs, then each falls in the
  block defined by TECH_SPEC.md's Block table.
- Given a known date per weekday (Sun–Sat), when `bucketOf` runs, then
  `dow` maps correctly (Sun=0 … Sat=6).
- Given `aggregate([])`, then the returned Map has 28 keys and every
  entry has `total === 0` and `p === null`.
- Given a mixed input with multiple buckets, then per-bucket `positive`,
  `total`, and `p = positive/total` are exact; a fully-positive bucket
  yields `p === 1`; a fully-negative yields `p === 0`.
- Given `node --test test/`, then all `aggregate.test.js` cases are green.

---

## Slice 4 — Log view, live mode (walking skeleton to UI)

**Goal.** First end-to-end user path: open page → tap Positive or
Negative → event is persisted. Matches TECH_SPEC.md "Log view (`#/log`)"
live-mode behavior.

**Scope.**
- `index.html` renders a Log section with **Positive** and **Negative**
  buttons meeting the tap-target size from TECH_SPEC.md "Log view".
- `app.js` wires taps to `db.insertEvent(new Date().toISOString(), 1|0)`
  and shows a brief "✓ Saved" toast. No modal, no confirm.
- `app.js` is the only module touching the DOM; `db.js` stays
  DOM-free (TECH_SPEC.md "File layout" rationale).
- Minimal inline list below the buttons (or a debug area) is **not**
  required yet — persistence is verified via reload in the next slice,
  but we do verify here that no console errors fire and the insert
  resolves.

**Acceptance criteria.**
- Given the Log view on a mobile viewport, when the evaluator inspects
  the Positive/Negative buttons, then each is at least 64px tall
  (TECH_SPEC.md "Log view").
- Given a Positive tap, when the promise settles, then a "✓ Saved" toast
  is visible briefly and the console shows no errors.
- Given a Negative tap, then the same occurs with the value stored as 0.
- Given ten rapid Positive taps, then ten rows exist in the DB (verified
  via `listEvents()` exposed to a dev check or by proceeding to Slice 6
  list view).
- Given `node --test test/`, then prior slices' tests remain green.

---

## Slice 5 — Backdate disclosure in Log view

**Goal.** Complete PRD.md "Logging → Backdate" per TECH_SPEC.md
"Log view (`#/log`)" backdate section.

**Scope.**
- Add a collapsible "Backdate" disclosure under the live buttons.
- When expanded, shows a `<input type="datetime-local">` defaulting to
  "now" plus Positive / Negative buttons that use the picker value instead
  of `new Date()`.
- Tapping a backdate button calls `db.insertEvent(pickerValue, 1|0)` and
  shows the same "✓ Saved" toast.

**Acceptance criteria.**
- Given the Log view, when the evaluator expands the Backdate
  disclosure, then a datetime-local input prefilled with the current
  local time is visible alongside Positive/Negative buttons.
- Given a backdated datetime (e.g. `2026-03-01T08:30`) and tapping
  Positive, then `listEvents()` returns a row with `timestamp` matching
  the picker value and `value === 1`.
- Given the live Positive/Negative buttons after adding the backdate UI,
  they still insert with `new Date().toISOString()` (Slice 4 criteria
  still pass).
- Given `node --test test/`, all tests remain green.

---

## Slice 6 — List view with edit + delete

**Goal.** Implement PRD.md "Event List View" per TECH_SPEC.md
"List view (`#/list`)".

**Scope.**
- Render a reverse-chron `<ul>` from `db.listEvents()`.
- Each row: formatted timestamp (`Mon 14 Apr 2026 · 09:12`), value badge
  (green "+" / red "−"), bucket label (e.g. `Mon · 09–12`) derived via
  `aggregate.bucketOf`.
- **Edit**: row expands into an inline form with a `datetime-local`
  input and a value toggle plus Save / Cancel; Save calls
  `db.updateEvent`. Both fields are editable per PRD.md "Event List
  View".
- **Delete**: uses `window.confirm("Delete this event?")` and then
  `db.deleteEvent`.
- After any mutation, re-render the list. The Grid view's stale state
  is acceptable for now; Slice 7 handles recomputation.

**Acceptance criteria.**
- Given three events at distinct timestamps, when the List view
  renders, then rows appear in strictly descending timestamp order.
- Given a row, when the evaluator taps **Edit**, changes both the
  datetime and the value, and taps Save, then `db.listEvents()` reflects
  both changes, the row re-renders with the new bucket label, and the
  change persists across a page reload.
- Given a row, when the evaluator taps **Delete** and cancels the
  `confirm` dialog, then the row is still present.
- Given a row, when the evaluator taps **Delete** and accepts the
  dialog, then the row disappears and is absent after reload.
- Given an event at `2026-04-13T09:00:00` (Mon), then the displayed
  bucket label is `Mon · 09–12` (half-open boundary).
- Given `node --test test/`, all tests remain green.

---

## Slice 7 — Grid view with recomputation after every CRUD

**Goal.** Implement PRD.md "Grid View" per TECH_SPEC.md
"Grid view (`#/grid`)" and close the PRD requirement "Recompute on any
create, update, or delete".

**Scope.**
- Render a 7-column × 4-row `<table>`: column headers Sun–Sat, row
  headers the block labels (`00–09`, `09–12`, `12–17`, `17–24`).
- Each cell shows `NN%` (or `—` when `n === 0`) and `n = <count>`.
- Shade cells via `hsl(<P * 120>, 70%, 85%)`; `n = 0` cells are neutral
  gray (TECH_SPEC.md "Grid view").
- After any create/update/delete (Log live, Log backdate, List edit,
  List delete), refresh via `db.listEvents()` → `aggregate()` and
  re-render the grid.

**Acceptance criteria.**
- Given an empty DB, when the Grid view renders, then all 28 cells show
  `—` and `n = 0`.
- Given four events in the (Wed, block 2) bucket — 3 positive, 1
  negative — when the Grid view renders, then that cell shows `75%` and
  `n = 4`, and its background is a green-leaning `hsl`.
- Given the evaluator adds an event via Log, switches to Grid, then
  edits that event's value via List and returns to Grid, then the
  corresponding cell's `%` and `n` reflect the edited state (proves
  "recompute on every mutation").
- Given an event at exactly `09:00:00` on a Monday, then it counts into
  (Mon, block 1), not (Mon, block 0).
- Given `node --test test/`, all tests remain green.

---

## Slice 8 — Hash routing, bottom tab bar, mobile-first polish

**Goal.** Deliver the three-view navigation and the mobile-first visual
target from TECH_SPEC.md "Views" and the Coder's "Frontend Quality"
guidance in CLAUDE.md.

**Scope.**
- Hash routing: `#/log`, `#/list`, `#/grid`, default `#/log`. Back button
  navigates between views (TECH_SPEC.md "Views").
- Bottom tab bar with three tabs (thumb reach). Active tab is visually
  distinct.
- `styles.css`: considered palette via CSS custom properties, a readable
  system font stack, a characterful display accent for grid percentages,
  tap targets ≥ 44px across all interactive elements, viewport used
  fully (grid view fills screen).
- Subtle feedback animation on Positive/Negative tap and on list row
  insert/removal. No decorative motion, no gradients, no glassmorphism.

**Acceptance criteria.**
- Given the page at `/`, when it loads, then `location.hash` becomes
  `#/log` and the Log view is visible.
- Given the evaluator clicks each of the three bottom tabs, then the
  URL hash changes to `#/log`, `#/list`, or `#/grid` respectively and
  the corresponding view is shown; browser back/forward moves between
  views.
- Given a mobile viewport (e.g. iPhone 14 preset), when the evaluator
  inspects each view, then all tap targets measure at least 44px, the
  tab bar sits at the bottom within thumb reach, and the Grid view
  fills the viewport width with no large empty margins.
- Given the stylesheet, when inspected, then colors are defined as CSS
  custom properties and typography uses a system stack plus one
  display-accent font for grid percentages (no Bootstrap/Tailwind
  defaults, no purple-to-indigo gradients, no "AI" ornaments).
- Given `node --test test/`, all tests remain green.

---

## Slice 9 — OPFS-unavailable error state

**Goal.** Close TECH_SPEC.md "Browser support": if the VFS cannot
install, surface a user-visible error and do **not** fall back to
in-memory storage (PRD.md requires durable local storage).

**Scope.**
- `db.init()` catches a failed `installOpfsSAHPoolVfs` or
  `OpfsSAHPoolDb` open and rethrows a tagged error.
- `app.js` renders a full-screen error message: "This browser does not
  support local storage for this app; please update your browser"
  (TECH_SPEC.md "Browser support").
- No silent in-memory fallback. The Log, List, and Grid views are
  hidden while in the error state.

**Acceptance criteria.**
- Given a browser where `installOpfsSAHPoolVfs` is stubbed to throw,
  when the page loads, then the user sees the exact unsupported-browser
  message and the normal views are not rendered.
- Given the same failure mode, when the evaluator inspects the DOM and
  console, then no events can be inserted and no in-memory shim is in
  use (no writes succeed anywhere).
- Given a supported browser, when the page loads, then the error state
  is absent and all prior slices' acceptance criteria still hold.
- Given `node --test test/`, all tests remain green.

---

## Done definition

All nine slices pass their acceptance criteria, `node --test test/` is
green, the app serves cleanly from `python3 -m http.server 8000` at a
mobile viewport with no console errors, and no feature outside PRD.md
"Out of Scope" has been added.
