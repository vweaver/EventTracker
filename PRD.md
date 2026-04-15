# Event Frequency Recorder — Minimal Spec

**Purpose.** Capture binary (positive/negative) events via one-click input or backdated entry. Full CRUD on events. Compute historical P(positive) by day-of-week × time-block.

**Platform.** Single-page web app, mobile-first. Local browser storage (IndexedDB). All timestamps use device system time.

**Data Model.** Single IndexedDB object store `events` with fields `{id (auto), timestamp (ISO-8601 local string), value (0|1)}`. An index `by_timestamp` supports reverse-chron listing.

**Time Blocks (24h, no gaps/overlaps).** Block 1: 00:00–09:00 · Block 2: 09:00–12:00 · Block 3: 12:00–17:00 · Block 4: 17:00–24:00. Bounds are [start, end). Every event maps to exactly one block.

**Logging.** Two modes:

- **Live:** Two buttons (Positive / Negative). Store `{timestamp: now, value: true|false}`. Must be near-instant.
- **Backdate:** Datetime picker + Positive/Negative. Store `{timestamp: selected_datetime, value: true|false}`.

No other input required in either mode.

**Event List View.** All events in reverse-chronological list. Each row: timestamp, value, derived bucket. Per-row: edit (timestamp and/or value), delete with confirmation.

**Aggregation.** Map every event to one of 28 buckets: `(day_of_week, time_block)` where day = Sun–Sat. Per bucket: `P(positive) = positive_count / total_count`. If `total_count = 0`, P = null. Recompute on any create, update, or delete.

**Grid View.** 7-column (Sun–Sat) × 4-row grid. Each cell shows P (as %) and sample size n.

**Sync (optional).** A Settings view lets the user paste a Telegram bot token and chat ID. When configured, the app auto-pushes a JSON snapshot of the `events` store to the Telegram chat 5 seconds after any change (debounced), and pulls the most-recent snapshot on app open, merging remote events into the local store by id (newer-timestamp wins on conflict; unknown remote ids are inserted; local-only ids are preserved). Credentials live in a separate IndexedDB object store (`settings`) and never leave the device except in direct calls to `api.telegram.org`. Snapshots pushed to the chat contain only events, not credentials. Sync is purely additive — if credentials are not configured the app works exactly as before.

**Out of Scope.** Timezone handling, rolling windows, multiple event types, user-defined blocks, forecasting, cross-user aggregation.

**System in one sentence.** CRUD `{id, timestamp, boolean}` in local IndexedDB; on read, map all events into 28 day×block buckets and compute ratios; optionally mirror the store to a Telegram chat for cross-device continuity.
