// STATE-2: named mutator functions. Each delegates to runMutation, which
// owns the refetch-modify-write-retry-revert flow (WRITE-1..WRITE-6) and
// the queue (STATE-3).
//
// Each applyFn receives a deep-cloned data object and returns the modified
// copy. None of them touch tasteProfile (WRITE-4 enforces this anyway).
//
// No UI in this feature consumes these — they're set up so later features
// (recommendations list, watchlist, ratings buttons) can wire UIs onto
// them without touching the sync machinery.

import { runMutation } from "./state.js";

function findIndex(arr, idOrTitle) {
  return (arr || []).findIndex((entry) =>
    entry.tmdbId != null
      ? entry.tmdbId === idOrTitle
      : entry.title === idOrTitle,
  );
}

// STATE-2 + FEEDBACK-2.
// Per PRODUCT.md: rating a recommendation as watched also appends to the
// watched array, so the skill's next taste-profile update sees the new
// signal. The recommendation entry itself also keeps the feedback (so it
// stays out of the pending list — see LIST-1 in recommendations-ui).
export function setRecommendationFeedback(idOrTitle, feedback) {
  return runMutation("setRecommendationFeedback", (data) => {
    if (!Array.isArray(data.recommended)) data.recommended = []; // WRITE-3 / READ-5
    if (!Array.isArray(data.watched)) data.watched = [];          // READ-5
    const idx = findIndex(data.recommended, idOrTitle);
    if (idx === -1) {
      throw new Error(`Recommendation not found: ${idOrTitle}`);
    }
    const rec = data.recommended[idx];
    data.recommended[idx] = { ...rec, feedback }; // WRITE-3
    // FEEDBACK-2: also push to watched so the taste-profile update sees it.
    const today = new Date().toISOString().slice(0, 10);
    data.watched.push({
      title: rec.title,
      tmdbId: rec.tmdbId ?? null,
      feedback,
      watchedAt: today,
    });
    return data;
  });
}

// STATE-2
export function addToWatchlist(item) {
  return runMutation("addToWatchlist", (data) => {
    if (!Array.isArray(data.watchlist)) data.watchlist = []; // WRITE-3 / READ-5
    data.watchlist.push({ ...item }); // WRITE-3
    return data;
  });
}

// ACT-2 / ACT-4 (manual-add): append a brand-new watched entry from
// outside the recommendation flow. Used for "I watched X years ago and
// remember loving it" (watchedAt = today) or "I'd never watch X"
// (watchedAt = null, feedback = "disliked").
export function addManualToWatched(item, feedback, watchedAt) {
  return runMutation("addManualToWatched", (data) => {
    if (!Array.isArray(data.watched)) data.watched = []; // READ-5
    data.watched.push({
      title: item.title,
      tmdbId: item.tmdbId ?? null,
      feedback,
      watchedAt: watchedAt ?? null,
    });
    return data;
  });
}

// FEEDBACK-4: atomic — Dismiss path. Sets rec.feedback = "dismissed" AND
// appends to watched with feedback="disliked", watchedAt=null. The null
// watchedAt distinguishes a Dismiss from a Disliked-after-watching while
// still feeding the taste profile a negative signal (per user spec:
// "score the same as Disliked").
export function dismissRecommendation(idOrTitle) {
  return runMutation("dismissRecommendation", (data) => {
    if (!Array.isArray(data.recommended)) data.recommended = []; // READ-5
    if (!Array.isArray(data.watched)) data.watched = [];          // READ-5
    const idx = findIndex(data.recommended, idOrTitle);
    if (idx === -1) {
      throw new Error(`Recommendation not found: ${idOrTitle}`);
    }
    const rec = data.recommended[idx];
    data.recommended[idx] = { ...rec, feedback: "dismissed" }; // FEEDBACK-4
    data.watched.push({                                        // FEEDBACK-4
      title: rec.title,
      tmdbId: rec.tmdbId ?? null,
      feedback: "disliked",
      watchedAt: null,
    });
    return data;
  });
}

// FEEDBACK-3: atomic — sets the recommendation's feedback to "watchlist"
// AND appends a watchlist entry, in a single Drive write. Avoids the
// inconsistent state you'd get from chaining two separate mutators.
export function markRecommendationAsWatchlist(idOrTitle) {
  return runMutation("markRecommendationAsWatchlist", (data) => {
    if (!Array.isArray(data.recommended)) data.recommended = []; // READ-5
    if (!Array.isArray(data.watchlist)) data.watchlist = [];     // READ-5
    const idx = findIndex(data.recommended, idOrTitle);
    if (idx === -1) {
      throw new Error(`Recommendation not found: ${idOrTitle}`);
    }
    const rec = data.recommended[idx];
    data.recommended[idx] = { ...rec, feedback: "watchlist" };   // FEEDBACK-3
    const today = new Date().toISOString().slice(0, 10);
    data.watchlist.push({                                         // FEEDBACK-3
      title: rec.title,
      tmdbId: rec.tmdbId ?? null,
      addedAt: today,
      addedBy: "recommendation",
    });
    return data;
  });
}

// STATE-2
export function moveWatchlistToWatched(idOrTitle, feedback, watchedAt) {
  return runMutation("moveWatchlistToWatched", (data) => {
    if (!Array.isArray(data.watchlist)) data.watchlist = []; // READ-5
    if (!Array.isArray(data.watched)) data.watched = [];     // READ-5
    const idx = findIndex(data.watchlist, idOrTitle);
    if (idx === -1) {
      throw new Error(`Watchlist item not found: ${idOrTitle}`);
    }
    const item = data.watchlist[idx];
    data.watchlist.splice(idx, 1);                          // WRITE-3
    data.watched.push({                                      // WRITE-3
      title: item.title,
      tmdbId: item.tmdbId ?? null,
      feedback,
      watchedAt: watchedAt ?? null,
    });
    return data;
  });
}
