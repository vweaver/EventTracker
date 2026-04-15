// sync.js — Telegram sync layer. Pure network + data.
//
// No DOM, no IndexedDB state of its own. See TECH_SPEC.md
// "Telegram sync (`sync.js` + `mergeSnapshots`)". app.js orchestrates
// the IDB reads/writes; this module only talks to api.telegram.org
// and exposes the pure mergeSnapshots() helper.

const CAPTION_PREFIX = 'eventtracker-';

/**
 * POST a JSON snapshot of `events` to Telegram as a document upload.
 * Returns `{ ok: true, messageId }` on success.
 *
 * @param {{ token: string, chatId: number|string, events: object[], deviceTag: string }} opts
 */
export async function pushSnapshot({ token, chatId, events, deviceTag }) {
  requireString(token, 'token');
  if (chatId === undefined || chatId === null || chatId === '') {
    throw new Error('chatId is required');
  }
  if (!Array.isArray(events)) {
    throw new Error('events must be an array');
  }
  const tag = deviceTag || 'device';
  const isoTs = new Date().toISOString();
  const caption = `${CAPTION_PREFIX}${isoTs}-${tag}`;

  const json = JSON.stringify({ events });
  const blob = new Blob([json], { type: 'application/json' });

  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('caption', caption);
  fd.append('document', blob, 'eventtracker.json');

  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendDocument`;
  const res = await fetch(url, { method: 'POST', body: fd });
  const body = await res.json();
  if (!body.ok) {
    throw new Error(`sendDocument failed: ${body.description || res.status}`);
  }
  return { ok: true, messageId: body.result.message_id };
}

/**
 * Find the most-recent EventTracker snapshot in the given chat, download
 * it, parse it. Returns null if no matching snapshot exists.
 *
 * @param {{ token: string, chatId: number|string }} opts
 */
export async function pullLatest({ token, chatId }) {
  requireString(token, 'token');
  if (chatId === undefined || chatId === null || chatId === '') {
    throw new Error('chatId is required');
  }
  const normalizedChatId = Number(chatId);
  const updatesUrl =
    `https://api.telegram.org/bot${encodeURIComponent(token)}` +
    `/getUpdates?offset=-100&timeout=0`;
  const updatesRes = await fetch(updatesUrl);
  const updatesBody = await updatesRes.json();
  if (!updatesBody.ok) {
    throw new Error(
      `getUpdates failed: ${updatesBody.description || updatesRes.status}`,
    );
  }
  // Walk in reverse so we pick the newest matching snapshot first.
  const updates = Array.isArray(updatesBody.result) ? updatesBody.result : [];
  let target = null;
  for (let i = updates.length - 1; i >= 0; i--) {
    const msg = updates[i] && updates[i].message;
    if (!msg || !msg.document) continue;
    if (Number(msg.chat && msg.chat.id) !== normalizedChatId) continue;
    const cap = typeof msg.caption === 'string' ? msg.caption : '';
    if (!cap.startsWith(CAPTION_PREFIX)) continue;
    if (msg.document.mime_type !== 'application/json') continue;
    target = msg;
    break;
  }
  if (!target) return null;

  const fileId = target.document.file_id;
  const fileRes = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const fileBody = await fileRes.json();
  if (!fileBody.ok) {
    throw new Error(
      `getFile failed: ${fileBody.description || fileRes.status}`,
    );
  }
  const filePath = fileBody.result.file_path;
  const downloadUrl =
    `https://api.telegram.org/file/bot${encodeURIComponent(token)}/${filePath}`;
  const download = await fetch(downloadUrl);
  if (!download.ok) {
    throw new Error(`download failed: ${download.status}`);
  }
  const parsed = await download.json();
  const events = Array.isArray(parsed) ? parsed : parsed.events;
  if (!Array.isArray(events)) {
    throw new Error('snapshot payload has no events array');
  }
  return {
    events: events.map(normalizeEvent),
    messageId: target.message_id,
    capturedAt: target.date
      ? new Date(target.date * 1000).toISOString()
      : null,
  };
}

/** Lightweight ping — used by the Settings "Test connection" button. */
export async function getMe({ token }) {
  requireString(token, 'token');
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`,
  );
  return res.json();
}

/**
 * Returns the chat.id of the most-recent message the bot has seen, or
 * null when no updates exist. Used by "Detect chat ID" in Settings.
 */
export async function detectChatId({ token }) {
  requireString(token, 'token');
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}` +
      `/getUpdates?offset=-100&timeout=0`,
  );
  const body = await res.json();
  if (!body.ok) {
    throw new Error(`getUpdates failed: ${body.description || res.status}`);
  }
  const updates = Array.isArray(body.result) ? body.result : [];
  for (let i = updates.length - 1; i >= 0; i--) {
    const msg = updates[i] && updates[i].message;
    if (msg && msg.chat && typeof msg.chat.id === 'number') {
      return msg.chat.id;
    }
  }
  return null;
}

// --- pure merge ------------------------------------------------------------

/**
 * Merge a remote snapshot into a local event list by id. See TECH_SPEC.md
 * "Merge policy".
 *
 * Rules:
 * - Unknown ids from remote are inserted.
 * - Ids in both, differing payload: later timestamp wins; tie → remote.
 * - Ids local-only are preserved (one-way merge).
 *
 * Returns `{ events, added, updated, removed }`. `events` is sorted the
 * same way as db.listEvents() (timestamp desc, id desc). `removed` is
 * always 0 under the current policy but is returned for symmetry.
 *
 * @param {object[]} local
 * @param {object[]} remote
 */
export function mergeSnapshots(local, remote) {
  const localArr = Array.isArray(local) ? local : [];
  const remoteArr = Array.isArray(remote) ? remote : [];
  const byId = new Map();
  let added = 0;
  let updated = 0;
  for (const e of localArr) {
    byId.set(Number(e.id), normalizeEvent(e));
  }
  for (const r of remoteArr) {
    const id = Number(r.id);
    const norm = normalizeEvent(r);
    if (!byId.has(id)) {
      byId.set(id, norm);
      added += 1;
      continue;
    }
    const existing = byId.get(id);
    if (
      existing.timestamp === norm.timestamp &&
      existing.value === norm.value
    ) {
      continue;
    }
    // Conflict: choose the later timestamp; ties go to remote.
    if (norm.timestamp >= existing.timestamp) {
      byId.set(id, norm);
      updated += 1;
    }
  }
  const events = [...byId.values()];
  events.sort((a, b) => {
    if (a.timestamp < b.timestamp) return 1;
    if (a.timestamp > b.timestamp) return -1;
    return b.id - a.id;
  });
  return { events, added, updated, removed: 0 };
}

// --- helpers ---------------------------------------------------------------

function normalizeEvent(e) {
  return {
    id: Number(e.id),
    timestamp: String(e.timestamp),
    value: e.value ? 1 : 0,
  };
}

function requireString(v, name) {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`${name} is required`);
  }
}
