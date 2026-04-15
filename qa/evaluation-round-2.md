# Evaluator Round 2 — EventTracker

## Verdict: **BLOCKED**

The build itself is of PASS quality: 37/37 unit tests green; 24/24
mobile-viewport Playwright checks green (full CRUD, grid math, auto-push
debounce, Telegram mocked round-trip, credential-leak scan); the
unsupported-browser error path renders correctly. **However, the
CLAUDE.md-mandated live-URL check against
`https://vweaver.github.io/EventTracker/` cannot be performed from this
sandbox** — `curl` returns `Host not in allowlist` / HTTP 403. Per the
Evaluator contract in CLAUDE.md, when the sandbox cannot verify the
deploy the verdict is **BLOCKED** rather than PASS, and the orchestrator
is asked to verify GitHub Pages externally.

If the orchestrator confirms `https://vweaver.github.io/EventTracker/`
serves the current `master` and the `<link rel="manifest">` and the four
ES modules load without console errors, promote this round to **PASS**.
All functional thresholds are otherwise met with headroom.

## Live-URL check (mandatory per CLAUDE.md)

```
$ curl -sSL -w '\n---\nstatus: %{http_code}\n' https://vweaver.github.io/EventTracker/
Host not in allowlist
---
status: 403
```

This is the sandbox egress policy, not a repository issue. The source
tree on `master` has been inspected and would, in principle, serve
cleanly — but "the code would work" is not evidence of a green live
deploy, so this remains BLOCKED until externally confirmed.

## Per-criterion scores

### 1. Spec Conformance — 9 / 10 (threshold 7: PASS)

Every PRD line maps to visible behavior:

- IndexedDB storage with `events` (keyPath `id`, autoIncrement, index
  `by_timestamp`) and a separate `settings` store. Exactly matches
  TECH_SPEC.md "Data model".
- 28-bucket aggregation, half-open `[start, end)` boundaries confirmed
  by a live Playwright probe: `bucketOf(new Date('2026-04-13T09:00:00'))`
  returns `{ block: 1 }` (09–12) rather than 0 — the canonical PRD
  half-open check.
- `aggregate.js` is pure; `bucketOf` + `aggregate` shape matches the
  spec. All 28 keys present on empty input; `p === null` when `total === 0`.
- Live mode, backdate disclosure, reverse-chron list, inline edit,
  confirm-gated delete, 7×4 grid with `NN%` / `n = k` cells, neutral
  cells for `n === 0`, `hsl(P*120, 70%, 85%)` shading — all observed.
- Hash routing (`#/log`, `#/list`, `#/grid`, `#/settings`), bottom
  tab bar, manifest linked from `index.html`.
- Telegram sync: `pushSnapshot` sends multipart to
  `api.telegram.org/bot<TOKEN>/sendDocument` with `chat_id`, a
  `application/json` document, and a caption starting with
  `eventtracker-`. Mocked end-to-end works.
- Out-of-scope lines respected: no timezones, no rolling windows, no
  multi-event types, no forecasting.

−1 for one minor oddity: `replaceAll` iterates the store's `put()`
calls inside a single `readwrite` transaction, but awaits each
`reqToPromise` sequentially. IndexedDB closes transactions the moment
the microtask queue idles, so mixing `await txDone` on the same tx
with previously-resolved child requests is risky on some engines. In
practice `fake-indexeddb` and Chromium tolerate it and the test-suite
exercises it (`replaceAll` wipes + repopulates atomically). Noting as
a latent concern, not a current defect.

### 2. Functionality & Reliability — 9 / 10 (threshold 7: PASS)

- `npm test` → 37 pass, 0 fail:
  ```
  # tests 37
  # pass 37
  # fail 0
  ```
  Breakdown: aggregate (12), db (11, including "token does not leak
  from `exportAll`"), sync (14, including `pushSnapshot` request
  shape, `pullLatest` newest-match, every `mergeSnapshots` rule).
- Playwright on Chromium mobile (`iPhone 14` preset) drove the full
  app this round — IndexedDB has no SAB / OPFS gate, unlike round 1 —
  and 24/24 assertions pass. Specifically observed:
  - Default `#/log` on bare load, no console errors.
  - Live Positive tap persists across a page reload (`db.listEvents()`
    reports `value: 1`).
  - Backdate `2026-03-01T09:00` → list row bucket label
    `Sun · 09–12`.
  - Inline edit (`2026-04-13T10:00` + Negative) persists across reload.
  - `window.confirm` dismiss keeps the row; accept removes it.
  - Empty DB → all 28 grid cells show `—` / `n = 0`.
  - 3 positive + 1 negative at `2026-04-15T13:xx..15:00` yields the
    Wed · 12–17 cell at `75%` / `n = 4` with greenish shade
    (`rgb(217, 244, 190)`), confirming both math and colour ramp.
