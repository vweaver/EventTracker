// app.js — the only module that touches the DOM.
//
// Owns view routing and DOM wiring. Delegates all SQL to db.js and
// all pure math to aggregate.js.

import * as db from './db.js';
import { aggregate, bucketOf, bucketKey, BLOCKS, DOW_LABELS } from './aggregate.js';
import * as sync from './sync.js';

const root = document.getElementById('app');

// --- sync state (module-local) --------------------------------------------

const SETTING_TOKEN = 'telegram_token';
const SETTING_CHAT_ID = 'telegram_chat_id';
const SETTING_DEVICE_TAG = 'device_tag';
const SETTING_LAST_SYNC = 'last_sync_iso';

const AUTO_PUSH_DELAY_MS = 5000;
let autoPushTimer = null;
let pullInFlight = false; // suppresses auto-push during a pull+merge
let syncStatus = { state: 'idle', detail: '' };
let settingsStatusListener = null; // only the Settings view listens

function setSettingsStatusListener(fn) {
  settingsStatusListener = fn;
}
function setSyncStatus(next) {
  syncStatus = next;
  if (settingsStatusListener) {
    try { settingsStatusListener(syncStatus); } catch { /* ignore */ }
  }
}

async function getCreds() {
  const [token, chatId] = await Promise.all([
    db.getSetting(SETTING_TOKEN),
    db.getSetting(SETTING_CHAT_ID),
  ]);
  if (!token || chatId === undefined || chatId === null || chatId === '') {
    return null;
  }
  return { token, chatId };
}

async function ensureDeviceTag() {
  let tag = await db.getSetting(SETTING_DEVICE_TAG);
  if (!tag) {
    tag = Math.random().toString(36).slice(2, 8);
    await db.setSetting(SETTING_DEVICE_TAG, tag);
  }
  return tag;
}

function scheduleAutoPush() {
  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => {
    autoPushTimer = null;
    if (pullInFlight) return;
    runPush().catch((err) => {
      console.error('[EventTracker] auto-push failed', err);
    });
  }, AUTO_PUSH_DELAY_MS);
}

async function runPush() {
  const creds = await getCreds();
  if (!creds) return; // no-op when credentials missing
  setSyncStatus({ state: 'syncing', detail: 'Pushing…' });
  try {
    const [events, deviceTag] = await Promise.all([
      db.exportAll(),
      ensureDeviceTag(),
    ]);
    await sync.pushSnapshot({ ...creds, events, deviceTag });
    const iso = new Date().toISOString();
    await db.setSetting(SETTING_LAST_SYNC, iso);
    setSyncStatus({ state: 'ok', detail: `Synced ${iso}` });
  } catch (err) {
    setSyncStatus({ state: 'error', detail: shortErr(err) });
    throw err;
  }
}

async function runPull() {
  const creds = await getCreds();
  if (!creds) return;
  pullInFlight = true;
  setSyncStatus({ state: 'syncing', detail: 'Pulling…' });
  try {
    const remote = await sync.pullLatest(creds);
    if (remote && Array.isArray(remote.events)) {
      const local = await db.exportAll();
      const merged = sync.mergeSnapshots(local, remote.events);
      if (merged.added > 0 || merged.updated > 0) {
        await db.replaceAll(merged.events);
      }
      const iso = new Date().toISOString();
      await db.setSetting(SETTING_LAST_SYNC, iso);
      setSyncStatus({
        state: 'ok',
        detail:
          `Synced ${iso} (added ${merged.added}, updated ${merged.updated})`,
      });
    } else {
      setSyncStatus({ state: 'ok', detail: 'No remote snapshot found.' });
    }
  } catch (err) {
    setSyncStatus({ state: 'error', detail: shortErr(err) });
    throw err;
  } finally {
    pullInFlight = false;
  }
}

async function runSyncNow() {
  try {
    await runPull();
  } catch (err) {
    console.error('[EventTracker] pull failed', err);
  }
  try {
    await runPush();
  } catch (err) {
    console.error('[EventTracker] push failed', err);
  }
}

