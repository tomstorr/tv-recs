// All screens for the auth-and-data-sync feature.
//
// AUTH-1 (connect), AUTH-5 (reconnect), AUTH-6 (sign out)
// CONFIG-4 (config error)
// READ-3 / READ-4 (fetch error + retry)
// LIFECYCLE-1 (loading), LIFECYCLE-4 (refresh)
// STATE-3 (saving dot), STATE-4 (last synced)

import * as recommendationsUi from "./recommendations-ui.js";

const root = () => document.getElementById("app");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // textContent — never innerHTML for data
  return e;
}

function clear() {
  const r = root();
  while (r.firstChild) r.removeChild(r.firstChild);
}

// CONFIG-4
export function renderConfigError({ missing, placeholder }) {
  clear();
  const wrap = el("div", "screen screen-error");
  wrap.appendChild(el("h1", "title", "Configuration error"));
  wrap.appendChild(el("p", "muted",
    "The app cannot start because config.js is missing or incomplete."));
  if (missing && missing.length) {
    wrap.appendChild(el("p", "", "Missing values:"));
    const ul = el("ul");
    for (const k of missing) ul.appendChild(el("li", "", k));
    wrap.appendChild(ul);
  }
  if (placeholder && placeholder.length) {
    wrap.appendChild(el("p", "", "Still set to placeholder:"));
    const ul = el("ul");
    for (const k of placeholder) ul.appendChild(el("li", "", k));
    wrap.appendChild(ul);
  }
  wrap.appendChild(el("p", "muted",
    "Copy config.example.js to config.js and fill in real values. See README.md for instructions on obtaining each one."));
  root().appendChild(wrap);
}

// AUTH-1
export function renderConnect(onConnect) {
  clear();
  const wrap = el("div", "screen screen-connect");
  wrap.appendChild(el("h1", "title", "TV Recs"));
  wrap.appendChild(el("p", "muted", "Connect your Google Drive to get started."));
  const btn = el("button", "btn btn-primary", "Connect Google Drive"); // AUTH-1
  btn.addEventListener("click", onConnect);
  wrap.appendChild(btn);
  root().appendChild(wrap);
}

// AUTH-5
export function renderReconnect(onReconnect) {
  clear();
  const wrap = el("div", "screen screen-connect");
  wrap.appendChild(el("h1", "title", "Reconnect Google Drive"));
  wrap.appendChild(el("p", "muted",
    "Your session expired. Any unsaved changes are still in memory and will be saved after you reconnect.")); // AUTH-5
  const btn = el("button", "btn btn-primary", "Reconnect Google Drive");
  btn.addEventListener("click", onReconnect);
  wrap.appendChild(btn);
  root().appendChild(wrap);
}

// LIFECYCLE-1
export function renderLoading() {
  clear();
  const wrap = el("div", "screen screen-loading");
  wrap.appendChild(el("p", "muted", "Loading…"));
  root().appendChild(wrap);
}

// Drive Picker prompt — first-run UX after sign-in (deviation from AUTH-2).
export function renderPickerPrompt(onOpenPicker) {
  clear();
  const wrap = el("div", "screen screen-connect");
  wrap.appendChild(el("h1", "title", "Select your data file"));
  wrap.appendChild(el("p", "muted",
    "Pick the tv-recommendations.json file in your Google Drive. The app will then have access to that one file only — nothing else in your Drive."));
  const btn = el("button", "btn btn-primary", "Open Drive Picker");
  btn.addEventListener("click", onOpenPicker);
  wrap.appendChild(btn);
  root().appendChild(wrap);
}

// READ-3 / READ-4
export function renderFetchError(error, onRetry) {
  clear();
  const wrap = el("div", "screen screen-error");
  wrap.appendChild(el("h1", "title", "Couldn't load your data"));
  const msg = el("pre", "error-msg");
  msg.textContent = (error && error.message) || String(error); // READ-3 / READ-4: surface underlying message
  wrap.appendChild(msg);
  const btn = el("button", "btn btn-primary", "Retry"); // READ-3 / READ-4
  btn.addEventListener("click", onRetry);
  wrap.appendChild(btn);
  root().appendChild(wrap);
}

// Main screen — minimal shell since data UIs are out of scope.
// AUTH-6 (sign out), LIFECYCLE-4 (refresh), STATE-3 (saving dot), STATE-4 (last synced).
export function renderMain({ state, onSignOut, onRefresh }) {
  clear();
  const wrap = el("div", "screen screen-main");

  const header = el("header", "main-header");
  header.appendChild(el("h1", "title", "TV Recs"));
  const controls = el("div", "header-controls");
  const refreshBtn = el("button", "btn btn-ghost", "Refresh"); // LIFECYCLE-4
  refreshBtn.addEventListener("click", onRefresh);
  controls.appendChild(refreshBtn);
  const signOutBtn = el("button", "btn btn-ghost", "Sign out"); // AUTH-6
  signOutBtn.addEventListener("click", onSignOut);
  controls.appendChild(signOutBtn);
  header.appendChild(controls);
  wrap.appendChild(header);

  const status = el("div", "status-bar");
  if (state.isWriting) {
    const dot = el("span", "saving-dot"); // STATE-3
    dot.title = "Saving";
    status.appendChild(dot);
    status.appendChild(el("span", "muted", "Saving…"));
  }
  if (state.lastSyncedAt) {
    const t = new Date(state.lastSyncedAt).toLocaleTimeString();
    status.appendChild(el("span", "muted", `Last synced ${t}`)); // STATE-4
  }
  if (state.writeError) {
    status.appendChild(el("span", "status-error",
      `Save failed: ${state.writeError.message}`)); // WRITE-5
  }
  wrap.appendChild(status);

  const body = el("div", "main-body");

  // Recommendations list owns its own subtree. LIST-1..LIST-8 / FEEDBACK-1..FEEDBACK-5.
  const recsContainer = el("section", "recs-section");
  body.appendChild(recsContainer);
  recommendationsUi.render(recsContainer, { state });

  wrap.appendChild(body);
  root().appendChild(wrap);
}
