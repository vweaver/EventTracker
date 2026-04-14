// db.js — SQLite-wasm + opfs-sahpool owner of all SQL.
//
// Pure data layer: no DOM, no view state. See TECH_SPEC.md
// "CRUD API (`db.js`)" and "Deployment & VFS choice" for the why
// behind the opfs-sahpool VFS choice.

import sqlite3InitModule from './vendor/sqlite-wasm/jswasm/sqlite3.mjs';
import { DDL, SQL } from './sql.js';

// Tag for errors the UI should surface as "unsupported browser".
export class OpfsUnavailableError extends Error {
  constructor(cause) {
    super('OPFS storage is unavailable in this browser.');
    this.name = 'OpfsUnavailableError';
    this.cause = cause;
  }
}

let _db = null;

/**
 * Install the opfs-sahpool VFS, open the durable DB, and run DDL.
 * Throws OpfsUnavailableError on any failure along that path.
 */
export async function init() {
  if (_db) return;
  let sqlite3;
  try {
    sqlite3 = await sqlite3InitModule();
  } catch (err) {
    throw new OpfsUnavailableError(err);
  }
  if (!sqlite3.installOpfsSAHPoolVfs) {
    throw new OpfsUnavailableError(
      new Error('installOpfsSAHPoolVfs not present in sqlite3 build'),
    );
  }
  let poolUtil;
  try {
    poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      name: 'eventtracker-pool',
    });
  } catch (err) {
    throw new OpfsUnavailableError(err);
  }
  try {
    _db = new poolUtil.OpfsSAHPoolDb('/events.sqlite');
    _db.exec(DDL);
  } catch (err) {
    throw new OpfsUnavailableError(err);
  }
}

function requireDb() {
  if (!_db) throw new Error('db.init() has not completed');
  return _db;
}

/**
 * Insert a new event. Returns the new row id.
 * @param {string} timestamp ISO-8601 string, naive (no tz).
 * @param {boolean|number} value coerced to 0/1.
 */
export async function insertEvent(timestamp, value) {
  const db = requireDb();
  const v = value ? 1 : 0;
  db.exec({ sql: SQL.insert, bind: [timestamp, v] });
  // last_insert_rowid() is scoped per-connection; fine for single-writer VFS.
  const [row] = db.exec({
    sql: SQL.lastRowid,
    returnValue: 'resultRows',
    rowMode: 'object',
  });
  return Number(row.id);
}

/** Full replace of both timestamp and value for the given id. */
export async function updateEvent(id, timestamp, value) {
  const db = requireDb();
  const v = value ? 1 : 0;
  db.exec({ sql: SQL.update, bind: [timestamp, v, id] });
}

/** Hard delete. */
export async function deleteEvent(id) {
  const db = requireDb();
  db.exec({ sql: SQL.delete, bind: [id] });
}

/** List all events, ordered timestamp DESC, id DESC. */
export async function listEvents() {
  const db = requireDb();
  const rows = db.exec({
    sql: SQL.list,
    returnValue: 'resultRows',
    rowMode: 'object',
  });
  // sqlite-wasm returns numbers; keep value strictly 0/1.
  return rows.map((r) => ({
    id: Number(r.id),
    timestamp: String(r.timestamp),
    value: r.value ? 1 : 0,
  }));
}