function shortErr(err) {
  if (!err) return 'unknown error';
  const msg = err.message || String(err);
  return msg.length > 120 ? msg.slice(0, 117) + '…' : msg;
}

// --- lifecycle -------------------------------------------------------------

async function start() {
  try {
    await db.init();
  } catch (err) {
    console.error('[EventTracker] init failed', err);
    renderUnsupported();
    return;
  }
  mountChrome();
  window.addEventListener('hashchange', onHashChange);
  if (!readViewFromHash()) {
    // No/unknown hash → default to log without adding history entry.
    history.replaceState(null, '', '#/log');
  }
  // Kick an auto-pull before first render if credentials are configured.
  // We don't block the initial render on it — the pull is best-effort.
  getCreds().then((creds) => {
    if (!creds) return;
    runPull()
      .then(() => {
        // If the current view shows events, re-render to reflect merged state.
        if (currentView === 'list' || currentView === 'grid') {
          renderCurrentView();
        }
      })
      .catch((err) => console.error('[EventTracker] initial pull failed', err));
  }).catch(() => {});
  onHashChange();
}

// --- chrome (nav) ----------------------------------------------------------

let tabBar = null;

function mountChrome() {
  if (tabBar) return;
  tabBar = document.createElement('nav');
  tabBar.className = 'tabbar';
  tabBar.setAttribute('aria-label', 'Primary');
  tabBar.innerHTML = `
    <button class="tab" data-view="log" type="button">Log</button>
    <button class="tab" data-view="list" type="button">List</button>
    <button class="tab" data-view="grid" type="button">Grid</button>
    <button class="tab" data-view="settings" type="button">Settings</button>
  `;
  document.body.appendChild(tabBar);
  for (const btn of tabBar.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      navigate(btn.dataset.view);
    });
  }
}

const KNOWN_VIEWS = new Set(['log', 'list', 'grid', 'settings']);
let currentView = 'log';

function readViewFromHash() {
  const m = (location.hash || '').match(/^#\/(log|list|grid|settings)$/);
  if (!m) return null;
  return m[1];
}

function navigate(view) {
  if (!KNOWN_VIEWS.has(view)) view = 'log';
  const target = `#/${view}`;
  if (location.hash === target) {
    renderCurrentView();
    return;
  }
  location.hash = target; // triggers hashchange → onHashChange
}

function onHashChange() {
  const v = readViewFromHash() || 'log';
  currentView = v;
  renderCurrentView();
}

function renderCurrentView() {
  // Drop any per-view subscription (only Settings uses one today).
  if (currentView !== 'settings') setSettingsStatusListener(null);
  if (currentView === 'list') return renderList();
  if (currentView === 'grid') return renderGrid();
  if (currentView === 'settings') return renderSettings();
  return renderLog();
}

// --- error state -----------------------------------------------------------

function renderUnsupported() {
  // Guarantee no nav chrome / views leak in the unsupported state.
  if (tabBar) {
    tabBar.remove();
    tabBar = null;
  }
  root.innerHTML = '';
  document.body.classList.add('unsupported');
  const box = document.createElement('section');
  box.className = 'error-state';
  const h1 = document.createElement('h1');
  h1.textContent = 'Storage unavailable';
  const p = document.createElement('p');
  // Exact text per TECH_SPEC.md "Error state".
  p.textContent =
    "This browser doesn't support local storage. Please use a current version of Chrome, Firefox, or Brave.";
  box.append(h1, p);
  root.appendChild(box);
}

// --- toast -----------------------------------------------------------------

let toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast--visible'), 1100);
}

// --- log view --------------------------------------------------------------

