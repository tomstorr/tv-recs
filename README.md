# TV Recs

Single-page web app for managing weekly TV recommendations. Pairs with a separate scheduled task that emails recommendations every Sunday and writes them to a shared JSON file in Google Drive. The app and the task share that one file in place.

This first build is the **auth-and-data-sync** feature: sign in to Google, fetch the data file, hold it in memory, and write changes back. Recommendation, watchlist, and history UIs come in later features.

## What you need

- A Google account that owns the shared `tv-recommendations.json` file.
- A Google Cloud project (free, no billing).
- A TMDB API key (free).
- Python 3 to serve the page locally — already on macOS.

---

## Setup

### 1. Google Cloud project + Drive APIs

1. Sign in at **console.cloud.google.com** as the same Google account that owns the data file.
2. Top bar → project picker → **New project**. Name it (e.g. `tv-recs`).
3. Left menu → **APIs & Services → Library**.
4. Search **Google Drive API** → click → **Enable**.
5. Search **Google Picker API** → click → **Enable**. (Required for the per-file Drive Picker flow this app uses.)

### 2. OAuth consent screen / Auth Platform

The new Google Cloud UI calls this "Google Auth Platform". Either way:

1. Left menu → **APIs & Services → OAuth consent screen** (or **Auth Platform**).
2. **User type:**
   - If you have a Google Workspace org and you're the only intended user: choose **Internal**. No verification needed.
   - Otherwise: choose **External** and add your own Google address as a Test user.
3. **Branding:** name `TV Recs`, fill in your email for support and developer contact.
4. **Data access (Scopes):** add `https://www.googleapis.com/auth/drive.file`.
5. Save.

### 3. OAuth Web client (for the app)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name it `TV Recs Web`.
3. **Authorised JavaScript origins** — add:
   - `http://localhost:8000`
   - your production URL (e.g. `https://<username>.github.io`)
4. Leave **Authorised redirect URIs** empty.
5. Create. Copy the **Client ID** — that's `GOOGLE_CLIENT_ID` in config.js.

### 4. API key (for the Drive Picker)

1. **Credentials → Create credentials → API key**.
2. Edit the key:
   - **Name:** `TV Recs Browser Key`.
   - **API restrictions:** restrict to **Google Drive API** + **Google Picker API**.
   - **Application restrictions:** **Websites**, and add:
     - `http://localhost:8000/*`
     - `https://<username>.github.io/*`
3. Save. Copy the key — that's `GOOGLE_API_KEY` in config.js.

### 5. TMDB API key

1. Sign up at **themoviedb.org**.
2. **Settings → API → Request API Key → Developer**.
3. Fill in basic details. App URL `https://<username>.github.io/tv-recs/` is fine. Approval is usually instant.
4. Copy the **API Key (v3 auth)** — the shorter one, **not** the long Bearer / Read Access Token. That's `TMDB_API_KEY` in config.js.

(This feature does not call TMDB, but config validation requires the key to be present so later features can use it.)

### 6. Find the Drive file ID

The file is `tv-recommendations.json` in your Google Drive. From its Drive URL:

```
https://drive.google.com/file/d/{THIS_PART_IS_THE_ID}/view
```

That's `DATA_FILE_ID` in config.js.

### 7. Create config.js

```sh
cp config.example.js config.js
# then open config.js and fill in the four values from steps 3, 4, 5, 6
```

`config.js` is gitignored — never commit it.

---

## Running locally

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`.

The first time you sign in, the **Drive Picker** will open and ask you to select your `tv-recommendations.json` file. The app will then have `drive.file` access to that one file only — nothing else in your Drive. You won't see the Picker again unless you sign out and sign back in on a different machine.

---

## Deviation from the spec

The spec (AUTH-2) says: try `drive.file` scope, fall back to `drive` if the data file was created outside the app. This build instead uses `drive.file` + the **Drive Picker** to grant per-file access without ever asking for the broader `drive` scope. Per-file access is materially safer — the resulting access token can read/write only the picked file, not your whole Drive.

---

## Architecture

- `index.html` — entry; loads `config.js` then `js/app.js` as a module.
- `config.js` (gitignored) — `window.tvrecs_config = { ... }`.
- `js/config-check.js` — validates config (CONFIG-1, CONFIG-4).
- `js/auth.js` — Google Identity Services sign-in + Drive Picker.
- `js/drive.js` — Drive API read/write.
- `js/state.js` — in-memory state + mutator queue with refetch-modify-write-retry-revert.
- `js/mutators.js` — named mutators (consumed by later features).
- `js/ui.js` — screens (connect / loading / picker / main / error / reconnect).
- `js/app.js` — boot orchestration and screen routing.

See `AC_CHECKLIST.md` for the per-criterion satisfaction map.
