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

// Thin wrappers that mirror db.js's API, using the shared SQL.
function insertEvent(db, timestamp, value) {
  db.prepare(SQL.insert).run(timestamp, value ? 1 : 0);
  return db.prepare(SQL.lastRowid).get().id;
}
function updateEvent(db, id, timestamp, value) {
  db.prepare(SQL.update).run(timestamp, value ? 1 : 0, id);
}
function deleteEvent(db, id) {
  db.prepare(SQL.delete).run(id);
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

test('insertEvent returns id and row is retrievable with value=1', () => {
  const db = makeDb();
  const id = insertEvent(db, '2026-04-14T10:15:00', true);
  assert.equal(typeof id, 'number');
  const rows = listEvents(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].timestamp, '2026-04-14T10:15:00');
  assert.equal(rows[0].value, 1);
});

test('insertEvent coerces false to value=0', () => {
  const db = makeDb();
  const id = insertEvent(db, '2026-04-14T10:15:00', false);
  const rows = listEvents(db);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].value, 0);
});

test('updateEvent modifies both timestamp and value', () => {
  const db = makeDb();
  const id = insertEvent(db, '2026-04-14T10:15:00', true);
  updateEvent(db, id, '2026-04-13T09:00:00', false);
  const rows = listEvents(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].timestamp, '2026-04-13T09:00:00');
  assert.equal(rows[0].value, 0);
});

test('deleteEvent removes the row', () => {
  const db = makeDb();
  const id = insertEvent(db, '2026-04-14T10:15:00', true);
  deleteEvent(db, id);
  assert.deepEqual(listEvents(db), []);
});

test('listEvents orders by timestamp DESC then id DESC', () => {
  const db = makeDb();
  const id1 = insertEvent(db, '2026-01-01T08:00:00', true);
  const id2 = insertEvent(db, '2026-02-01T08:00:00', false);
  const id3 = insertEvent(db, '2026-03-01T08:00:00', true);
  const rows = listEvents(db);
  assert.deepEqual(
    rows.map((r) => r.id),
    [id3, id2, id1],
  );
});

test('listEvents: tie on timestamp breaks by id DESC', () => {
  const db = makeDb();
  const id1 = insertEvent(db, '2026-04-14T10:15:00', true);
  const id2 = insertEvent(db, '2026-04-14T10:15:00', false);
  const rows = listEvents(db);
  assert.deepEqual(
    rows.map((r) => r.id),
    [id2, id1],
  );
});

test('CHECK constraint: value must be 0 or 1', () => {
  const db = makeDb();
  assert.throws(() =>
    db.prepare(SQL.insert).run('2026-04-14T10:15:00', 2),
  );
});
