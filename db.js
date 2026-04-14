// db.js — SQLite-wasm + opfs-sahpool owner of all SQL.
//
// Pure data layer: no DOM, no view state. See TECH_SPEC.md
// "CRUD API (`db.js`)" and "Deployment & VFS choice" for the why
// behind the opfs-sahpool VFS choice.
//
// Slice 1: init + listEvents stub. Full CRUD arrives in Slice 2.

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

/** List all events, ordered timestamp DESC, id DESC. */
export async function listEvents() {
  const db = requireDb();
  const rows = db.exec({
    sql: SQL.list,
    returnValue: 'resultRows',
    rowMode: 'object',
  });
  return rows.map((r) => ({
    id: Number(r.id),
    timestamp: String(r.timestamp),
    value: r.value ? 1 : 0,
  }));
}
