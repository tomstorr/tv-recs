// TMDB search wrapper.
//
// SEARCH-4: hits https://api.themoviedb.org/3/search/tv with the API key
// from config.js. SEARCH-7: in-memory cache keyed by normalised query.
//
// No timer / polling / persistence — single-page lifetime.

const ENDPOINT = "https://api.themoviedb.org/3/search/tv";
const POSTER_BASE_THUMB = "https://image.tmdb.org/t/p/w92";
const POSTER_BASE_LARGE = "https://image.tmdb.org/t/p/w185";

const cache = new Map(); // SEARCH-7

function normaliseKey(q) {
  return q.trim().toLowerCase();
}

function configKey() {
  const cfg = window.tvrecs_config || {};
  if (!cfg.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY not set in config.js");
  }
  return cfg.TMDB_API_KEY;
}

function pickYear(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})/);
  return m ? m[1] : null;
}

function shape(raw) {
  // Trim TMDB's response down to what we actually need on screen.
  // Two poster sizes: w92 for the compact result row, w185 for the
  // richer action-bar preview after the user picks one.
  const results = (raw && Array.isArray(raw.results) ? raw.results : []).slice(0, 8); // SEARCH-3
  return results.map((r) => ({
    title: r.name || r.original_name || "Untitled",
    tmdbId: typeof r.id === "number" ? r.id : null,
    year: pickYear(r.first_air_date),
    posterUrl: r.poster_path ? POSTER_BASE_THUMB + r.poster_path : null, // SEARCH-4
    posterUrlLarge: r.poster_path ? POSTER_BASE_LARGE + r.poster_path : null,
    overview: r.overview || null,
    voteAverage: typeof r.vote_average === "number" ? r.vote_average : null,
  }));
}

// Fetch full details for a single TV show by tmdbId, including the
// credits subresource so we get the cast list (lead actors) in one call.
// Same in-memory cache; details cached under a "details:" prefix so it
// can't collide with a search result that happens to be the same string.
export async function getDetails(tmdbId) {
  if (tmdbId == null) return null;
  const cacheKey = `details:${tmdbId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const url =
    `https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}` +
    `?append_to_response=credits&api_key=${encodeURIComponent(configKey())}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = new Error(`TMDB details failed: HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const r = await resp.json();
  const rawCast = (r.credits && Array.isArray(r.credits.cast)) ? r.credits.cast : [];
  // Lead actors — TMDB orders by importance. Cap at 4 names.
  const cast = rawCast.slice(0, 4).map((p) => ({
    name: p.name || p.original_name || null,
    role: p.character || null,
  })).filter((p) => p.name);
  const shaped = {
    title: r.name || r.original_name || "Untitled",
    tmdbId: typeof r.id === "number" ? r.id : null,
    year: pickYear(r.first_air_date),
    overview: r.overview || null,
    voteAverage: typeof r.vote_average === "number" ? r.vote_average : null,
    posterUrl: r.poster_path ? POSTER_BASE_THUMB + r.poster_path : null,
    posterUrlLarge: r.poster_path ? POSTER_BASE_LARGE + r.poster_path : null,
    cast,
  };
  cache.set(cacheKey, shaped);
  return shaped;
}

// SEARCH-2: caller is responsible for debouncing and the min-char gate.
export async function searchTV(query) {
  const key = normaliseKey(query);
  if (cache.has(key)) return cache.get(key); // SEARCH-7
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&api_key=${encodeURIComponent(configKey())}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = new Error(`TMDB search failed: HTTP ${resp.status}`); // SEARCH-5
    err.status = resp.status;
    throw err;
  }
  const json = await resp.json();
  const shaped = shape(json);
  cache.set(key, shaped);
  return shaped;
}
