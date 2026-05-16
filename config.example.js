// CONFIG-2: example config. Copy this file to ./config.js (project root)
// and fill in your values. config.js is gitignored — never commit it.
//
// See README.md for step-by-step instructions on obtaining each value.

window.tvrecs_config = {
  // Google OAuth Web client ID.
  // Cloud Console -> APIs & Services -> Credentials -> Create credentials
  //   -> OAuth client ID -> Web application.
  // Authorised JavaScript origins must include http://localhost:8000
  // and (for production) your GitHub Pages URL, e.g. https://<user>.github.io.
  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID_HERE",

  // Google API key, used by the Drive Picker (and only the Picker).
  // Cloud Console -> Credentials -> Create credentials -> API key.
  // Restrict to: Google Drive API + Google Picker API; HTTP referrers
  // http://localhost:8000/* and https://<user>.github.io/*.
  GOOGLE_API_KEY: "YOUR_GOOGLE_API_KEY_HERE",

  // TMDB v3 API key.
  // Sign up at themoviedb.org -> Settings -> API -> Request key (Developer).
  // Use the v3 "API Key", not the long Bearer token.
  // (Not used by this feature, but required by config validation so later
  // features can use it without re-prompting.)
  TMDB_API_KEY: "YOUR_TMDB_API_KEY_HERE",

  // File ID of the shared tv-recommendations.json in Google Drive.
  // From the Drive URL: drive.google.com/file/d/{THIS_PART}/view
  DATA_FILE_ID: "YOUR_DATA_FILE_ID_HERE",

  // Cloudflare Worker URL that proxies the Google token endpoint for
  // authorization-code exchange and refresh. Deployed from code/worker/
  // via `wrangler deploy`; the URL is printed by wrangler. Looks like
  //   https://tv-recs-oauth.<your-subdomain>.workers.dev
  // No trailing slash.
  WORKER_URL: "YOUR_WORKER_URL_HERE",
};
