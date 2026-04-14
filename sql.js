// sql.js — shared SQL strings for production (db.js) and tests
// (test/db.test.js via better-sqlite3). Keeps "tests share the SQL,
// not the driver" from TECH_SPEC.md "Testing → db.test.js" honest.
//
// No imports, no side effects. Safe for both the browser (via db.js)
// and Node (via the test harness).

export const DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL,
    value     INTEGER NOT NULL CHECK(value IN (0, 1))
  );
  CREATE INDEX IF NOT EXISTS events_ts ON events(timestamp);
`;

export const SQL = {
  insert: 'INSERT INTO events (timestamp, value) VALUES (?, ?)',
  update: 'UPDATE events SET timestamp = ?, value = ? WHERE id = ?',
  delete: 'DELETE FROM events WHERE id = ?',
  list: 'SELECT id, timestamp, value FROM events ORDER BY timestamp DESC, id DESC',
  lastRowid: 'SELECT last_insert_rowid() AS id',
};
