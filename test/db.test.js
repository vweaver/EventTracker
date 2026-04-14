// test/db.test.js — exercises the production SQL strings against
// better-sqlite3. Production code does NOT import better-sqlite3;
// only the tests do. See TECH_SPEC.md "Testing → db.test.js".

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DDL, SQL } from '../sql.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return db;
}

function listEvents(db) {
  return db.prepare(SQL.list).all().map((r) => ({
    id: Number(r.id),
    timestamp: String(r.timestamp),
    value: r.value ? 1 : 0,
  }));
}

test('fresh DB: listEvents() returns []', () => {
  const db = makeDb();
  assert.deepEqual(listEvents(db), []);
});
