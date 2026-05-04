# Feature: auth-and-data-sync

## Purpose

The foundation feature. Authenticates the user with Google, fetches the canonical JSON data file from Google Drive, holds it as in-memory app state, and writes changes back to the file when other features request it. Every other feature depends on this one.

## Acceptance criteria

### CONFIG (configuration)

- **CONFIG-1**: A `config.js` file (gitignored) exports three values: `GOOGLE_CLIENT_ID`, `TMDB_API_KEY`, and `DATA_FILE_ID`. The app does not start successfully if any are missing.
- **CONFIG-2**: A `config.example.js` is committed to the repo with placeholder values and a comment explaining how to obtain each one.
- **CONFIG-3**: `config.js` is listed in `.gitignore`.
- **CONFIG-4**: If the app loads and detects missing or placeholder config values, it shows a clear error state with instructions, not a broken UI.

### AUTH (authentication)

- **AUTH-1**: First-time visit (no stored token) shows a "Connect Google Drive" button and no other app UI.
- **AUTH-2**: Clicking Connect triggers a Google OAuth 2.0 flow using Google Identity Services, requesting scope `https://www.googleapis.com/auth/drive.file`. If `drive.file` does not work because the data file was created outside the app, the app falls back to `https://www.googleapis.com/auth/drive` and documents this in the README.
- **AUTH-3**: After successful OAuth, the access token is stored in `localStorage` under a single namespaced key (e.g. `tvrecs.token`).
- **AUTH-4**: On subsequent page loads, if a stored token exists, the app uses it without re-prompting. The "Connect Google Drive" screen is skipped.
- **AUTH-5**: If a request to Drive returns 401 or 403, the app clears the stored token and shows a "Reconnect Google Drive" prompt. In-memory state from before the auth failure is preserved until the user reconnects, so unsaved feedback is not lost silently.
- **AUTH-6**: There is a "Sign out" or "Disconnect" control somewhere in the app's settings or navigation that clears the stored token and returns the user to the connect screen.

### READ (initial data load)

- **READ-1**: After successful authentication, the app fetches the file at `DATA_FILE_ID` using `GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`.
- **READ-2**: The fetched JSON is parsed and held in memory as the canonical app state. All feature reads come from this in-memory state, not from refetching.
- **READ-3**: If the file fetch fails (network error, 404, etc.), the app shows an error state with the underlying error message and a "Retry" button. It does not silently proceed with empty state.
- **READ-4**: If the file content is not valid JSON, the app shows an error state showing the parse error. It does not attempt to recover or guess at the structure.
- **READ-5**: If any of the four expected top-level keys (`watched`, `watchlist`, `recommended`, `tasteProfile`) are missing, the app treats them as empty arrays/objects in memory but does NOT write back this assumed structure unless the user takes an action that requires it. The original file is left intact.

### WRITE (saving changes)

- **WRITE-1**: Before any write, the app refetches the full file from Drive to get the latest version. The user-initiated change is then applied to that fresh copy, not to a stale in-memory version.
- **WRITE-2**: Writes use `PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=media` with the full updated JSON in the body and `Content-Type: application/json`.
- **WRITE-3**: A write only ever modifies the specific arrays/fields the user's action targets. All other top-level keys, and all unrelated entries within touched arrays, are preserved byte-for-byte where possible (key order may shift but no data is dropped).
- **WRITE-4**: The `tasteProfile` field is never modified by the app under any circumstances. If a write would require changing it, the write is blocked and an error is logged.
- **WRITE-5**: A failed write (network error or non-2xx response) is retried once automatically after a 1-second delay. If the retry also fails, the app surfaces an error toast/banner with the underlying error message and reverts the optimistic in-memory change.
- **WRITE-6**: After a successful write, the in-memory state is updated to match what was just written, so subsequent reads do not need to refetch from Drive.

### STATE (in-memory state)

- **STATE-1**: The app exposes a single `getState()` accessor that returns the current in-memory copy of the data file. Features read from this, not from their own caches.
- **STATE-2**: The app exposes mutator functions for each kind of change (e.g. `setRecommendationFeedback`, `addToWatchlist`, `moveWatchlistToWatched`). Mutators are responsible for the refetch-modify-write sequence in WRITE-1 through WRITE-6.
- **STATE-3**: While a write is in flight, the UI shows a subtle indicator (e.g. a small "saving" dot in the corner). The user can continue to interact with the app, but if they trigger another mutator before the previous write completes, the new mutator queues behind it rather than racing.
- **STATE-4**: There is a "last synced" timestamp visible somewhere unobtrusive, updated after every successful read or write.

### LIFECYCLE (page lifecycle and edge cases)

- **LIFECYCLE-1**: Loading state. While the initial file fetch is in flight, the app shows a loading indicator, not a flash of empty UI.
- **LIFECYCLE-2**: If the user opens the app while the scheduled task is also writing (rare but possible on Sundays around 8am), the WRITE-1 refetch ensures the user's change is applied on top of the latest file. Last-write-wins is acceptable for this single-user app — no merge logic needed.
- **LIFECYCLE-3**: The app does not poll or refetch on a timer. The data file only reloads on initial page load, after a successful write, or when the user explicitly triggers a refresh.
- **LIFECYCLE-4**: A manual "Refresh" control is available somewhere unobtrusive, which refetches the file and updates in-memory state. Useful if the user knows the scheduled task has just run.

## Out of scope for this feature

- Any UI for the actual data (recommendations, watchlist, history). Those are separate features and should not be built as part of this one.
- TMDB integration. Lives in `tmdb-metadata`.
- Conflict resolution beyond last-write-wins.
- Offline support.

## Notes for the implementer

- Use Google Identity Services (GIS), not the older `gapi.auth2`. GIS is the current supported library.
- The Drive API requires the access token in an `Authorization: Bearer <token>` header on every request. There is no separate API key for Drive in this flow.
- For local development, GitHub Pages will be the production origin (`https://<username>.github.io`). When registering the OAuth client in Google Cloud Console, also add `http://localhost:8000` (or whichever port the user serves locally) as an authorized JavaScript origin.
- Reference each acceptance criterion ID (e.g. `// AUTH-3`, `// WRITE-5`) in code comments next to the line that satisfies it.
