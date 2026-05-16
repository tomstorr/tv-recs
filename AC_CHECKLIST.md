# Acceptance criteria — auth-and-data-sync

All AC IDs are also referenced inline in code comments at the satisfying line.

## Documented spec deviation

- **AUTH-2**: The spec says try `drive.file`, fall back to `drive`. This build uses `drive.file` + Drive Picker instead, so the app's blast radius is one file even after a successful sign-in. This required adding a fourth config value, `GOOGLE_API_KEY` (for the Picker), so CONFIG-1 lists four values rather than three. README documents both the deviation and the new config value.

## CONFIG

- **CONFIG-1** ✓ `js/config-check.js` requires `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `TMDB_API_KEY`, `DATA_FILE_ID`, `WORKER_URL`. App does not start (renders config-error screen instead) if any are missing. (Spec said three values originally; deviation note above. `WORKER_URL` was added when the auth flow moved to OAuth code flow + refresh tokens — Google's Web client type needs a `client_secret` for the token endpoint, which must live server-side.)
- **CONFIG-2** ✓ `config.example.js` committed at project root, comments link each placeholder to the README step that explains how to obtain it.
- **CONFIG-3** ✓ `config.js` is gitignored. Production builds generate `config.js` at deploy time inside `.github/workflows/deploy.yml` from repo secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `TMDB_API_KEY`, `DATA_FILE_ID`); the generated file ships in the GitHub Pages artifact only. (Briefly during the 2026-05-07 session the file was committed as a pragmatic shortcut; GitHub Secret Scanning flagged it, the API key was rotated, and we moved to this proper pattern.)
- **CONFIG-4** ✓ `js/config-check.js` detects missing *and* placeholder values; `js/ui.js → renderConfigError` shows a clear screen listing what's missing or still a placeholder, with a pointer to README.

## AUTH

- **AUTH-1** ✓ `js/app.js → render()` shows `ui.renderConnect` (a screen with only the "Connect Google Drive" button) when `auth.getStoredToken()` is null.
- **AUTH-2** ✓ `js/auth.js → requestToken` builds an `accounts.google.com/o/oauth2/v2/auth` URL with `response_type=code`, `scope=drive.file`, `access_type=offline`, `prompt=consent` and navigates the whole page to it (no popup — Safari ITP is moot). Google redirects back to the page with `?code=...&state=...`. `js/auth.js → init` detects this in the URL and POSTs the code to `WORKER_URL/exchange`; the Worker holds the `client_secret` and forwards to Google's token endpoint, returning `{access_token, refresh_token}`. The Picker (`auth.pickFile`) still handles the "file created outside the app" case via per-file grant rather than scope fallback. Picker config learned during integration testing: `setAppId(<project number>)`, `setOrigin(window.location.protocol + '//' + window.location.host)`, no MIME filter (Drive sometimes reports unexpected MIME types and a strict filter hides the file).
- **AUTH-3** ✓ `js/auth.js → storeTokens` writes the access token to `localStorage['tvrecs.access_token']` and the refresh token to `localStorage['tvrecs.refresh_token']`. The refresh token is what enables AUTH-5's transparent re-auth across the ~1h access-token lifetime.
- **AUTH-4** ✓ `js/app.js → boot` calls `tryLoad()` directly when `auth.getStoredToken()` returns a value, bypassing the connect screen. If only the refresh token is present (e.g. access token expired between visits), the silent-refresh path mints a fresh access token on the first Drive call — still no re-prompt.
- **AUTH-5** ✓ Drive errors classified as `kind="auth"` (`js/drive.js → classify`) propagate to `state.internal.authError`. **Enhancement (post-spec):** before that, `js/drive.js → fetchWithRefresh` attempts one silent refresh via `auth.requestTokenSilently`, which POSTs the stored refresh token to `WORKER_URL/refresh`. The Worker exchanges it with Google for a new access token; the original Drive request retries with it. If the refresh fails (refresh token revoked or expired, ~6 months without use — Google returns 400 `invalid_grant`), both tokens are cleared and `js/app.js → render()` shows `ui.renderReconnect`. In-memory `state.internal.data` is preserved across the auth error (only on user-initiated sign-out is `state.reset()` called). Switching from GIS implicit popup (2026-05-16) to redirect-based code flow + refresh tokens means weekly visits no longer require re-tapping Connect.
- **AUTH-6** ✓ `js/ui.js → renderMain` includes a "Sign out" button. Click → `js/app.js → handleSignOut` → `auth.clearToken()` + `state.reset()` + `render()` returns to the connect screen.

## READ

- **READ-1** ✓ `js/drive.js → readFile` calls `GET https://www.googleapis.com/drive/v3/files/{id}?alt=media` with `Authorization: Bearer ${token}`.
- **READ-2** ✓ `js/state.js → internal.data` is the canonical mirror; mutators read from it via `getState()`. `runMutation` does *not* refetch on read — only writes refetch (per WRITE-1).
- **READ-3** ✓ `js/drive.js` wraps fetch failures into `kind="transport"`; `js/state.js → initialLoad` stores them in `internal.fetchError`; `js/app.js → render()` routes to `ui.renderFetchError` with a Retry button. Underlying error message is rendered via `textContent`.
- **READ-4** ✓ `js/drive.js → readFile` catches `JSON.parse` failure and throws `kind="parse"` with the parser's message; same UI path as READ-3 surfaces it.
- **READ-5** ✓ `js/state.js → normaliseTopLevel` fills missing top-level keys with empty arrays/objects in memory and tracks them in `internal.missingKeys`. The original file is never written back from initialLoad — only mutator-driven writes call `drive.writeFile`, and they always start from a fresh refetch (WRITE-1) plus the user's targeted change. Untouched keys remain in the file as the user had them.

