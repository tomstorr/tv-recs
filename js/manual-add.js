// Manual-add — search TMDB and add a verdict to a show that didn't
// come from the weekly email.
//
// SEARCH-1..SEARCH-7, ACT-1..ACT-7, BOUNDARY-1, BOUNDARY-2.

import * as tmdb from "./tmdb.js";
import * as mutators from "./mutators.js";

const MIN_CHARS = 2;        // SEARCH-2
const DEBOUNCE_MS = 300;    // SEARCH-2

// View state for the section. Held module-level so the section's UI
// state survives re-renders driven by parent state.subscribe.
let mode = "search";        // "search" | "act"
let chosen = null;          // {title, tmdbId, year} when mode === "act"
let lastResults = [];       // most recent results
let lastError = null;
let lastQuery = "";
let inFlightSeq = 0;
let debounceTimer = null;

let mountedContainer = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function reset() {
  mode = "search";
  chosen = null;
  lastResults = [];
  lastError = null;
  lastQuery = "";
}

function renderSearch(container) {
  while (container.firstChild) container.removeChild(container.firstChild);

  const wrap = el("div", "manual-add");

  const input = el("input", "manual-add-input");
  input.type = "text";
  input.placeholder = "Add a show you've seen or want to see…"; // SEARCH-1
  input.value = lastQuery;
  input.autocomplete = "off";
  input.spellcheck = false;
  wrap.appendChild(input);

  const status = el("p", "manual-add-status");
  if (lastError) {
    status.classList.add("status-error"); // SEARCH-5
    status.textContent = lastError;
  }
  wrap.appendChild(status);

  const resultsEl = el("ul", "manual-add-results");
  if (lastResults.length > 0) {
    for (const r of lastResults) {
      resultsEl.appendChild(renderResultRow(r));
    }
  }
  wrap.appendChild(resultsEl);

  container.appendChild(wrap);

  input.addEventListener("input", (ev) => {
    const q = ev.target.value;
    lastQuery = q;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.trim().length < MIN_CHARS) {
      // SEARCH-6
      // Bump inFlightSeq so any in-flight TMDB fetch from a prior
      // 2+ char query is invalidated when its response lands —
      // otherwise it would repaint stale results into the cleared
      // list. doSearch's `if (seq !== inFlightSeq) return` does the
      // catch.
      inFlightSeq++;
      lastResults = [];
      lastError = null;
      // Repaint just the results area without rebuilding the input
      // (otherwise we lose focus and the cursor position).
      while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
      status.classList.remove("status-error");
      status.textContent = "";
      return;
    }
    debounceTimer = setTimeout(() => doSearch(q, resultsEl, status), DEBOUNCE_MS);
  });

  // Restore caret to end so the user can keep typing.
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
}

async function doSearch(query, resultsEl, statusEl) {
  const seq = ++inFlightSeq;
  try {
    const results = await tmdb.searchTV(query); // SEARCH-2 / SEARCH-4
    if (seq !== inFlightSeq) return; // a newer query has fired; drop this one
    lastResults = results;
    lastError = null;
    statusEl.classList.remove("status-error");
    statusEl.textContent = results.length === 0 ? "No matches." : "";
    while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
    for (const r of results) resultsEl.appendChild(renderResultRow(r)); // SEARCH-3
  } catch (e) {
    if (seq !== inFlightSeq) return;
    lastError = e.message || String(e);
    statusEl.classList.add("status-error"); // SEARCH-5
    statusEl.textContent = lastError;
    while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
  }
}

function renderResultRow(r) {
  const li = el("li", "manual-add-result");
  if (r.posterUrl) {
    const img = document.createElement("img");
    img.src = r.posterUrl; // SEARCH-3
    img.alt = "";
    img.className = "manual-add-poster";
    img.width = 32;
    img.height = 48;
    li.appendChild(img);
  } else {
    // Spacer to keep titles aligned even when no poster.
    li.appendChild(el("div", "manual-add-poster manual-add-poster-empty"));
  }
  const text = el("div", "manual-add-result-text");
  text.appendChild(el("div", "manual-add-result-title", r.title));
  if (r.year) text.appendChild(el("div", "manual-add-result-year", r.year));
  li.appendChild(text);
  li.tabIndex = 0;
  li.addEventListener("click", () => onPick(r)); // SEARCH-7 → ACT-1
  li.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onPick(r);
    }
  });
  return li;
}

function onPick(r) {
  // ACT-1: keep the richer fields from the search result so the action
  // bar can preview the show (poster, blurb, rating). Cast comes from
  // a follow-up details fetch; it's filled in asynchronously.
  chosen = {
    title: r.title,
    tmdbId: r.tmdbId,
    year: r.year,
    posterUrlLarge: r.posterUrlLarge,
    overview: r.overview,
    voteAverage: r.voteAverage,
    cast: null, // populated by enrichWithDetails below
  };
  mode = "act";
  if (mountedContainer) renderAct(mountedContainer);
  enrichWithDetails(r.tmdbId);
}