function renderLog() {
  root.innerHTML = '';
  setActiveTab('log');
  const view = document.createElement('section');
  view.className = 'view view--log';
  view.innerHTML = `
    <header class="view-header">
      <h1 class="view-title">Log</h1>
      <p class="view-sub">Tap to record an event now.</p>
    </header>
    <div class="live-buttons">
      <button
        id="btn-pos"
        class="tap tap--pos"
        type="button"
        aria-label="Record positive event"
      >
        <span class="tap-glyph">+</span>
        <span class="tap-label">Positive</span>
      </button>
      <button
        id="btn-neg"
        class="tap tap--neg"
        type="button"
        aria-label="Record negative event"
      >
        <span class="tap-glyph">−</span>
        <span class="tap-label">Negative</span>
      </button>
    </div>
    <details class="backdate">
      <summary class="backdate-summary">
        <span>Backdate</span>
        <span class="backdate-chevron" aria-hidden="true">▾</span>
      </summary>
      <div class="backdate-body">
        <label class="field">
          <span class="field-label">Date &amp; time</span>
          <input id="bd-when" type="datetime-local" class="field-input" />
        </label>
        <div class="backdate-buttons">
          <button id="bd-pos" class="pill pill--pos" type="button">Positive</button>
          <button id="bd-neg" class="pill pill--neg" type="button">Negative</button>
        </div>
      </div>
    </details>
  `;
  root.appendChild(view);
  view.querySelector('#btn-pos').addEventListener('click', () => onLive(1));
  view.querySelector('#btn-neg').addEventListener('click', () => onLive(0));

  const whenInput = view.querySelector('#bd-when');
  whenInput.value = nowLocalIso().slice(0, 16);
  const details = view.querySelector('details.backdate');
  details.addEventListener('toggle', () => {
    if (details.open) whenInput.value = nowLocalIso().slice(0, 16);
  });
  view.querySelector('#bd-pos').addEventListener('click', () =>
    onBackdate(whenInput, 1),
  );
  view.querySelector('#bd-neg').addEventListener('click', () =>
    onBackdate(whenInput, 0),
  );
}

function setActiveTab(name) {
  if (!tabBar) return;
  for (const btn of tabBar.querySelectorAll('.tab')) {
    btn.classList.toggle('tab--active', btn.dataset.view === name);
  }
}

async function onLive(value) {
  try {
    const ts = nowLocalIso();
    await db.insertEvent(ts, value);
    scheduleAutoPush();
    showToast('✓ Saved');
  } catch (err) {
    console.error('[EventTracker] insert failed', err);
    showToast('Save failed');
  }
}

async function onBackdate(input, value) {
  const raw = input.value;
  if (!raw) {
    showToast('Pick a date & time');
    return;
  }
  const ts = raw.length === 16 ? `${raw}:00` : raw;
  try {
    await db.insertEvent(ts, value);
    scheduleAutoPush();
    showToast('✓ Saved');
  } catch (err) {
    console.error('[EventTracker] backdate insert failed', err);
    showToast('Save failed');
  }
}

// --- list view -------------------------------------------------------------

