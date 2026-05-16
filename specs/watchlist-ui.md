# Feature: watchlist-ui

## Purpose

A second view on the main screen showing the user's watchlist — shows they've parked for later, either by tapping Watchlist on a recommendation or (later, via `manual-add`) typing them in directly. Each card has three feedback verdicts that mark the item as watched, removing it from the watchlist and appending it to `watched`. This is the loop that makes "park for later" useful: it gives parked items a way out, into the same `watched` signal stream that the taste profile feeds on.

Depends on `auth-and-data-sync` for state and on the existing `moveWatchlistToWatched` mutator.

## Acceptance criteria

### WLIST (rendering)

- **WLIST-1**: Renders cards drawn from `state.getState().watchlist`. No filter — every entry shows (unlike recommendations, watchlist entries don't have a `feedback` field; presence in the array is the state).
- **WLIST-2**: Default sort: most recent `addedAt` first, ties broken by original array order.
- **WLIST-3**: A sort toggle in the section header switches between **Newest first** and **A → Z** by title (case-insensitive). Mirrors the recommendations toggle.
- **WLIST-4**: Each card shows: title, "Added &lt;readable date&gt;", and a source line — "from a recommendation" if `addedBy === "recommendation"`, "added manually" otherwise.
- **WLIST-5**: Empty state when the watchlist array is empty: "Your watchlist is empty. Tap **Watchlist** on a recommendation to park it here."
- **WLIST-6**: Cards spaced (gap), reusing the same card styling as recommendations for visual consistency.
- **WLIST-7**: Re-renders automatically on state change (mutation success / Refresh / Reconnect) without a page reload.

### WACTION (the verdict actions)

- **WACTION-1**: Each card has four buttons: **Loved**, **OK**, **Disliked**, **Dismiss**.
- **WACTION-2**: Tapping Loved / OK / Disliked invokes `mutators.moveWatchlistToWatched(id, "loved" | "ok" | "disliked", today)` (where `today` is `YYYY-MM-DD`). The mutator removes the entry from `watchlist` and appends a new `watched` entry (title, tmdbId, the chosen feedback, watchedAt = today). Optimistic: the card disappears.
- **WACTION-3**: Tapping Dismiss invokes `mutators.moveWatchlistToWatched(id, "dismissed", null)` — same mutator, but with `watchedAt = null`. Removes from watchlist; appends to watched with `feedback: "dismissed"` and `watchedAt: null` (the data tell that the user changed their mind without watching). The `"dismissed"` feedback is exclusion-only: SKILL.md keeps the show out of future picks but does not feed any positive, negative, or ambiguous signal from it. Optimistic: the card disappears.
- **WACTION-4**: While a mutation targeting a card is in flight, the card's buttons are disabled (defensive against fast double-taps). Mirrors recommendations-ui's FEEDBACK-5.
- **WACTION-5**: On mutation failure (after WRITE-5's auto-retry), state.js reverts; the card reappears; the error message surfaces in the existing status bar.

### NAV (switching between views)

- **NAV-1**: A tab strip directly under the status bar lists the views: **Recommendations (N)** | **Watchlist (M)**. N is the count of items pending feedback (recommendations with `feedback === null`); M is `watchlist.length`. Counts update on state change.
- **NAV-2**: The active tab is visibly distinguished (heavier weight or underline).
- **NAV-3**: Clicking a tab switches the rendered section without a page reload. The other tab's view module is not invoked while inactive.
- **NAV-4**: Default tab on first render: Recommendations. The active tab persists across re-renders within the page session (module-level state, mirroring how recommendations-ui keeps its sort mode), but resets on a hard reload — fine, single-screen app.

### BOUNDARY

- **BOUNDARY-1**: Never reads or writes `tasteProfile`. (WRITE-4 enforces.)
- **BOUNDARY-2**: Never modifies `recommended`. The original recommendation entry's `feedback` value (if the watchlist entry came from a recommendation) is left as `"watchlist"` — that's the historical record of "this rec was parked". The latest verdict lives in the new `watched` entry.

## Out of scope for this feature

- Removing an item from the watchlist without watching it. PRODUCT.md doesn't require it; if missed-park happens, the user can mark as Disliked.
- TMDB enrichment (poster, year). Lives in `tmdb-metadata`.
- Manual show addition. Lives in `manual-add`.
- Viewing the `watched` history. Lives in `watched-ui`.
- Multi-select / bulk-rate.
- Showing how long ago an item was added (just the date is fine).

## Notes for the implementer

- New module: `js/watchlist-ui.js`. Exports `render(container, { state })` matching the shape of `js/recommendations-ui.js → render`.
- The view module owns its sort-mode state (module-level variable, same pattern as recommendations-ui).
- The active tab lives in `js/ui.js` as a module-level variable. `renderMain` decides which view module to invoke based on the active tab. Tab clicks update the variable and call `renderMain` again with the same state — full re-render, simplest path.
- Reuse the existing CSS for cards and buttons. Add a `.tab-strip` block plus an `.active` modifier.
- Reference each acceptance criterion ID in code comments next to satisfying lines.
- No new dependencies. No new config values. No new mutators (uses the existing `moveWatchlistToWatched`).
