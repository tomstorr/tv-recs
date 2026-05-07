# Feature: manual-add

## Purpose

A search-and-add box on the Recommendations tab so the user can record opinions on shows that didn't come from the weekly email. Examples: a show watched years ago and remembered fondly, a show they want to watch but haven't been recommended, a show they've heard about and definitely won't watch. All five verdicts available, mirroring the rec-card UX.

Show lookup goes to TMDB so every entry carries a real `tmdbId` — keeps the data clean and avoids duplicates with skill-recommended entries.

## Acceptance criteria

### SEARCH (the search box and results)

- **SEARCH-1**: A search input renders at the top of the Recommendations tab body, above the sort toggle. Placeholder: "Add a show you've seen or want to see…"
- **SEARCH-2**: Typing fires TMDB's `/search/tv` endpoint, debounced ~300ms. Below 2 chars: no fetch, results cleared.
- **SEARCH-3**: Up to 8 result rows render below the input. Each row shows: title, year (from `first_air_date`), poster thumbnail (from `poster_path`) where available.
- **SEARCH-4**: TMDB endpoint: `https://api.themoviedb.org/3/search/tv?query=<encoded>&api_key=<key>`. Posters: `https://image.tmdb.org/t/p/w92<poster_path>`. The key comes from `config.TMDB_API_KEY`.
- **SEARCH-5**: Errors (network or non-2xx) show a small inline error message below the input. The rest of the UI keeps working.
- **SEARCH-6**: Clearing the input or backspacing below 2 chars clears the results list.
- **SEARCH-7**: An in-memory cache (keyed by normalised query string) avoids re-fetching the same query within a session.

### ACT (selecting a result and applying a verdict)

- **ACT-1**: Clicking a result row collapses the results list and reveals an inline action bar above the rec card list. The action bar shows a rich preview of the chosen show — title + year, larger TMDB poster, blurb (TMDB `overview`), and a TMDB rating where available — plus five buttons: **Loved / OK / Disliked / Watchlist / Dismiss**. Same five as a rec card. Missing fields render as absent (TMDB doesn't always have an overview or rating); poster falls back to no image.
- **ACT-2**: Loved / OK / Disliked invoke a new mutator `mutators.addManualToWatched({title, tmdbId}, feedback, today)` which appends to `watched` with the chosen feedback and `watchedAt: today`. No `recommended` write — this isn't a recommendation.
- **ACT-3**: Watchlist invokes the existing `mutators.addToWatchlist({title, tmdbId, addedAt: today, addedBy: "manual"})`.
- **ACT-4**: Dismiss invokes `mutators.addManualToWatched({title, tmdbId}, "disliked", null)`. Same mutator; the null `watchedAt` distinguishes a manual dismissal from a watched-and-disliked entry.
- **ACT-5**: A small **Cancel** button on the action bar dismisses it without writing, returning to the empty search state.
- **ACT-6**: Optimistic semantics handled by `state.runMutation` (saving dot, last-synced update, retry, revert on failure). On a successful write the action bar collapses and the search input clears.
- **ACT-7**: Buttons in the action bar are disabled while a mutation targeting them is in flight (defensive against double-tap; mirrors recommendations-ui FEEDBACK-5).

### BOUNDARY

- **BOUNDARY-1**: Never reads or writes `tasteProfile`. (WRITE-4 enforces.)
- **BOUNDARY-2**: Never writes to `recommended`. The whole point of manual-add is that these are user-initiated, not skill-issued.

## Out of scope

- Adding shows TMDB doesn't have. If TMDB doesn't return a match, the user can't add it. (Trade-off: keeps `tmdbId` always real and avoids duplicate entries.)
- Editing or deleting existing entries.
- TMDB metadata enrichment of existing recommendation cards. Lives in `tmdb-metadata`.
- Posters in the action bar after a result is chosen — title + year is enough; the poster has done its job at the result-list stage.

## Notes for implementer

- New module: `js/manual-add.js`. Renders a section at the top of the Recommendations tab via `js/recommendations-ui.js → render` (it already owns that subtree, easiest to inject from there).
- New module: `js/tmdb.js`. Single export `searchTV(query)` that hits the endpoint, parses results, returns `[{title, tmdbId, year, posterUrl|null}]`. Owns the in-memory cache.
- New mutator in `js/mutators.js`: `addManualToWatched(item, feedback, watchedAt)`. Appends `{title, tmdbId, feedback, watchedAt}` to `watched`. Trivial.
- Reference each AC ID inline in code comments.
- No new config values; `TMDB_API_KEY` already in `config.js`.
- Don't widen styles too aggressively — reuse `.rec-card`-ish styling for the action bar so it visually matches the rest of the page.
