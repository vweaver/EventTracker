// app.js — the only module that touches the DOM.
//
// Owns view routing and DOM wiring. Delegates all SQL to db.js and
// all pure math to aggregate.js.

import * as db from './db.js';

const root = document.getElementById('app');

async function start() {
  try {
    await db.init();
  } catch (err) {
    console.error('[EventTracker] init failed', err);
    renderUnsupported();
    return;
  }
  renderBooted();
}

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

function renderBooted() {
  // Slice 1: just prove we're alive. Real views arrive in later slices.
  root.innerHTML = '';
  const s = document.createElement('section');
  s.className = 'boot';
  s.textContent = 'EventTracker ready.';
  root.appendChild(s);
}

start();
