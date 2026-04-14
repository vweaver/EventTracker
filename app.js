// app.js — the only module that touches the DOM.
//
// Owns view routing and DOM wiring. Delegates all SQL to db.js and
// all pure math to aggregate.js.

import * as db from './db.js';

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
  renderLog();
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
          <button
            id="bd-pos"
            class="pill pill--pos"
            type="button"
          >Positive</button>
          <button
            id="bd-neg"
            class="pill pill--neg"
            type="button"
          >Negative</button>
        </div>
      </div>
    </details>
  `;
  root.appendChild(view);
  view.querySelector('#btn-pos').addEventListener('click', () => onLive(1));
  view.querySelector('#btn-neg').addEventListener('click', () => onLive(0));

  const whenInput = view.querySelector('#bd-when');
  // datetime-local wants YYYY-MM-DDTHH:MM (no seconds required).
  whenInput.value = nowLocalIso().slice(0, 16);
  const details = view.querySelector('details.backdate');
  details.addEventListener('toggle', () => {
    if (details.open) {
      // Refresh to current time each time it's re-opened.
      whenInput.value = nowLocalIso().slice(0, 16);
    }
  });
  view.querySelector('#bd-pos').addEventListener('click', () =>
    onBackdate(whenInput, 1),
  );
  view.querySelector('#bd-neg').addEventListener('click', () =>
    onBackdate(whenInput, 0),
  );
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
  // datetime-local returns YYYY-MM-DDTHH:MM; normalize to seconds.
  const ts = raw.length === 16 ? `${raw}:00` : raw;
  try {
    await db.insertEvent(ts, value);
    showToast('✓ Saved');
  } catch (err) {
    console.error('[EventTracker] backdate insert failed', err);
    showToast('Save failed');
  }
}

// Naive local ISO: YYYY-MM-DDTHH:MM:SS from the device clock.
// Matches TECH_SPEC.md "Data model": no tz suffix.
function nowLocalIso(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

start();