## WRITE

- **WRITE-1** ✓ `js/state.js → performWriteOnce` calls `drive.readFile()` immediately before applying `applyFn`. The user's change is applied to that fresh copy, not to in-memory.
- **WRITE-2** ✓ `js/drive.js → writeFile` issues `PATCH https://www.googleapis.com/upload/drive/v3/files/{id}?uploadType=media` with `Authorization: Bearer …` and `Content-Type: application/json`, full updated body.
- **WRITE-3** ✓ Each mutator in `js/mutators.js` modifies only its target key/index; `js/state.js → performWriteOnce` PATCHes the full re-fetched-and-modified object so untouched keys round-trip unchanged. Key order may shift (JSON re-serialisation) but no data is dropped.
- **WRITE-4** ✓ `js/state.js → performWriteOnce` snapshots `JSON.stringify(freshData.tasteProfile)` before applying and `JSON.stringify(updated.tasteProfile)` after; if they differ, throws `kind="tasteProfileTouched"`, logs to console, and aborts the write.
- **WRITE-5** ✓ `js/state.js → performWriteWithRetry` retries `performWriteOnce` once after a 1000ms delay (skipped for `kind="auth"` and `kind="tasteProfileTouched"`). On final failure, `runJob` reverts `internal.data` to the pre-mutation snapshot and sets `internal.writeError` (or `authError` for auth failures). `ui.renderMain` renders the error message inline in the status bar.
- **WRITE-6** ✓ `js/state.js → performWriteOnce` sets `internal.data = updated` on success; subsequent reads use this without refetching.

## STATE

- **STATE-1** ✓ `js/state.js → getState()` returns the in-memory snapshot. Features read from this; no per-feature caching.
- **STATE-2** ✓ `js/mutators.js` exports `setRecommendationFeedback`, `addToWatchlist`, `moveWatchlistToWatched`, each delegating to `runMutation`.
- **STATE-3** ✓ `js/state.js → writeQueue` serialises mutators (one runs at a time; subsequent ones queue). `internal.isWriting` flips on entry to `runJob` and back off when the job resolves; `ui.renderMain` shows the saving dot when true. The user can keep clicking — additional mutator calls push onto the queue.
- **STATE-4** ✓ `internal.lastSyncedAt = Date.now()` after every successful read (`initialLoad`) and after every successful write (`runJob` resolve path). `ui.renderMain` formats it.

## LIFECYCLE

- **LIFECYCLE-1** ✓ `js/app.js → tryLoad` and the `render()` path both call `ui.renderLoading` while the initial fetch is in flight. No flash of empty UI.
- **LIFECYCLE-2** ✓ WRITE-1's refetch-before-apply means a write from this app on top of a write from the scheduled task will start from the task's latest state. Last-write-wins; no merge logic added.
- **LIFECYCLE-3** ✓ No timers, no polling. Refetch points: `initialLoad` (boot or refresh), `performWriteOnce` (every mutator). Verified by absence of any `setInterval`/`setTimeout` in app/state code other than WRITE-5's 1s retry.
- **LIFECYCLE-4** ✓ `ui.renderMain` includes a "Refresh" button → `app.handleRefresh()` → `state.refresh()` → `state.initialLoad()`.