async function renderList() {
  root.innerHTML = '';
  setActiveTab('list');
  const view = document.createElement('section');
  view.className = 'view view--list';
  view.innerHTML = `
    <header class="view-header">
      <h1 class="view-title">Events</h1>
      <p class="view-sub" id="list-count">Loading…</p>
    </header>
    <ul id="event-list" class="event-list"></ul>
  `;
  root.appendChild(view);

  const events = await db.listEvents();
  const countEl = view.querySelector('#list-count');
  const listEl = view.querySelector('#event-list');
  countEl.textContent =
    events.length === 0
      ? 'No events yet.'
      : `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  for (const e of events) {
    listEl.appendChild(renderRow(e));
  }
}

function renderRow(event) {
  const li = document.createElement('li');
  li.className = 'event-row';
  li.dataset.id = String(event.id);
  li.appendChild(renderRowView(event));
  return li;
}

function renderRowView(event) {
  const d = new Date(event.timestamp);
  const { block } = bucketOf(d);
  const dowLabel = DOW_LABELS[d.getDay()];
  const blockLabel = BLOCKS[block].label;
  const bucket = `${dowLabel} · ${blockLabel}`;
  const wrap = document.createElement('div');
  wrap.className = 'event-row-view';
  wrap.innerHTML = `
    <div class="event-main">
      <div class="event-ts">${escapeHtml(formatTimestamp(d))}</div>
      <div class="event-meta">
        <span class="badge ${event.value ? 'badge--pos' : 'badge--neg'}">
          ${event.value ? '+' : '−'}
        </span>
        <span class="event-bucket">${escapeHtml(bucket)}</span>
      </div>
    </div>
    <div class="event-actions">
      <button class="icon-btn" data-act="edit" type="button" aria-label="Edit event">Edit</button>
      <button class="icon-btn icon-btn--danger" data-act="del" type="button" aria-label="Delete event">Delete</button>
    </div>
  `;
  wrap.querySelector('[data-act="edit"]').addEventListener('click', () =>
    swapRowToEdit(event),
  );
  wrap.querySelector('[data-act="del"]').addEventListener('click', () =>
    onDelete(event),
  );
  return wrap;
}

function swapRowToEdit(event) {
  const li = findRowLi(event.id);
  if (!li) return;
  li.innerHTML = '';
  const form = document.createElement('form');
  form.className = 'event-row-edit';
  const initialWhen = event.timestamp.slice(0, 16);
  form.innerHTML = `
    <label class="field">
      <span class="field-label">Date &amp; time</span>
      <input type="datetime-local" name="ts" class="field-input" value="${escapeAttr(initialWhen)}" required />
    </label>
    <fieldset class="toggle">
      <legend class="field-label">Value</legend>
      <label class="toggle-opt">
        <input type="radio" name="value" value="1" ${event.value ? 'checked' : ''} />
        <span>Positive</span>
      </label>
      <label class="toggle-opt">
        <input type="radio" name="value" value="0" ${event.value ? '' : 'checked'} />
        <span>Negative</span>
      </label>
    </fieldset>
    <div class="edit-actions">
      <button type="button" class="pill" data-act="cancel">Cancel</button>
      <button type="submit" class="pill pill--accent">Save</button>
    </div>
  `;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const raw = form.ts.value;
    if (!raw) return;
    const ts = raw.length === 16 ? `${raw}:00` : raw;
    const val = form.value.value === '1' ? 1 : 0;
    try {
      await db.updateEvent(event.id, ts, val);
      scheduleAutoPush();
      showToast('✓ Updated');
      renderList();
    } catch (err) {
      console.error('[EventTracker] update failed', err);
      showToast('Update failed');
    }
  });
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    const updated = renderRowView(event);
    li.innerHTML = '';
    li.appendChild(updated);
  });
  li.appendChild(form);
}

async function onDelete(event) {
  const ok = window.confirm('Delete this event?');
  if (!ok) return;
  try {
    await db.deleteEvent(event.id);
    scheduleAutoPush();
    showToast('✓ Deleted');
    renderList();
  } catch (err) {
    console.error('[EventTracker] delete failed', err);
    showToast('Delete failed');
  }
}

function findRowLi(id) {
  return root.querySelector(`.event-row[data-id="${CSS.escape(String(id))}"]`);
}

// --- grid view -------------------------------------------------------------

async function renderGrid() {
  root.innerHTML = '';
  setActiveTab('grid');
  const view = document.createElement('section');
  view.className = 'view view--grid';
  view.innerHTML = `
    <header class="view-header">
      <h1 class="view-title">Grid</h1>
      <p class="view-sub">P(positive) by day &times; time block.</p>
    </header>
    <div class="grid-wrap">
      <table class="grid" aria-label="Positive probability per day and time block">
        <thead>
          <tr>
            <th scope="col" class="grid-corner"></th>
            ${DOW_LABELS.map((d) => `<th scope="col">${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody id="grid-body"></tbody>
      </table>
    </div>
  `;
  root.appendChild(view);

  const events = await db.listEvents();
  const agg = aggregate(events);
  const body = view.querySelector('#grid-body');
  for (const block of BLOCKS) {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('th');
    rowHead.scope = 'row';
    rowHead.className = 'grid-row-head';
    rowHead.textContent = block.label;
    tr.appendChild(rowHead);
    for (let dow = 0; dow < 7; dow++) {
      const cell = agg.get(bucketKey(dow, block.index));
      tr.appendChild(renderCell(cell));
    }
    body.appendChild(tr);
  }
}

function renderCell(cell) {
  const td = document.createElement('td');
  td.className = 'grid-cell';
  if (cell.total === 0) {
    td.classList.add('grid-cell--empty');
    td.innerHTML = `<div class="grid-pct">—</div><div class="grid-n">n = 0</div>`;
  } else {
    const pct = Math.round(cell.p * 100);
    // Red (0) -> green (120) hue ramp at constant S/L.
    td.style.backgroundColor = `hsl(${cell.p * 120}, 70%, 85%)`;
    td.innerHTML = `
      <div class="grid-pct">${pct}%</div>
      <div class="grid-n">n = ${cell.total}</div>
    `;
  }
  return td;
}

// --- settings view ---------------------------------------------------------

async function renderSettings() {
  root.innerHTML = '';
  setActiveTab('settings');
  const view = document.createElement('section');
  view.className = 'view view--settings';
  view.innerHTML = `
    <header class="view-header">
      <h1 class="view-title">Settings</h1>
      <p class="view-sub">Optional Telegram sync. All data stays on this device until you configure a bot.</p>
    </header>
    <div class="settings-status" id="sync-status" role="status" aria-live="polite"></div>
    <form class="settings-form" id="settings-form" autocomplete="off">
      <label class="field">
        <span class="field-label">Bot token</span>
        <input type="password" name="token" class="field-input" spellcheck="false" autocomplete="off" placeholder="123456:ABC-DEF…" />
      </label>
      <label class="field">
        <span class="field-label">Chat ID</span>
        <input type="number" name="chatId" class="field-input" inputmode="numeric" placeholder="e.g. 12345678" />
      </label>
      <p class="settings-help">
        Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>,
        message your bot once, then tap <strong>Detect chat ID</strong>.
      </p>
      <div class="settings-actions">
        <button type="button" class="pill" data-act="save">Save</button>
        <button type="button" class="pill" data-act="test">Test connection</button>
        <button type="button" class="pill" data-act="detect">Detect chat ID</button>
        <button type="button" class="pill pill--accent" data-act="sync-now">Sync now</button>
        <button type="button" class="pill pill--danger" data-act="forget">Forget credentials</button>
      </div>
      <div class="settings-meta" id="settings-meta"></div>
    </form>
  `;
  root.appendChild(view);

  const form = view.querySelector('#settings-form');
  const tokenInput = form.elements.token;
  const chatIdInput = form.elements.chatId;
  const statusEl = view.querySelector('#sync-status');
  const metaEl = view.querySelector('#settings-meta');

  async function refreshMeta() {
    const [deviceTag, lastSync] = await Promise.all([
      db.getSetting(SETTING_DEVICE_TAG),
      db.getSetting(SETTING_LAST_SYNC),
    ]);
    metaEl.textContent =
      `Device tag: ${deviceTag || '(not assigned yet)'} · ` +
      `Last sync: ${lastSync || 'never'}`;
  }

  function renderStatus() {
    const { state, detail } = syncStatus;
    statusEl.className = `settings-status settings-status--${state}`;
    const label = {
      idle: 'Idle',
      syncing: 'Syncing…',
      ok: 'Synced',
      error: 'Error',
    }[state] || state;
    statusEl.textContent = detail ? `${label}: ${detail}` : label;
  }
  // Only one Settings view exists at a time; rendering a different view
  // calls setActiveTab → future setSyncStatus calls find no listener.
  setSettingsStatusListener(renderStatus);

  // Load current values.
  const [token, chatId] = await Promise.all([
    db.getSetting(SETTING_TOKEN),
    db.getSetting(SETTING_CHAT_ID),
  ]);
  if (token) tokenInput.value = token;
  if (chatId !== undefined && chatId !== null) chatIdInput.value = chatId;
  renderStatus();
  refreshMeta();

  async function saveCreds() {
    const t = tokenInput.value.trim();
    const c = chatIdInput.value.trim();
    if (!t || !c) {
      setSyncStatus({ state: 'error', detail: 'Token and Chat ID required.' });
      return false;
    }
    await db.setSetting(SETTING_TOKEN, t);
    await db.setSetting(SETTING_CHAT_ID, Number(c));
    await ensureDeviceTag();
    await refreshMeta();
    setSyncStatus({ state: 'idle', detail: 'Saved.' });
    return true;
  }

  view.querySelector('[data-act="save"]').addEventListener('click', async () => {
    await saveCreds();
  });

  view.querySelector('[data-act="test"]').addEventListener('click', async () => {
    const t = tokenInput.value.trim();
    if (!t) {
      setSyncStatus({ state: 'error', detail: 'Enter a bot token first.' });
      return;
    }
    setSyncStatus({ state: 'syncing', detail: 'Calling getMe…' });
    try {
      const res = await sync.getMe({ token: t });
      if (res.ok) {
        const who = res.result && res.result.username
          ? '@' + res.result.username
          : JSON.stringify(res.result);
        setSyncStatus({ state: 'ok', detail: `Connected as ${who}` });
      } else {
        setSyncStatus({
          state: 'error',
          detail: res.description || 'getMe failed',
        });
      }
    } catch (err) {
      setSyncStatus({ state: 'error', detail: shortErr(err) });
    }
  });

  view.querySelector('[data-act="detect"]').addEventListener('click', async () => {
    const t = tokenInput.value.trim();
    if (!t) {
      setSyncStatus({ state: 'error', detail: 'Enter a bot token first.' });
      return;
    }
    setSyncStatus({ state: 'syncing', detail: 'Looking for a message…' });
    try {
      const id = await sync.detectChatId({ token: t });
      if (id === null) {
        setSyncStatus({
          state: 'error',
          detail: 'No recent messages. Send your bot a message, then retry.',
        });
        return;
      }
      chatIdInput.value = String(id);
      setSyncStatus({ state: 'ok', detail: `Detected chat ID ${id}` });
    } catch (err) {
      setSyncStatus({ state: 'error', detail: shortErr(err) });
    }
  });

  view.querySelector('[data-act="sync-now"]').addEventListener('click', async () => {
    // Save any edits first so Sync uses the shown values.
    const ok = await saveCreds();
    if (!ok) return;
    await runSyncNow();
    await refreshMeta();
  });

  view.querySelector('[data-act="forget"]').addEventListener('click', async () => {
    const really = window.confirm(
      'Remove the stored bot token, chat ID, and device tag? Events stay intact.',
    );
    if (!really) return;
    await db.deleteSetting(SETTING_TOKEN);
    await db.deleteSetting(SETTING_CHAT_ID);
    await db.deleteSetting(SETTING_DEVICE_TAG);
    await db.deleteSetting(SETTING_LAST_SYNC);
    tokenInput.value = '';
    chatIdInput.value = '';
    await refreshMeta();
    setSyncStatus({ state: 'idle', detail: 'Credentials removed.' });
  });
}

// --- formatting helpers ----------------------------------------------------

function formatTimestamp(d) {
  // "Mon 14 Apr 2026 · 09:12"
  const dow = DOW_LABELS[d.getDay()];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dow} ${day} ${mon} ${year} · ${hh}:${mm}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// Naive local ISO: YYYY-MM-DDTHH:MM:SS from the device clock.
function nowLocalIso(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

start();
