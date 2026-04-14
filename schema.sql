-- Source of truth for the DDL. Kept as a sibling of db.js so both the
-- production sqlite-wasm path (db.js) and the Node test path
-- (test/db.test.js via better-sqlite3) run the same statements.
--
-- See TECH_SPEC.md "Data model".

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT    NOT NULL,
  value     INTEGER NOT NULL CHECK(value IN (0, 1))
);

CREATE INDEX IF NOT EXISTS events_ts ON events(timestamp);