## What's not done / out of scope

- **No tests.** No test framework was set up for this project; the global rule says to flag this rather than silently skip. Manual smoke test below.
- Data UI (recommendations list, watchlist UI, ratings buttons) — explicitly out of scope per the spec.
- TMDB integration — separate `tmdb-metadata` feature.
- Conflict resolution beyond last-write-wins — explicitly out of scope.
- Offline support — explicitly out of scope.

## Manual smoke test

1. With config.js missing or with placeholders → load page → see "Configuration error" screen listing what's missing. (CONFIG-1, CONFIG-4)
2. With valid config.js → load page → see "Connect Google Drive". (AUTH-1)
3. Click Connect → Google popup → consent to drive.file scope. Token stored. (AUTH-2, AUTH-3)
4. First-time: see "Select your data file" → click Open Drive Picker → select the file → Picker closes → main screen with summary loads. (Picker deviation, READ-1, READ-2, READ-5)
5. Refresh the browser → loading flashes briefly → main screen shows directly, no Connect screen. (AUTH-4, LIFECYCLE-1)
6. Open dev console, manually clear `localStorage['tvrecs.token']`, then trigger a mutator (or wait for the existing token to expire) → see "Reconnect Google Drive" screen, in-memory state preserved. (AUTH-5)
7. Click Refresh → fetch happens, lastSyncedAt updates. (LIFECYCLE-4, STATE-4)
8. Click Sign out → return to Connect screen, in-memory state cleared. (AUTH-6)

---

# Acceptance criteria — recommendations-ui

All AC IDs are also referenced inline in code comments at the satisfying line.

## LIST

- **LIST-1** ✓ `js/recommendations-ui.js → render` filters `state.data.recommended` to entries where `feedback === null`. Already-rated entries stay in the file but don't render.
- **LIST-2** ✓ `js/recommendations-ui.js → sortRecs("newest")` sorts descending by `recommendedAt`, ties broken by original array order.
- **LIST-3** ✓ Sort toggle in `js/recommendations-ui.js → render` flips `sortMode` between `"newest"` and `"az"`. Button label reflects current mode.
- **LIST-4** ✓ `js/recommendations-ui.js → renderCard` shows title, platform, rating, blurb. Nothing else.
- **LIST-5** ✓ No code-path branches on `isExplorationPick`. Exploration picks render identically to other cards.
- **LIST-6** ✓ `js/recommendations-ui.js → render` shows the empty-state copy when `pending.length === 0`.
- **LIST-7** ✓ `.rec-list { display: flex; flex-direction: column; gap: 1rem; }` in `styles.css`.
- **LIST-8** ✓ `js/state.js` calls `emit()` on every state change; `js/app.js → render → ui.renderMain` is wired to it via `state.subscribe`. `renderMain` calls `recommendationsUi.render` from scratch each time, so the list reflects current state without a manual refresh.

## FEEDBACK

- **FEEDBACK-1** ✓ `js/recommendations-ui.js → renderCard` adds five buttons: Loved / OK / Disliked / Watchlist / Dismiss.
- **FEEDBACK-2** ✓ Loved / OK / Disliked buttons call `mutators.setRecommendationFeedback(id, value)`. The mutator both sets `feedback` on the recommendation AND appends to `watched` (per PRODUCT.md "rates a recommendation as watched") in one Drive write, with `watchedAt` = today's date.
- **FEEDBACK-3** ✓ Watchlist button calls the combined mutator `mutators.markRecommendationAsWatchlist(id)`. Single Drive write does both feedback flip (to `"watchlist"`) and watchlist append. Atomic.
- **FEEDBACK-4** ✓ Dismiss button calls `mutators.dismissRecommendation(id)`. Single Drive write sets recommendation `feedback` to `"dismissed"` AND appends to `watched` with `feedback: "dismissed"` and `watchedAt: null`. The null `watchedAt` distinguishes a Dismiss from a Disliked-after-watching. The `"dismissed"` feedback in `watched` is exclusion-only — the skill keeps the show out of future picks but does not feed any positive, negative, or ambiguous signal from it.
- **FEEDBACK-5** ✓ `js/recommendations-ui.js → makeButton` disables every action button on the card before awaiting the mutator. On revert (failure) the card is rebuilt fresh by the next render, so buttons come back enabled.
- **FEEDBACK-6** ✓ `state.js`'s existing revert path (WRITE-5) restores in-memory data on failure; `state.writeError` is set; `ui.renderMain → status-bar` surfaces the message. Card reappears on the next render.

