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

// STATE-2: example named mutator from the spec.
export function setRecommendationFeedback(idOrTitle, feedback) {
  return runMutation("setRecommendationFeedback", (data) => {
    if (!Array.isArray(data.recommended)) data.recommended = []; // WRITE-3 / READ-5
    const idx = findIndex(data.recommended, idOrTitle);
    if (idx === -1) {
      throw new Error(`Recommendation not found: ${idOrTitle}`);
    }
    data.recommended[idx] = { ...data.recommended[idx], feedback }; // WRITE-3
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
