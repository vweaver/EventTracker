// db.js — IndexedDB owner of all on-device storage.
//
// Pure data layer: no DOM, no view state. See TECH_SPEC.md
// "Data model", "CRUD API (`db.js`)", and "Telegram sync" for the
// shape of the exports. A tiny hand-rolled promise wrapper sits over
// the raw IDB request API — no third-party dep.

// Tag for errors the UI should surface as "unsupported browser".
export class StorageUnavailableError extends Error {
  constructor(cause) {
    super('IndexedDB is unavailable in this browser.');
    this.name = 'StorageUnavailableError';
    this.cause = cause;
  }
}

const DB_NAME = 'eventtracker';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const EVENTS_INDEX = 'by_timestamp';
const SETTINGS_STORE = 'settings';

let _db = null;

/**
 * Promise wrapper around indexedDB.open.
 * Throws StorageUnavailableError on any failure along that path.
 */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new StorageUnavailableError(new Error('indexedDB is not defined')));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new StorageUnavailableError(err));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex(EVENTS_INDEX, 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageUnavailableError(req.error));
    req.onblocked = () =>
      reject(new StorageUnavailableError(new Error('indexedDB open blocked')));
  });
}

/**
 * Open the durable DB and request persistent storage.
 * Throws StorageUnavailableError if IndexedDB cannot be opened.
 */
export async function init() {
  if (_db) return;
  _db = await openDb();
  // Request persistent storage so the browser won't evict our data
  // under storage pressure. Best-effort: log and ignore rejections.
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      const persisted = await navigator.storage.persist();
      // eslint-disable-next-line no-console
      console.log('[EventTracker] storage.persist() =>', persisted);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[EventTracker] storage.persist() failed', err);
  }
}

/** For tests: drop the cached handle (used alongside fake-indexeddb resets). */
export function _resetForTests() {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
  }
  _db = null;
}

function requireDb() {
  if (!_db) throw new Error('db.init() has not completed');
  return _db;
}

function txStore(storeName, mode) {
  const db = requireDb();
  const tx = db.transaction(storeName, mode);
  return { tx, store: tx.objectStore(storeName) };
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('tx aborted'));
  });
}

// --- event CRUD ------------------------------------------------------------

/**
 * Insert a new event. Returns the new row id.
 * @param {string} timestamp ISO-8601 string, naive (no tz).
 * @param {boolean|number} value coerced to 0/1.
 */
export async function insertEvent(timestamp, value) {
  const v = value ? 1 : 0;
  const { tx, store } = txStore(EVENTS_STORE, 'readwrite');
  const id = await reqToPromise(store.add({ timestamp, value: v }));
  await txDone(tx);
  return Number(id);
}

/** Full replace of both timestamp and value for the given id. */
export async function updateEvent(id, timestamp, value) {
  const v = value ? 1 : 0;
  const { tx, store } = txStore(EVENTS_STORE, 'readwrite');
  await reqToPromise(store.put({ id: Number(id), timestamp, value: v }));
  await txDone(tx);
}

/** Hard delete. */
export async function deleteEvent(id) {
  const { tx, store } = txStore(EVENTS_STORE, 'readwrite');
  await reqToPromise(store.delete(Number(id)));
  await txDone(tx);
}

/** List all events, ordered timestamp DESC, id DESC. */
export async function listEvents() {
  const { store } = txStore(EVENTS_STORE, 'readonly');
  const index = store.index(EVENTS_INDEX);
  // Walk the index in descending timestamp order.
  const rows = await new Promise((resolve, reject) => {
    const req = index.openCursor(null, 'prev');
    const out = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(out);
      const r = cursor.value;
      out.push({
        id: Number(r.id),
        timestamp: String(r.timestamp),
        value: r.value ? 1 : 0,
      });
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  // Stable secondary sort: id DESC within equal timestamp. The cursor
  // alone gives insertion-order ties, which doesn't match the old
  // "ORDER BY timestamp DESC, id DESC" guarantee.
  rows.sort((a, b) => {
    if (a.timestamp < b.timestamp) return 1;
    if (a.timestamp > b.timestamp) return -1;
    return b.id - a.id;
  });
  return rows;
}

/** Same shape as listEvents(); intended for the sync snapshot. */
export async function exportAll() {
  return listEvents();
}

/**
 * Atomic replace of the `events` store with the given array.
 * Preserves ids (they're part of the records). Does NOT touch settings.
 */
export async function replaceAll(events) {
  const { tx, store } = txStore(EVENTS_STORE, 'readwrite');
  await reqToPromise(store.clear());
  for (const e of events) {
    const rec = {
      id: Number(e.id),
      timestamp: String(e.timestamp),
      value: e.value ? 1 : 0,
    };
    await reqToPromise(store.put(rec));
  }
  await txDone(tx);
}

// --- settings store (kept out of snapshots) --------------------------------

export async function getSetting(key) {
  const { store } = txStore(SETTINGS_STORE, 'readonly');
  const row = await reqToPromise(store.get(key));
  return row ? row.value : undefined;
}

export async function setSetting(key, value) {
  const { tx, store } = txStore(SETTINGS_STORE, 'readwrite');
  await reqToPromise(store.put({ key, value }));
  await txDone(tx);
}

export async function deleteSetting(key) {
  const { tx, store } = txStore(SETTINGS_STORE, 'readwrite');
  await reqToPromise(store.delete(key));
  await txDone(tx);
}
