// Recommendations list — the loop-closing UI.
//
// LIST-1..LIST-8, FEEDBACK-1..FEEDBACK-5, BOUNDARY-1, BOUNDARY-2.
//
// This module owns the recommendations section of the main screen. It
// reads from state.getState().recommended on each render, filters to
// items still awaiting feedback (LIST-1), sorts (LIST-2 / LIST-3), and
// wires feedback buttons through to mutators.

import * as mutators from "./mutators.js";
import * as manualAdd from "./manual-add.js";

let sortMode = "newest"; // LIST-2 default. Persists across re-renders within the page session.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // textContent — never innerHTML for data
  return e;
}

function recIdentity(rec) {
  // Stable identifier for mutators. Use tmdbId if present (LIFECYCLE-2 safe
  // against array reordering by the skill between optimistic update and
  // refetch), otherwise fall back to title.
  return rec.tmdbId != null ? rec.tmdbId : rec.title;
}

function sortRecs(recs, mode) {
  // Indexed copy so the original order survives — used as the tiebreaker
  // for LIST-2.
  const indexed = recs.map((rec, originalIndex) => ({ rec, originalIndex }));
  if (mode === "az") {
    indexed.sort((a, b) =>
      String(a.rec.title || "")
        .toLowerCase()
        .localeCompare(String(b.rec.title || "").toLowerCase()),
    );
  } else {
    // LIST-2: newest recommendedAt first, ties broken by original array order.
    indexed.sort((a, b) => {
      const da = String(a.rec.recommendedAt || "");
      const db = String(b.rec.recommendedAt || "");
      if (da !== db) return db.localeCompare(da);
      return a.originalIndex - b.originalIndex;
    });
  }
  return indexed.map((x) => x.rec);
}

function makeButton(label, onClick) {
  const b = el("button", "btn rec-action", label); // FEEDBACK-1
  b.addEventListener("click", async () => {
    // FEEDBACK-4: defensive against a fast double-tap before the optimistic
    // re-render removes the card. Disable all action buttons in the card.
    const siblings = b.parentElement
      ? b.parentElement.querySelectorAll("button")
      : [b];
    for (const s of siblings) s.disabled = true;
    try {
      await onClick();
    } catch (_e) {
      // FEEDBACK-5: state.js has already reverted the optimistic update and
      // surfaced state.writeError. The card will reappear on the next render.
      // Nothing more to do here.
    }
  });
  return b;
}

function renderCard(rec) {
  const card = el("article", "rec-card");

  card.appendChild(el("h2", "rec-title", rec.title || "Untitled")); // LIST-4

  const meta = el("p", "rec-meta");
  if (rec.platform) meta.appendChild(el("span", "", rec.platform)); // LIST-4
  if (rec.platform && rec.rating) meta.appendChild(el("span", "rec-meta-sep", " · "));
  if (rec.rating) meta.appendChild(el("span", "", rec.rating));     // LIST-4
  if (meta.childNodes.length > 0) card.appendChild(meta);

  if (rec.blurb) {
    card.appendChild(el("p", "rec-blurb", rec.blurb));              // LIST-4
  }
  // LIST-5: no badge for isExplorationPick — rendered identically.
  // matchedSignals deliberately not shown (out of scope).

  const id = recIdentity(rec);
  const actions = el("div", "rec-actions");
  actions.appendChild(makeButton("Loved",     () =>                 // FEEDBACK-2
    mutators.setRecommendationFeedback(id, "loved")));
  actions.appendChild(makeButton("OK",        () =>                 // FEEDBACK-2
    mutators.setRecommendationFeedback(id, "ok")));
  actions.appendChild(makeButton("Disliked",  () =>                 // FEEDBACK-2
    mutators.setRecommendationFeedback(id, "disliked")));
  actions.appendChild(makeButton("Watchlist", () =>                 // FEEDBACK-3
    mutators.markRecommendationAsWatchlist(id)));
  actions.appendChild(makeButton("Dismiss",   () =>                 // FEEDBACK-4
    mutators.dismissRecommendation(id)));
  card.appendChild(actions);

  return card;
}

// LIST-8: render is called by ui.renderMain on every state change, so the
// list naturally reflects the latest in-memory data. No internal caching.
export function render(container, { state }) {
  while (container.firstChild) container.removeChild(container.firstChild);

  // SEARCH-1: manual-add lives at the top of the Recommendations tab,
  // above the sort toggle.
  const manualAddSection = el("div", "manual-add-section");
  container.appendChild(manualAddSection);
  manualAdd.render(manualAddSection);

  const sortBar = el("div", "rec-sort-bar");
  sortBar.appendChild(el("span", "muted", "Sort:"));
  const toggle = el(
    "button",
    "btn btn-ghost rec-sort-toggle",
    sortMode === "newest" ? "Newest first" : "A → Z", // LIST-3
  );
  toggle.addEventListener("click", () => {
    sortMode = sortMode === "newest" ? "az" : "newest"; // LIST-3
    render(container, { state }); // re-render just this section
  });
  sortBar.appendChild(toggle);
  container.appendChild(sortBar);

  const all = (state.data && state.data.recommended) || [];
  const pending = all.filter((r) => r.feedback === null); // LIST-1

  if (pending.length === 0) {
    // LIST-6
    container.appendChild(
      el("p", "rec-empty", "All caught up. Next picks arrive Sunday."),
    );
    return;
  }

  const sorted = sortRecs(pending, sortMode); // LIST-2 / LIST-3
  const list = el("div", "rec-list"); // LIST-7 spacing applied via CSS
  for (const rec of sorted) list.appendChild(renderCard(rec));
  container.appendChild(list);
}
