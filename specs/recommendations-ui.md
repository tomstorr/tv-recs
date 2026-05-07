# Feature: recommendations-ui

## Purpose

Renders the weekly recommendations as a list of cards, each with feedback buttons (loved / ok / disliked / watchlist). This is the feature that closes the loop with the scheduled email — once the user taps a verdict, the change flows back to the Drive file, and the next Sunday's `tasteProfile` update incorporates it. The list filters out items already rated, so it always shows what's awaiting attention.

Depends on `auth-and-data-sync` for state and mutator infrastructure.

## Acceptance criteria

### LIST (rendering)

- **LIST-1**: After successful initial load, the main screen renders a list of cards drawn from `state.getState().recommended`, filtered to entries where `feedback === null`. Items where `feedback` is `"loved"`, `"ok"`, `"disliked"`, or `"watchlist"` are not shown — they remain in the underlying file as history but don't compete for attention.
- **LIST-2**: Default sort: most recent `recommendedAt` first. Ties broken by the original array order (the order the skill appended them).
- **LIST-3**: A sort toggle in the header switches between **Newest first** and **A → Z** (by title, case-insensitive). The current mode is visibly indicated.
- **LIST-4**: Each card shows: title, platform, rating string, blurb. Nothing else (no `matchedSignals`, no exploration-pick badge — see LIST-5).
- **LIST-5**: The exploration pick (`isExplorationPick: true`) is rendered identically to other picks. No badge or styling difference.
- **LIST-6**: Empty state: when zero entries have `feedback === null`, the card list is replaced by a friendly placeholder ("All caught up. Next picks arrive Sunday.") rather than an empty container.
- **LIST-7**: Cards are visually spaced (gap between cards), not edge-to-edge.
- **LIST-8**: Card list re-renders automatically when state changes — after a successful mutation, a successful Refresh, or a successful Reconnect — without needing a page reload.

### FEEDBACK (the five actions)

- **FEEDBACK-1**: Each card has five buttons: **Loved**, **OK**, **Disliked**, **Watchlist**, **Dismiss**.
- **FEEDBACK-2**: Tapping Loved / OK / Disliked invokes `mutators.setRecommendationFeedback(id, "loved" | "ok" | "disliked")`. The mutator (a) sets `feedback` on the recommendation entry AND (b) appends a new entry to the `watched` array (`title`, `tmdbId`, the chosen feedback, today's date as `watchedAt`). Both changes happen in one Drive write. The "also writes to watched" half satisfies PRODUCT.md's contract: "the app does so when the user … rates a recommendation as watched", which is what feeds the next taste-profile update. Optimistic update: the card disappears from the list immediately (the underlying entry no longer has `feedback === null`).
- **FEEDBACK-3**: Tapping Watchlist invokes a single combined mutator (`mutators.markRecommendationAsWatchlist(id)`) that, in one Drive write, both sets the recommendation's `feedback` to `"watchlist"` AND appends a new entry to the `watchlist` array with `addedBy: "recommendation"`. Atomic.
- **FEEDBACK-4**: Tapping Dismiss invokes `mutators.dismissRecommendation(id)`. The mutator (a) sets the recommendation's `feedback` to the new value `"dismissed"` AND (b) appends to `watched` with `feedback: "disliked"` and `watchedAt: null`. The `null` watchedAt is the data tell that distinguishes a Dismiss from a Disliked-after-watching, while the disliked feedback gives the taste profile the same negative signal. Atomic.
- **FEEDBACK-5**: While a mutation targeting a card is in flight, that card's buttons are visibly disabled (and click-inert) to prevent double-taps. The state.js queue already serialises mutators globally; this is a UX gate.
- **FEEDBACK-6**: On mutation failure (after WRITE-5's auto-retry), the optimistic removal is reverted (the card reappears in the list — handled by state.js's existing revert path) and an error toast surfaces with the underlying message.

### BOUNDARY (what this feature does not touch)

- **BOUNDARY-1**: This feature never reads or writes the `tasteProfile`. The skill owns it. State.js's WRITE-4 enforces this; no further check needed here.
- **BOUNDARY-2**: This feature never modifies the `watched` array. Marking a watchlist item as watched is `watchlist-ui`'s job.

## Out of scope for this feature

- TMDB metadata (poster image, release year, alt blurb). Lives in `tmdb-metadata`.
- Watchlist viewing / "mark as watched". Lives in `watchlist-ui`.
- Watched / history viewing. Lives in `watched-ui`.
- Manual show addition via TMDB search. Lives in `manual-add`.
- A "show why" toggle revealing `matchedSignals`. Easy follow-up if wanted.
- Pagination, virtualisation, search, filtering by platform. Single user, expected list size <100, no need.

## Notes for the implementer

- New module: `js/recommendations-ui.js`. Exports a `render(container)` function (or similar) that `js/ui.js`'s `renderMain` calls.
- New mutator: `mutators.markRecommendationAsWatchlist(index)` — uses the existing `runMutation(name, applyFn)` infrastructure in `state.js`. Inside `applyFn`, modify both `recommended[index].feedback` and push to `watchlist` in a single mutation.
- The `index` passed to mutators is the index into `state.getState().recommended` (the canonical array), NOT the index in the sorted/filtered display list. Compute the underlying index when binding click handlers.
- Sort + filter happens at render time, derived from the canonical state. Don't cache a filtered list — re-derive on every `render()` so that LIST-8 falls out for free.
- Reference each acceptance criterion ID in code comments (`// LIST-2`, `// FEEDBACK-3`) next to the line that satisfies it.
- No new dependencies. No new config values.