## BOUNDARY (recommendations-ui)

- **BOUNDARY-1** ✓ No code in `js/recommendations-ui.js` reads or writes `tasteProfile`. Belt-and-braces: `state.js`'s WRITE-4 check would block any accidental mutation.
- **BOUNDARY-2** ✓ Watchlist tap appends to `watchlist`, not `watched`. Other taps follow the rules above.

## Manual smoke test (recommendations-ui)

1. Recommendation cards visible; toggle Sort flips between Newest / A→Z. (LIST-2, LIST-3)
2. Tap **OK** on a card → disappears immediately, saving dot, last-synced updates; verify via `drive-helper.sh read` that the rec has `feedback: "ok"` AND `watched` has a new entry with `feedback: "ok"`, `watchedAt` = today. (FEEDBACK-2)
3. Tap **Watchlist** on another → disappears; verify rec has `feedback: "watchlist"` AND `watchlist` has the new entry. (FEEDBACK-3)
4. Tap **Dismiss** on another → disappears; verify rec has `feedback: "dismissed"` AND `watched` has a new entry with `feedback: "dismissed"`, `watchedAt: null`. (FEEDBACK-4)
5. Reload → rated cards stay gone. (LIST-1 + state.js round-trip)
6. Optional: DevTools → Network → Offline, tap a button → after retry, error shows in status bar, card returns. (FEEDBACK-6)

---

# Acceptance criteria — watchlist-ui

All AC IDs are also referenced inline in code comments.

## NAV

- **NAV-1** ✓ `js/ui.js → renderMain` builds a `.tab-strip` with two `.tab` buttons. Labels include live counts: pending recs (LIST-1 filter) and `watchlist.length`.
- **NAV-2** ✓ The active tab gets the `tab-active` class (heavier weight + accent underline in CSS).
- **NAV-3** ✓ Tab clicks update `activeTab` (module-level) and call `renderMain` again. No page reload, no extra network call.
- **NAV-4** ✓ `activeTab` defaults to `"recommendations"` on module load.

## WLIST

- **WLIST-1** ✓ `js/watchlist-ui.js → render` reads `state.data.watchlist` and renders every entry. No filter (presence in the array == in the watchlist).
- **WLIST-2** ✓ `sortEntries("newest")` sorts descending by `addedAt`, ties broken by original array order.
- **WLIST-3** ✓ Sort toggle in the section header flips between `"newest"` and `"az"`. Same UX as recommendations-ui.
- **WLIST-4** ✓ `renderCard` shows title and a meta line: "Added &lt;date&gt; · from a recommendation" or "added manually".
- **WLIST-5** ✓ Empty-state copy renders when `watchlist.length === 0`.
- **WLIST-6** ✓ Re-uses `.rec-card` and `.rec-list` styles for visual consistency.
- **WLIST-7** ✓ Re-renders via the parent (`ui.renderMain`) on every state change, same path as recommendations-ui (LIST-8).

## WACTION

- **WACTION-1** ✓ Four buttons per card: Loved / OK / Disliked / Dismiss.
- **WACTION-2** ✓ Loved / OK / Disliked call `mutators.moveWatchlistToWatched(id, value, today)`. Mutator removes from `watchlist`, appends to `watched` with `watchedAt` = today.
- **WACTION-3** ✓ Dismiss calls `mutators.moveWatchlistToWatched(id, "dismissed", null)` — same mutator, but `watchedAt = null`. The null is the data tell that the user changed their mind without watching. The `"dismissed"` feedback is exclusion-only — the skill keeps the show out of future picks but does not feed any signal from it.
- **WACTION-4** ✓ `makeButton` disables siblings on click; the post-mutation re-render restores fresh enabled buttons (or, on failure, rebuilds the card with fresh enabled buttons too).
- **WACTION-5** ✓ Failures flow through state.js's revert path → `state.writeError` → `.status-error` in the status bar.

## BOUNDARY (watchlist-ui)

