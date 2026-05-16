// CONFIG-1, CONFIG-4: validate that config.js exists and has all four required
// values, none of which are still the placeholder strings from
// config.example.js.

const REQUIRED = [
  "GOOGLE_CLIENT_ID", // CONFIG-1
  "GOOGLE_API_KEY",   // CONFIG-1 (extra over spec; needed for Drive Picker)
  "TMDB_API_KEY",     // CONFIG-1
  "DATA_FILE_ID",     // CONFIG-1
  "WORKER_URL",       // OAuth token exchange/refresh proxy (Cloudflare Worker)
];

const PLACEHOLDERS = new Set([
  "YOUR_GOOGLE_CLIENT_ID_HERE",
  "YOUR_GOOGLE_API_KEY_HERE",
  "YOUR_TMDB_API_KEY_HERE",
  "YOUR_DATA_FILE_ID_HERE",
  "YOUR_WORKER_URL_HERE",
  "",
]);

export function loadConfig() {
  const cfg = window.tvrecs_config;

  if (!cfg || typeof cfg !== "object") {
    // CONFIG-1: app does not start successfully if config is missing.
    // CONFIG-4: surface as a clear error state, not a broken UI.
    return { ok: false, missing: REQUIRED.slice(), placeholder: [], cfg: null };
  }

  const missing = [];
  const placeholder = [];
  for (const key of REQUIRED) {
    const value = cfg[key];
    if (value === undefined || value === null) {
      missing.push(key); // CONFIG-1
    } else if (typeof value !== "string" || PLACEHOLDERS.has(value)) {
      placeholder.push(key); // CONFIG-4
    }
  }

  return {
    ok: missing.length === 0 && placeholder.length === 0, // CONFIG-1, CONFIG-4
    missing,
    placeholder,
    cfg,
  };
}
