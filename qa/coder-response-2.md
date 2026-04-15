# Coder Round 2 — Response

## Summary

This round is a storage pivot + sync feature, not a from-scratch
build. Round 1 shipped a working `sqlite-wasm + opfs-sahpool` app
that failed on Brave Android (Slice 9 error screen on the deployed
URL). Round 2 replaces the storage layer with IndexedDB and adds
optional Telegram-based sync so events survive device loss and sync
across devices.

All slices landed. `node --test` is green (37 tests). Local serve
verifies the manifest and all JS modules are served.

## Slices completed

- **Slice 1 (revised)** — scaffolding + IndexedDB `db.init()`.
  Hand-rolled promise wrapper over `indexedDB.open('eventtracker', 1)`,
  `events` object store (`keyPath: id`, autoIncrement) with
  `by_timestamp` index, plus a `settings` object store. `init()` also
  best-effort-calls `navigator.storage.persist()`.
- **Slice 9 (revised)** — the "OPFS unavailable" error state is now
  the "IndexedDB unavailable" error. Copy updated to "This browser
  doesn't support local storage. Please use a current version of
  Chrome, Firefox, or Brave."
- **Slice 10 (new)** — Settings view + Telegram sync.
  - New `sync.js` with `pushSnapshot`, `pullLatest`, `getMe`,
    `detectChatId`, and the pure `mergeSnapshots(local, remote)` helper.
  - `db.js` gained `exportAll`, `replaceAll`, `getSetting`,
    `setSetting`, `deleteSetting`.
  - `app.js` Settings view (`#/settings`), fourth bottom tab, sync
    status badge, auto-push debounce (5 s), auto-pull on app start.
- **Slice 11 (new)** — PWA manifest.

Slices 2 through 8 (CRUD, aggregation, Log view, backdate disclosure,
List view, Grid view, hash routing + mobile polish) continue to pass
their Round 1 acceptance criteria — this round didn't touch their
behavior.

## Tests

Running `npm test`:

```
# tests 37
# suites 0
# pass 37
# fail 0
```

Breakdown:
- `test/aggregate.test.js` — 12 cases (unchanged from Round 1).
- `test/db.test.js` — 11 cases on top of `fake-indexeddb/auto`,
  including the new `exportAll`/`replaceAll` and settings round-trip,
  plus a guardrail that `exportAll()` does not include the `settings`
  store contents (i.e. the bot token cannot leak into a snapshot).
- `test/sync.test.js` — 14 cases covering `pushSnapshot` request
  shape (with an explicit check that the token does NOT appear in
  the multipart caption or body bytes), `pullLatest` picking the
  newest matching snapshot, and every `mergeSnapshots` policy case
  (insert, no-op-on-identical, remote-newer, local-newer,
  tie-prefers-remote, local-only preserved, combined).

## Deployment / local run

```
python3 -m http.server 8000
```

Then visit <http://localhost:8000/#/log>. Local curl confirmed:

- `/` → 200, `<title>EventTracker</title>`, manifest linked, no
  reference to `vendor/sqlite-wasm` / `sql.js` / `schema.sql` (all
  deleted).
- `/manifest.webmanifest` → 200, valid JSON.
- `/app.js`, `/db.js`, `/sync.js`, `/assets/icon.svg` → 200.

Push to GitHub Pages picks up on merge to `master`. The Evaluator's
live-URL check from CLAUDE.md now expects the `<link rel="manifest">`
marker and NOT any sqlite-wasm references.

## Deviations from the plan

None substantive. Two small judgment calls worth flagging:

1. **Icon format.** The plan notes the environment may not be able
   to emit a real PNG; I shipped a compact SVG icon and referenced
   it from the manifest as `image/svg+xml` with `sizes: "any"` and
   `purpose: "any maskable"`. Modern Android Chromium and Brave
   accept SVG icons for PWA install prompts; if a specific device
   refuses to install without a PNG, a later slice can transcode to
   PNG with whatever build tool comes along.
2. **Settings status subscription.** Rather than a subscriber set +
   `DOMNodeRemovedFromDocument` (deprecated), I used a single
   module-local listener slot that's cleared whenever the router
   renders a non-Settings view. One active Settings view at a time is
   always true here, so the simpler model is correct and doesn't risk
   a memory leak.

## Files changed

- **Edited:** `PRD.md` (already updated ahead of this round),
  `TECH_SPEC.md`, `CLAUDE.md`, `plan/slices.md`, `db.js`, `app.js`,
  `index.html`, `styles.css`, `test/db.test.js`, `package.json`,
  `package-lock.json`.
- **New:** `sync.js`, `test/sync.test.js`,
  `manifest.webmanifest`, `assets/icon.svg`, `qa/coder-response-2.md`.
- **Deleted:** `vendor/sqlite-wasm/**`, `sql.js`, `schema.sql`.

## Known limitations

- **First `getUpdates` call assumes no active Telegram webhook.** The
  plan already notes this; if a user has set a webhook on the bot,
  pull silently returns no snapshot. The error state is visible in
  the Settings badge.
- **One-way merge on pull.** Local-only ids are preserved forever.
  If the user deletes an event on Device A, that deletion will not
  propagate to Device B through sync alone (it will reappear on the
  next pull). PRD round 2 explicitly calls out "unknown remote ids
  are inserted; local-only ids are preserved" as the intended
  behaviour; a tombstone-based reconcile can be a future slice if
  needed.
- **Auto-pull is best-effort.** A slow/failing pull on start does not
  block the initial render; the error surfaces in the Settings
  status badge. The alternative (blocking start on a network call)
  would re-introduce the Slice-9-style bad-UX we are pivoting away
  from.