- Unsupported-browser path simulated by stubbing `window.indexedDB` to
  `undefined`: page shows the exact PRD copy ("This browser doesn't
  support local storage. Please use a current version of Chrome,
  Firefox, or Brave."), no tabbar, no Log buttons — i.e. no silent
  in-memory fallback.

−1 because I could not verify a real network call against Telegram
(and, in fairness, shouldn't — all sync testing used a stubbed
`window.fetch`). This matches the Coder's note that real-bot
verification is out of scope for CI.

### 3. Mobile UX & Visual Polish — 7 / 10 (threshold 5: PASS)

- Tap targets: the live Positive button measures **140 px** tall at
  the iPhone 14 viewport — well above the 64 px minimum called out in
  TECH_SPEC.md and the global 44 px CLAUDE.md floor.
- Palette is a considered warm-neutral (`--bg: #faf7f1`, `--fg:
  #1b1d21`, soft Pos/Neg accents) exposed as CSS custom properties,
  with a dedicated dark-mode block. No Bootstrap/Tailwind defaults.
- Font stack is deliberate: `ui-rounded` body, an `Iowan Old
  Style`-first serif `--font-display` for the grid percentages — the
  "characterful display accent" CLAUDE.md asks for.
- No purple-to-indigo gradients, no glassmorphism, no `backdrop-filter`,
  no fake "AI" badges. Grepping `styles.css` for `purple|indigo|glass`
  returns only the comment explicitly disclaiming them.
- Bottom tabbar is fixed and within thumb reach; four tabs (Log / List
  / Grid / Settings) fit comfortably on a 390 px viewport.

−3 because this remains a purely headless visual inspection: I did
not capture a screenshot nor verify safe-area insets on a notched
device. Visual review at the bytes-level looks good; fit-and-finish on
real hardware (sticky-tap flash colours, reduced-motion handling) is
unexamined this round.

### 4. Code Hygiene — 9 / 10 (threshold 5: PASS)

- Module boundaries:
  - `db.js` touches only IndexedDB (`indexedDB`, `navigator.storage`).
    `grep` for `document\.` / `window\.` / `localStorage` returns no
    matches.
  - `app.js` is the only DOM-touching module.
  - `sync.js` is pure network + the pure `mergeSnapshots` helper —
    the only `document.` hits are the Telegram `msg.document` field,
    not the DOM `document`. No IndexedDB imports. Good.
  - `aggregate.js` is pure.
- `vendor/sqlite-wasm/`, `sql.js`, `schema.sql` are **deleted**. No
  source file references them; only historical QA markdown does.
- `package.json` has a single devDependency (`fake-indexeddb ^6.0.0`)
  and no runtime dependencies. `"type": "module"`, test script is
  `node --test 'test/*.test.js'`.
- `manifest.webmanifest` is valid JSON with `name`, `short_name`,
  `start_url`, `display: "standalone"`, `theme_color`, and an `icons`
  array that references the real `./assets/icon.svg` (the file
  exists). `index.html` has `<link rel="manifest" href="./manifest.webmanifest">`.
- Security posture on the token: the token is stored in the `settings`
  object store (key `telegram_token`); `exportAll()` hits only the
  `events` store; the Playwright-captured `sendDocument` body contains
  only `{"events":[...]}` (verified by both a substring scan for the
  fake-token string and a JSON parse showing only an `events` key).
  Token appears only in the URL path, as the Telegram API requires.

−1 for the same `replaceAll` observation as Spec Conformance; not a
hygiene problem per se, just something I'd rewrite as an explicit
Promise.all over puts within the tx.

## Bug list

None blocking. Two advisory notes:

### A1. `replaceAll` mixes `await` on a long-running readwrite tx

- **Reproduction:** call `replaceAll(events)` with a large array on a
  browser that auto-commits idle transactions (notably older WebKit).
- **Actual:** works under `fake-indexeddb` and Chromium 128+.
- **Expected per TECH_SPEC.md "CRUD API":** "Single transaction: clear
  + put each. Used by merge." — the current code is structurally
  correct but relies on the transaction staying alive across each
  `await reqToPromise`. Chromium implements "transaction stays live
  while a request is outstanding on it" specifically for this pattern,
  but the implementation would be more defensive if it fired all
  `put()` calls synchronously and only awaited `txDone(tx)` at the
  end.
- **Location:** `db.js:192-204`.

### A2. No visual/perf regression test for the Grid view

- Grid re-renders from scratch on every view change. Fine for now at
  the expected event volumes, but the re-render writes inline
  `style.backgroundColor` per cell — if the event count grows into
  the thousands, the cursor walk + aggregate is still O(n) and
  dominates. Not a bug, just a future consideration.
- **Location:** `app.js:508-548`.

## Deploy status

Live URL verification is the single blocker. Source tree, tests, and
local Playwright run are all green.

- `curl https://vweaver.github.io/EventTracker/` → blocked by sandbox
  egress policy (HTTP 403, "Host not in allowlist"). Not a repository
  problem.
- Local serve (`python3 -m http.server 8000`, already running in this
  sandbox on port 8000) confirms:
  - `GET /` → 200, HTML contains `<title>EventTracker</title>`,
    `<link rel="manifest" href="./manifest.webmanifest">`, and
    `<script type="module" src="./app.js">`.
  - `GET /manifest.webmanifest` → 200, valid JSON.
  - `GET /app.js`, `/db.js`, `/sync.js`, `/aggregate.js`,
    `/styles.css`, `/assets/icon.svg` → all 200.
- Source-level grep confirms no remaining reference to `vendor/`,
  `sqlite-wasm`, `sql.js`, or `schema.sql` in runtime code.

## Files changed by Coder round 2 (verified)

- Added: `sync.js`, `test/sync.test.js`, `manifest.webmanifest`,
  `assets/icon.svg`.
- Rewritten: `db.js` (IndexedDB), `app.js` (Settings view + auto-sync),
  `index.html` (manifest link), `styles.css`, `test/db.test.js`.
- Removed: `vendor/sqlite-wasm/**`, `sql.js`, `schema.sql`.
- Re-pinned: `package.json` now lists only `fake-indexeddb` as a dev
  dep.

## Recommendation

Promote to **PASS** as soon as the orchestrator (or a human) confirms
`https://vweaver.github.io/EventTracker/` loads the current master,
the four modules 200, the manifest is linked, and no console errors
fire on a mobile Chrome/Brave page load. No code changes required for
Round 3 barring that verification.
