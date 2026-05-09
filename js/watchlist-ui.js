// Watchlist screen — view parked items and rate them as watched.
//
// WLIST-1..WLIST-7, WACTION-1..WACTION-5, BOUNDARY-1, BOUNDARY-2.

import * as mutators from "./mutators.js";
import * as tmdb from "./tmdb.js";

let sortMode = "newest"; // WLIST-2 default. Persists across re-renders within the page session.

// Lazy enrichment: each card with a tmdbId kicks off a TMDB details
// fetch on first render. Result is cached at the tmdb.js layer; this
// just tracks per-card DOM nodes that need updating when a fetch lands.
const detailsByTmdbId = new Map();
const inFlightFetches = new Set();

function enrichCard(card, tmdbId) {
  if (tmdbId == null) return;
  const cached = detailsByTmdbId.get(tmdbId);
  if (cached) {
    fillEnrichedFields(card, cached);
    return;
  }
  if (inFlightFetches.has(tmdbId)) return;
  inFlightFetches.add(tmdbId);
  tmdb.getDetails(tmdbId)
    .then((d) => {
      inFlightFetches.delete(tmdbId);
      if (!d) return;
      detailsByTmdbId.set(tmdbId, d);
      fillEnrichedFields(card, d);
    })
    .catch(() => {
      inFlightFetches.delete(tmdbId);
      // Silent fallback — the minimal card stays as-is.
    });
}

function fillEnrichedFields(card, d) {
  if (!card.isConnected) return; // card was removed before fetch landed
  const posterImg = card.querySelector(".watchlist-poster");
  if (posterImg && d.posterUrlLarge) {
    posterImg.src = d.posterUrlLarge;
    posterImg.classList.remove("watchlist-poster-empty");
  }
  const titleEl = card.querySelector(".rec-title");
  if (titleEl && d.year && titleEl.dataset.hasYear !== "1") {
    titleEl.textContent = `${titleEl.textContent} (${d.year})`;
    titleEl.dataset.hasYear = "1";
  }
  const enrichSlot = card.querySelector(".watchlist-enrichment");
  if (!enrichSlot) return;
  while (enrichSlot.firstChild) enrichSlot.removeChild(enrichSlot.firstChild);
  // Skip TMDB rating if the rec entry already provided one — the rec's
  // rating string is richer (e.g. "91% Rotten Tomatoes, 8.4 IMDb") than
  // a single TMDB number.
  if (card.dataset.hasRecRating !== "1" && typeof d.voteAverage === "number" && d.voteAverage > 0) {
    const r = document.createElement("div");
    r.className = "manual-add-preview-rating";
    r.textContent = `${d.voteAverage.toFixed(1)}/10 TMDB`;
    enrichSlot.appendChild(r);
  }
  if (Array.isArray(d.cast) && d.cast.length > 0) {
    const c = document.createElement("div");
    c.className = "manual-add-preview-cast";
    c.textContent = `Lead: ${d.cast.map((p) => p.name).join(", ")}`;
    enrichSlot.appendChild(c);
  }
  // Skip TMDB overview if the rec entry already provided a tailored
  // blurb — the schedule's blurb is more useful than TMDB's generic one.
  if (card.dataset.hasRecBlurb !== "1" && d.overview) {
    const p = document.createElement("p");
    p.className = "manual-add-preview-overview";
    p.textContent = d.overview;
    enrichSlot.appendChild(p);
  }
}

// Find the recommendation entry that produced a watchlist item, so we
// can pull through its platform / rating / blurb. Match by tmdbId when
// possible (stable across renames); fall back to title for entries the
// schedule couldn't tag with a TMDB id.
function findMatchingRec(recs, entry) {
  if (!Array.isArray(recs)) return null;
  if (entry.tmdbId != null) {
    const byId = recs.find((r) => r.tmdbId === entry.tmdbId);
    if (byId) return byId;
  }
  return recs.find((r) => r.title === entry.title) || null;
}

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

function renderCard(entry, recs) {
  const card = el("article", "rec-card watchlist-card"); // shares card styling with recs

  // WLIST-4: rich layout — poster on the left, text on the right.
  // Enrichment (poster, year, cast) is filled in lazily by enrichCard().
  // Platform / rating / blurb come from the matching recommendation
  // entry and render synchronously below — they're already in Drive,
  // no fetch needed. The watchlist card was previously sparser than
  // the rec card it came from; this fills that gap.
  const top = el("div", "watchlist-card-top");
  const poster = document.createElement("img");
  poster.className = "watchlist-poster watchlist-poster-empty";
  poster.alt = "";
  poster.width = 80;
  poster.height = 120;
  top.appendChild(poster);

  const text = el("div", "watchlist-card-text");
  text.appendChild(el("h2", "rec-title", entry.title || "Untitled")); // WLIST-4

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
  if (meta.childNodes.length > 0) text.appendChild(meta);

  // Pull platform / rating / blurb from the matching recommendation
  // entry (when there is one). For watchlist items added via manual-add
  // there's no rec entry — TMDB enrichment fills the gap instead.
  const rec = findMatchingRec(recs, entry);
  if (rec) {
    const recMeta = el("p", "rec-meta");
    if (rec.platform) recMeta.appendChild(el("span", "", rec.platform));
    if (rec.platform && rec.rating) recMeta.appendChild(el("span", "rec-meta-sep", " · "));
    if (rec.rating) recMeta.appendChild(el("span", "", rec.rating));
    if (recMeta.childNodes.length > 0) text.appendChild(recMeta);
    if (rec.blurb) {
      text.appendChild(el("p", "rec-blurb", rec.blurb));
      card.dataset.hasRecBlurb = "1";
    }
    if (rec.platform || rec.rating) {
      card.dataset.hasRecRating = "1";
    }
  }

  // Enrichment slot — populated by fillEnrichedFields when the TMDB
  // details fetch resolves. Stays empty for items we can't TMDB-look-up
  // (rec entries with tmdbId=null) or for items where rec content
  // already covered everything.
  text.appendChild(el("div", "watchlist-enrichment"));

  top.appendChild(text);
  card.appendChild(top);

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

  // Kick off lazy enrichment after the card is in the DOM. queueMicrotask
  // would also work; setTimeout 0 is more reliably "after layout".
  setTimeout(() => enrichCard(card, entry.tmdbId), 0);

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
  const recs = (state.data && state.data.recommended) || []; // for renderCard rec-lookup

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
  for (const entry of sorted) list.appendChild(renderCard(entry, recs));
  container.appendChild(list);
}
