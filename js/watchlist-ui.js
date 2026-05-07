// Watchlist screen — view parked items and rate them as watched.
//
// WLIST-1..WLIST-7, WACTION-1..WACTION-5, BOUNDARY-1, BOUNDARY-2.

import * as mutators from "./mutators.js";

let sortMode = "newest"; // WLIST-2 default. Persists across re-renders within the page session.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // textContent — never innerHTML
  return e;
}

function entryIdentity(entry) {
  // Stable identifier; same convention as recommendations-ui — tmdbId if
  // available, else title (LIFECYCLE-2 safe against array reordering).
  return entry.tmdbId != null ? entry.tmdbId : entry.title;
}

function sortEntries(entries, mode) {
  const indexed = entries.map((entry, originalIndex) => ({ entry, originalIndex }));
  if (mode === "az") {
    indexed.sort((a, b) =>
      String(a.entry.title || "")
        .toLowerCase()
        .localeCompare(String(b.entry.title || "").toLowerCase()),
    );
  } else {
    // WLIST-2: most recent addedAt first; ties broken by original order.
    indexed.sort((a, b) => {
      const da = String(a.entry.addedAt || "");
      const db = String(b.entry.addedAt || "");
      if (da !== db) return db.localeCompare(da);
      return a.originalIndex - b.originalIndex;
    });
  }
  return indexed.map((x) => x.entry);
}

function makeButton(label, onClick) {
  const b = el("button", "btn rec-action", label); // WACTION-1, reuses rec-action style
  b.addEventListener("click", async () => {
    // WACTION-4: defensive against double-tap before optimistic re-render.
    const siblings = b.parentElement
      ? b.parentElement.querySelectorAll("button")
      : [b];
    for (const s of siblings) s.disabled = true;
    try {
      await onClick();
    } catch (_e) {
      // WACTION-5: state.js has reverted; status bar shows the error.
    }
  });
  return b;
}

function renderCard(entry) {
  const card = el("article", "rec-card"); // shares card styling with recs

  card.appendChild(el("h2", "rec-title", entry.title || "Untitled")); // WLIST-4

  const meta = el("p", "rec-meta");
  if (entry.addedAt) {
    meta.appendChild(el("span", "", `Added ${entry.addedAt}`)); // WLIST-4
  }
  if (entry.addedBy) {
    if (entry.addedAt) meta.appendChild(el("span", "rec-meta-sep", " · "));
    const fromText = entry.addedBy === "recommendation"
      ? "from a recommendation"
      : "added manually";
    meta.appendChild(el("span", "", fromText)); // WLIST-4
  }
  if (meta.childNodes.length > 0) card.appendChild(meta);

  const id = entryIdentity(entry);
  const today = () => new Date().toISOString().slice(0, 10);
  const actions = el("div", "rec-actions");
  actions.appendChild(makeButton("Loved",    () =>                       // WACTION-2
    mutators.moveWatchlistToWatched(id, "loved", today())));
  actions.appendChild(makeButton("OK",       () =>                       // WACTION-2
    mutators.moveWatchlistToWatched(id, "ok", today())));
  actions.appendChild(makeButton("Disliked", () =>                       // WACTION-2
    mutators.moveWatchlistToWatched(id, "disliked", today())));
  actions.appendChild(makeButton("Dismiss",  () =>                       // WACTION-3
    mutators.moveWatchlistToWatched(id, "disliked", null)));
  card.appendChild(actions);

  return card;
}

// WLIST-7: re-render is parent-driven via state.subscribe → ui.renderMain.
export function render(container, { state }) {
  while (container.firstChild) container.removeChild(container.firstChild);

  const sortBar = el("div", "rec-sort-bar");
  sortBar.appendChild(el("span", "muted", "Sort:"));
  const toggle = el(
    "button",
    "btn btn-ghost rec-sort-toggle",
    sortMode === "newest" ? "Newest first" : "A → Z", // WLIST-3
  );
  toggle.addEventListener("click", () => {
    sortMode = sortMode === "newest" ? "az" : "newest"; // WLIST-3
    render(container, { state });
  });
  sortBar.appendChild(toggle);
  container.appendChild(sortBar);

  const entries = (state.data && state.data.watchlist) || []; // WLIST-1

  if (entries.length === 0) {
    container.appendChild(
      el(
        "p",
        "rec-empty",
        "Your watchlist is empty. Tap Watchlist on a recommendation to park it here.",
      ),
    ); // WLIST-5
    return;
  }

  const sorted = sortEntries(entries, sortMode); // WLIST-2 / WLIST-3
  const list = el("div", "rec-list"); // WLIST-6 spacing via CSS
  for (const entry of sorted) list.appendChild(renderCard(entry));
  container.appendChild(list);
}
