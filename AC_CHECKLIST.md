# Acceptance criteria — auth-and-data-sync

All AC IDs are also referenced inline in code comments at the satisfying line.

## Documented spec deviation

- **AUTH-2**: The spec says try `drive.file`, fall back to `drive`. This build uses `drive.file` + Drive Picker instead, so the app's blast radius is one file even after a successful sign-in. This required adding a fourth config value, `GOOGLE_API_KEY` (for the Picker), so CONFIG-1 lists four values rather than three. README documents both the deviation and the new config value.

## CONFIG

- **CONFIG-1** ✓ `js/config-check.js` requires `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `TMDB_API_KEY`, `DATA_FILE_ID`. App does not start (renders config-error screen instead) if any are missing. (Spec says three values; deviation note above.)
- **CONFIG-2** ✓ `config.example.js` committed at project root, comments link each placeholder to the README step that explains how to obtain it.
- **CONFIG-3** ✓ `.gitignore` already lists `config.js` (added in the initial commit).
- **CONFIG-4** ✓ `js/config-check.js` detects missing *and* placeholder values; `js/ui.js → renderConfigError` shows a clear screen listing what's missing or still a placeholder, with a pointer to README.

## AUTH

- **AUTH-1** ✓ `js/app.js → render()` shows `ui.renderConnect` (a screen with only the "Connect Google Drive" button) when `auth.getStoredToken()` is null.
- **AUTH-2** ✓ `js/auth.js → init` initialises a GIS token client with scope `drive.file`. The Picker (`auth.pickFile`) handles the "file created outside the app" case via per-file grant rather than scope fallback. Documented as a deviation above. Additional Picker config required for the grant to actually take across browsers, learned during integration testing: `setAppId(<project number>)`, `setOrigin(window.location.protocol + '//' + window.location.host)`, and no MIME filter on the view (Drive sometimes reports unexpected MIME types and a strict filter hides the file). These are all in `auth.js → pickFile`.
- **AUTH-3** ✓ `js/auth.js → handleTokenResponse` writes the access token to `localStorage['tvrecs.token']`.
- **AUTH-4** ✓ `js/app.js → boot` calls `tryLoad()` directly when `auth.getStoredToken()` returns a value, bypassing the connect screen.
- **AUTH-5** ✓ Drive errors classified as `kind="auth"` (`js/drive.js → classify`) propagate to `state.internal.authError`. `js/app.js → render()` then clears the stored token (`auth.clearToken()`) and renders `ui.renderReconnect`. In-memory `state.internal.data` is preserved across the auth error (only on user-initiated sign-out is `state.reset()` called).
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

- **FEEDBACK-1** ✓ `js/recommendations-ui.js → renderCard` adds four buttons.
- **FEEDBACK-2** ✓ Loved / OK / Disliked buttons call `mutators.setRecommendationFeedback(id, value)`. Optimistic disappearance falls out of `state.runMutation` (it applies the change to in-memory data immediately, the LIST-1 filter then excludes the entry on the next render).
- **FEEDBACK-3** ✓ Watchlist button calls the new combined mutator `mutators.markRecommendationAsWatchlist(id)`. Single Drive write does both feedback flip and watchlist append. Atomic by virtue of being one PATCH.
- **FEEDBACK-4** ✓ `js/recommendations-ui.js → makeButton` disables every action button on the card before awaiting the mutator. On revert (failure) the card is rebuilt from scratch via the next render, so buttons come back fresh and enabled.
- **FEEDBACK-5** ✓ `state.js`'s existing revert path (WRITE-5) restores in-memory data on failure; `state.writeError` is set; `ui.renderMain → status-bar` surfaces the message. Card reappears on the next render.

## BOUNDARY

- **BOUNDARY-1** ✓ No code in `js/recommendations-ui.js` reads or writes `tasteProfile`. Belt-and-braces: `state.js`'s WRITE-4 check would block any accidental mutation.
- **BOUNDARY-2** ✓ No code in `js/recommendations-ui.js` reads or writes the `watched` array. Watchlist tap appends to `watchlist`, not `watched`.

## Manual smoke test

Run `python3 -m http.server 8000` in the repo root, open `http://localhost:8000`, sign in if needed, then:

1. Main screen should show one or more recommendation cards (10 in current data) sorted newest first. Empty state if zero. (LIST-1, LIST-2, LIST-6)
2. Click the sort toggle → list re-sorts A→Z. Click again → back to newest. (LIST-3)
3. Tap **OK** on a card → card disappears immediately, saving dot appears, then disappears, last-synced timestamp updates. (FEEDBACK-2, STATE-3, STATE-4)
4. Tap **Watchlist** on another card → card disappears, single write happens (one saving dot cycle), last-synced updates. Verify with `drive-helper.sh read` from terminal that the recommendation got `feedback: "watchlist"` AND a new entry appeared in `watchlist` with `addedBy: "recommendation"`. (FEEDBACK-3)
5. Reload the page → the cards you rated stay gone; their entries persist in the JSON file. (LIST-1 + state.js round-trip)
6. Optional failure path: kill your network (DevTools → Network → Offline), tap a feedback button → after the retry, an error appears and the card returns to the list. (FEEDBACK-5)