async function enrichWithDetails(tmdbId) {
  if (tmdbId == null) return;
  const expected = chosen && chosen.tmdbId;
  try {
    const d = await tmdb.getDetails(tmdbId);
    // Guard against the user backing out / picking another between the
    // fetch firing and resolving.
    if (!chosen || chosen.tmdbId !== expected) return;
    chosen.cast = d.cast || [];
    // Also opportunistically backfill anything search didn't have.
    if (!chosen.overview && d.overview) chosen.overview = d.overview;
    if (chosen.voteAverage == null && d.voteAverage != null) chosen.voteAverage = d.voteAverage;
    if (!chosen.posterUrlLarge && d.posterUrlLarge) chosen.posterUrlLarge = d.posterUrlLarge;
    if (mode === "act" && mountedContainer) renderAct(mountedContainer);
  } catch (_e) {
    // Silently fall back to whatever we already have — the action bar
    // still works without cast.
  }
}

function makeActButton(label, handler) {
  const b = el("button", "btn rec-action", label); // ACT-7 styling reused
  b.addEventListener("click", async () => {
    const siblings = b.parentElement
      ? b.parentElement.querySelectorAll("button")
      : [b];
    for (const s of siblings) s.disabled = true; // ACT-7
    try {
      await handler();
      reset();
      if (mountedContainer) renderSearch(mountedContainer); // ACT-6 success: clear + return
    } catch (_e) {
      // ACT-6 failure: state.js has reverted; status bar shows the error;
      // re-enable buttons by re-rendering act with the same chosen item.
      if (mountedContainer) renderAct(mountedContainer);
    }
  });
  return b;
}

function renderAct(container) {
  while (container.firstChild) container.removeChild(container.firstChild);

  const wrap = el("div", "manual-add manual-add-act");

  // ACT-1: rich preview — poster on the left, title/year/blurb/rating
  // to the right. Fields render only if TMDB returned them; missing
  // ones simply don't appear.
  const preview = el("div", "manual-add-preview");
  if (chosen.posterUrlLarge) {
    const img = document.createElement("img");
    img.src = chosen.posterUrlLarge;
    img.alt = "";
    img.className = "manual-add-preview-poster";
    img.width = 80;
    img.height = 120;
    preview.appendChild(img);
  }
  const text = el("div", "manual-add-preview-text");
  const title = chosen.year
    ? `${chosen.title} (${chosen.year})`
    : chosen.title;
  text.appendChild(el("div", "manual-add-act-title", title));
  if (typeof chosen.voteAverage === "number" && chosen.voteAverage > 0) {
    const rating = chosen.voteAverage.toFixed(1);
    text.appendChild(el("div", "manual-add-preview-rating", `${rating}/10 TMDB`));
  }
  if (Array.isArray(chosen.cast) && chosen.cast.length > 0) {
    const names = chosen.cast.map((p) => p.name).join(", ");
    text.appendChild(el("div", "manual-add-preview-cast", `Lead: ${names}`));
  }
  if (chosen.overview) {
    text.appendChild(el("p", "manual-add-preview-overview", chosen.overview));
  }
  preview.appendChild(text);
  wrap.appendChild(preview);

  const actions = el("div", "rec-actions");
  actions.appendChild(makeActButton("Loved", () =>
    mutators.addManualToWatched(chosen, "loved", todayIso()))); // ACT-2
  actions.appendChild(makeActButton("OK", () =>
    mutators.addManualToWatched(chosen, "ok", todayIso()))); // ACT-2
  actions.appendChild(makeActButton("Disliked", () =>
    mutators.addManualToWatched(chosen, "disliked", todayIso()))); // ACT-2
  actions.appendChild(makeActButton("Watchlist", () =>
    mutators.addToWatchlist({
      title: chosen.title,
      tmdbId: chosen.tmdbId,
      addedAt: todayIso(),
      addedBy: "manual",
    }))); // ACT-3
  actions.appendChild(makeActButton("Dismiss", () =>
    mutators.addManualToWatched(chosen, "disliked", null))); // ACT-4
  wrap.appendChild(actions);

  const cancelBar = el("div", "manual-add-cancel-row");
  const cancel = el("button", "btn btn-ghost", "Cancel"); // ACT-5
  cancel.addEventListener("click", () => {
    reset();
    if (mountedContainer) renderSearch(mountedContainer);
  });
  cancelBar.appendChild(cancel);
  wrap.appendChild(cancelBar);

  container.appendChild(wrap);
}

export function render(container) {
  mountedContainer = container;
  if (mode === "act" && chosen) renderAct(container);
  else renderSearch(container);
}