- **BOUNDARY-1** ✓ No code in `js/watchlist-ui.js` touches `tasteProfile`.
- **BOUNDARY-2** ✓ No code in `js/watchlist-ui.js` modifies `recommended`. The original recommendation entry's `feedback === "watchlist"` is left as-is — it's the historical record of the parking action.

## Manual smoke test (watchlist-ui)

1. Click the **Watchlist** tab → switches view, no reload. (NAV-1, NAV-3)
2. With existing watchlist items: cards render, sort toggle flips Newest / A→Z. (WLIST-1..3)
3. Empty case: with all items watched, see the empty-state copy. (WLIST-5)
4. Tap **Loved** on a card → disappears; verify via `drive-helper.sh read` that the entry is gone from `watchlist` AND `watched` has a new entry with the right values. (WACTION-2)
5. Tap **Dismiss** on another → disappears; verify same removal AND new `watched` entry has `feedback: "dismissed"`, `watchedAt: null`. (WACTION-3)
6. Switch back to Recommendations tab — the count in the tab labels should reflect the changes. (NAV-1)

---

# Acceptance criteria — manual-add

All AC IDs are also referenced inline in code comments.

## SEARCH

- **SEARCH-1** ✓ `js/recommendations-ui.js → render` mounts a section at the top of the Recommendations tab and calls `manual-add.render(section)`. Placeholder: "Add a show you've seen or want to see…".
- **SEARCH-2** ✓ `js/manual-add.js → renderSearch` debounces 300 ms and gates at 2 chars before firing `tmdb.searchTV`.
- **SEARCH-3** ✓ `js/tmdb.js → shape` slices to 8. Result rows show title, year, poster thumb (when TMDB has one).
- **SEARCH-4** ✓ `js/tmdb.js → searchTV` builds `https://api.themoviedb.org/3/search/tv?query=…&api_key=…`. Posters via `https://image.tmdb.org/t/p/w92{poster_path}` (and w185 for the action-bar preview).
- **SEARCH-5** ✓ TMDB errors propagate; `js/manual-add.js → doSearch` surfaces them in `.manual-add-status` with the `status-error` class. Rest of the UI stays interactive.
- **SEARCH-6** ✓ Input below 2 chars clears `lastResults` and the rendered list.
- **SEARCH-7** ✓ `js/tmdb.js → cache` map keyed by normalised query.

## ACT

- **ACT-1** ✓ `js/manual-add.js → onPick` swaps `mode` to `"act"` and `renderAct` builds a rich preview: large poster (when present), title + year, TMDB rating, lead actors (filled in by `enrichWithDetails` after a follow-up `/tv/{id}?append_to_response=credits` fetch), blurb, then five buttons.
- **ACT-2** ✓ Loved / OK / Disliked invoke `mutators.addManualToWatched({title, tmdbId}, value, today)`. Appends to `watched`.
- **ACT-3** ✓ Watchlist invokes `mutators.addToWatchlist({title, tmdbId, addedAt: today, addedBy: "manual"})`.
- **ACT-4** ✓ Dismiss invokes `mutators.addManualToWatched({title, tmdbId}, "dismissed", null)`. Exclusion-only — the skill won't recommend the show again but does not feed any signal from it.
- **ACT-5** ✓ Cancel button in `renderAct` resets state and returns to the empty search.
- **ACT-6** ✓ Optimistic semantics flow through `state.runMutation`. On success the search clears; on failure `renderAct` is called again so buttons re-enable.
- **ACT-7** ✓ `makeActButton` disables the click target and its siblings before awaiting the mutation.

## BOUNDARY (manual-add)

- **BOUNDARY-1** ✓ No code path reads or writes `tasteProfile`.
- **BOUNDARY-2** ✓ No code path writes to `recommended`. Manual-add lands entries in `watched` or `watchlist` only.

## Manual smoke test (manual-add)

1. Type ≥2 chars in the search input → results appear after the debounce.
2. Click a result → action bar shows poster, title (year), rating, lead actors (after a brief delay for the credits fetch), blurb, and five buttons.
3. Tap **Loved** → action bar collapses, search resets, watched gains the entry with today's date.
4. Tap **Watchlist** → entry appears in the Watchlist tab with `addedBy: "manual"`.
5. Tap **Dismiss** → watched gains an entry with `feedback: "dismissed"` and `watchedAt: null`.
6. Type a string TMDB doesn't have → "No matches." renders.
7. Disconnect network → an inline error appears under the input; the rest of the UI keeps working.
