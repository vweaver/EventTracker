// app.js — the only module that touches the DOM.
//
// Owns view routing and DOM wiring. Delegates all SQL to db.js and
// all pure math to aggregate.js.

import * as db from './db.js';
import { aggregate, bucketOf, bucketKey, BLOCKS, DOW_LABELS } from './aggregate.js';

const root = document.getElementById('app');

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
  renderCurrentView();
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
  `;
  document.body.appendChild(tabBar);
  for (const btn of tabBar.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setView(btn.dataset.view);
    });
  }
}

let currentView = 'log';
function setView(name) {
  currentView = name;
  for (const btn of tabBar.querySelectorAll('.tab')) {
    btn.classList.toggle('tab--active', btn.dataset.view === name);
  }
  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === 'list') return renderList();
  if (currentView === 'grid') return renderGrid();
  return renderLog();
}

// --- error state -----------------------------------------------------------

function renderUnsupported() {
  root.innerHTML = '';
  const box = document.createElement('section');
  box.className = 'error-state';
  box.innerHTML = `
    <h1>Storage unavailable</h1>
    <p>This browser does not support local storage for this app;
    please update your browser.</p>
  `;
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
