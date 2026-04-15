// test/db.test.js — exercises the real db.js module on top of
// fake-indexeddb/auto. See TECH_SPEC.md "Testing → db.test.js".
//
// fake-indexeddb/auto installs globals (indexedDB, IDBKeyRange, etc.)
// before db.js is evaluated, so db.js's raw IDB calls Just Work.

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

// Import lazily so the auto-install runs first.
const db = await import('../db.js');

// Swap in a fresh database for each test to keep them independent.
async function freshDb() {
  db._resetForTests();
  // Reset the underlying fake-indexeddb engine so autoincrement ids
  // start from 1 in every test.
  const { default: FDBFactory } = await import('fake-indexeddb/lib/FDBFactory');
  globalThis.indexedDB = new FDBFactory();
  await db.init();
}

test('fresh DB: listEvents() returns []', async () => {
  await freshDb();
  assert.deepEqual(await db.listEvents(), []);
});

test('insertEvent returns id and row is retrievable with value=1', async () => {
  await freshDb();
  const id = await db.insertEvent('2026-04-14T10:15:00', true);
  assert.equal(typeof id, 'number');
  const rows = await db.listEvents();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].timestamp, '2026-04-14T10:15:00');
  assert.equal(rows[0].value, 1);
});

test('insertEvent coerces false to value=0', async () => {
  await freshDb();
  const id = await db.insertEvent('2026-04-14T10:15:00', false);
  const rows = await db.listEvents();
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].value, 0);
});

test('updateEvent modifies both timestamp and value', async () => {
  await freshDb();
  const id = await db.insertEvent('2026-04-14T10:15:00', true);
  await db.updateEvent(id, '2026-04-13T09:00:00', false);
  const rows = await db.listEvents();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].timestamp, '2026-04-13T09:00:00');
  assert.equal(rows[0].value, 0);
});

test('deleteEvent removes the row', async () => {
  await freshDb();
  const id = await db.insertEvent('2026-04-14T10:15:00', true);
  await db.deleteEvent(id);
  assert.deepEqual(await db.listEvents(), []);
});

test('listEvents orders by timestamp DESC then id DESC', async () => {
  await freshDb();
  const id1 = await db.insertEvent('2026-01-01T08:00:00', true);
  const id2 = await db.insertEvent('2026-02-01T08:00:00', false);
  const id3 = await db.insertEvent('2026-03-01T08:00:00', true);
  const rows = await db.listEvents();
  assert.deepEqual(
    rows.map((r) => r.id),
    [id3, id2, id1],
  );
});

test('listEvents: tie on timestamp breaks by id DESC', async () => {
  await freshDb();
  const id1 = await db.insertEvent('2026-04-14T10:15:00', true);
  const id2 = await db.insertEvent('2026-04-14T10:15:00', false);
  const rows = await db.listEvents();
  assert.deepEqual(
    rows.map((r) => r.id),
    [id2, id1],
  );
});

test('exportAll() returns the same shape as listEvents()', async () => {
  await freshDb();
  await db.insertEvent('2026-03-01T08:00:00', true);
  await db.insertEvent('2026-04-01T10:00:00', false);
  const list = await db.listEvents();
  const exp = await db.exportAll();
  assert.deepEqual(exp, list);
});

test('replaceAll() wipes existing and repopulates atomically', async () => {
  await freshDb();
  await db.insertEvent('2026-04-14T10:15:00', true);
  await db.insertEvent('2026-04-14T10:16:00', false);
  await db.replaceAll([
    { id: 100, timestamp: '2026-05-01T09:00:00', value: 1 },
    { id: 101, timestamp: '2026-05-02T09:00:00', value: 0 },
  ]);
  const rows = await db.listEvents();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.id),
    [101, 100],
  );
  assert.equal(rows[0].timestamp, '2026-05-02T09:00:00');
});

test('settings: get/set/delete round-trip', async () => {
  await freshDb();
  assert.equal(await db.getSetting('token'), undefined);
  await db.setSetting('token', 'xyz:123');
  assert.equal(await db.getSetting('token'), 'xyz:123');
  await db.setSetting('token', 'newval');
  assert.equal(await db.getSetting('token'), 'newval');
  await db.deleteSetting('token');
  assert.equal(await db.getSetting('token'), undefined);
});

test('settings: exportAll() does NOT include settings', async () => {
  await freshDb();
  await db.setSetting('token', 'secret-bot-token');
  await db.setSetting('chatId', 42);
  await db.insertEvent('2026-04-14T10:15:00', true);
  const exported = await db.exportAll();
  const json = JSON.stringify(exported);
  assert.equal(exported.length, 1);
  assert.ok(!json.includes('secret-bot-token'));
  assert.ok(!json.includes('"token"'));
});
