# TV Recommendations App

## What this is

A personal web app for managing weekly TV show recommendations. The app pairs with a separate scheduled task that emails recommendations every Sunday and writes them to a JSON file in Google Drive. The app reads and writes the same file: it lets the user rate recommendations, manage a watchlist, and add shows manually via TMDB search.

## Who uses it

A single user (the owner). No multi-user, no sharing, no accounts beyond the owner's own Google account for Drive access. Designed for personal use only.

## Why it exists

The scheduled task already sends recommendations by email, but email is one-way. Without structured feedback, the recommendations cannot improve over time. This app turns each recommendation into a one-tap action — rate it, save it, dismiss it — and writes the result back to the shared data file. The next scheduled run reads the feedback and uses it to refine future picks.

## How it fits with the scheduled task

- The scheduled task and the app share one JSON file in the user's Google Drive. File ID is configured per-environment.
- The scheduled task owns the `tasteProfile` field. The app reads it but never writes to it.
- The scheduled task appends new entries to the `recommended` array each Sunday. The app updates `feedback` on those entries.
- The app owns adding to `watchlist` and moving items between `watchlist` and `watched`.
- Both write to the `watched` array — the task adds nothing here directly, the app does so when the user marks a watchlist item as watched or rates a recommendation as watched.

## Constraints

- Single static site. Vanilla HTML, CSS, JavaScript. No frameworks, no build step.
- Hosted on GitHub Pages.
- Desktop-first, mobile-friendly. The user accesses the app primarily on desktop but should be able to rate quickly on a phone.
- Two external services: Google Drive (for the data file) and TMDB (for show metadata and posters). No other backend.
- Configuration values (OAuth client ID, TMDB key, file ID) are loaded from a gitignored `config.js`.

## Out of scope

The following are explicitly not part of this product. They may be added later but should not be built unless promoted to scope:

- Multi-user support, sharing, or social features
- Notifications, push, or email from the app itself
- Full collaborative-filtering or ML-based recommendations (Claude in the scheduled task does the recommending)
- Editing the `tasteProfile` from the app UI (the user can edit the JSON file directly if needed)
- Offline support beyond what the browser does naturally
- Mobile apps, PWA installation flows, or native packaging
- Importing watch history from third-party services (Trakt, Letterboxd, etc.)
- Triggering the scheduled task from the app

## Data file schema (reference)

Defined in detail in the scheduled task spec. The app must treat this as the contract.

```json
{
  "watched": [
    { "title": "string", "tmdbId": "number|null", "feedback": "loved|ok|disliked", "watchedAt": "YYYY-MM-DD|null" }
  ],
  "watchlist": [
    { "title": "string", "tmdbId": "number|null", "addedAt": "YYYY-MM-DD", "addedBy": "manual|recommendation" }
  ],
  "recommended": [
    {
      "title": "string",
      "tmdbId": "number|null",
      "platform": "string",
      "recommendedAt": "YYYY-MM-DD",
      "blurb": "string",
      "rating": "string",
      "feedback": "null|loved|ok|disliked|watchlist",
      "matchedSignals": ["string"],
      "isExplorationPick": "boolean"
    }
  ],
  "tasteProfile": { "...owned by scheduled task..." }
}
```
