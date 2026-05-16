// AUTH-1..AUTH-6.
//
// Switched 2026-05-16 from GIS implicit popup flow (access token only,
// ~1h lifetime, weekly login) to redirect-based OAuth authorization-code
// flow with refresh tokens. Token exchange/refresh go through the
// Cloudflare Worker at WORKER_URL because the client_secret can't live
// in browser JS. The browser still talks to Drive directly with the
// Bearer access token.

const ACCESS_TOKEN_KEY = "tvrecs.access_token";   // AUTH-3
const REFRESH_TOKEN_KEY = "tvrecs.refresh_token";
const OAUTH_STATE_KEY = "tvrecs.oauth_state";     // sessionStorage; one redirect-cycle only

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GAPI_SRC = "https://apis.google.com/js/api.js"; // still needed for the Drive Picker

let _config = null;
let onTokenChange = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") { resolve(); return; }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.addEventListener("load", () => { s.dataset.loaded = "true"; resolve(); });
    s.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(s);
  });
}

function redirectUri() {
  // Must match exactly one of the Authorized redirect URIs in Google Cloud.
  return window.location.origin + window.location.pathname;
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isOAuthCallback() {
  const p = new URLSearchParams(window.location.search);
  return p.has("code") || p.has("error");
}

async function handleOAuthCallback() {
  const p = new URLSearchParams(window.location.search);
  const code = p.get("code");
  const returnedState = p.get("state");
  const errorParam = p.get("error");
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  // Always clean the URL before doing anything else — even on error, we
  // don't want a refresh to re-process the same code.
  history.replaceState({}, "", window.location.pathname);

  if (errorParam) {
    throw new Error(`OAuth error: ${errorParam}`);
  }
  if (!code) {
    throw new Error("OAuth callback missing code");
  }
  if (!expectedState || returnedState !== expectedState) {
    throw new Error("OAuth state mismatch — possible CSRF, refusing exchange");
  }

  const resp = await fetch(`${_config.WORKER_URL}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri() }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Token exchange failed: ${data.error_description || data.message || data.error || resp.status}`);
  }
  storeTokens(data);
}

function storeTokens({ access_token, refresh_token }) {
  if (access_token) localStorage.setItem(ACCESS_TOKEN_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);
  if (onTokenChange) onTokenChange(access_token || null);
}

export async function init({ config, onTokenChange: cb }) {
  _config = config;
  onTokenChange = cb;

  // Drive Picker still uses gapi (no GIS dependency anymore).
  await loadScript(GAPI_SRC);
  await new Promise((resolve) => window.gapi.load("picker", resolve));

  if (isOAuthCallback()) {
    // We're returning from Google's redirect. Exchange the code before
    // boot continues so the rest of the app sees the new tokens.
    await handleOAuthCallback();
  }
}

export function getStoredToken() {
  // AUTH-3 / AUTH-4: stored access token unlocks subsequent loads.
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

// AUTH-2: kicks off the Google sign-in. Navigates to Google; the page
// reloads when Google redirects back with ?code=... .
export function requestToken() {
  const state = randomState();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: _config.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    access_type: "offline",  // requests a refresh token
    prompt: "consent",       // forces consent so we reliably get refresh_token
    include_granted_scopes: "true",
    state,
  });
  window.location.href = `${AUTH_URL}?${params.toString()}`;
  // The page is navigating away; resolve nothing.
  return new Promise(() => {});
}

// AUTH-5 enhancement: silent refresh via the refresh token. No popup, no
// iframe, no GIS — just a JSON POST to our Worker. ITP doesn't apply.
export async function requestTokenSilently() {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    const e = new Error("No refresh token");
    e.kind = "auth";
    throw e;
  }
  const resp = await fetch(`${_config.WORKER_URL}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // Google returns 400 invalid_grant when the refresh token is revoked
    // or expired (e.g. user changed password, granted >6 months ago with
    // no use). Treat that as an auth failure and let the caller route to
    // the Reconnect screen.
    if (resp.status === 400 || resp.status === 401) {
      clearToken();
      const e = new Error(data.error_description || data.error || "Refresh token invalid");
      e.kind = "auth";
      throw e;
    }
    throw new Error(`Token refresh failed: ${data.error_description || data.error || resp.status}`);
  }
  // The refresh response normally omits refresh_token (the old one stays
  // valid). storeTokens just won't overwrite it.
  storeTokens(data);
  return data.access_token;
}

export function clearToken() {
  // AUTH-5 (on auth failure) and AUTH-6 (on user sign-out).
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (onTokenChange) onTokenChange(null);
}

export function pickFile() {
  // Drive Picker — unchanged. The Picker uses the access token directly
  // and binds the drive.file grant to this app's client_id + origin.
  return new Promise((resolve, reject) => {
    const token = getStoredToken();
    if (!token) {
      const e = new Error("No access token; sign in first");
      e.kind = "auth";
      reject(e);
      return;
    }
    const view = new window.google.picker.View(window.google.picker.ViewId.DOCS);
    const appId = String(_config.GOOGLE_CLIENT_ID).split("-")[0];
    const origin = window.location.protocol + "//" + window.location.host;
    const picker = new window.google.picker.PickerBuilder()
      .setAppId(appId)
      .setOAuthToken(token)
      .setDeveloperKey(_config.GOOGLE_API_KEY)
      .setOrigin(origin)
      .addView(view)
      .setTitle("Select your tv-recommendations.json file")
      .setCallback((data) => {
        const action = data[window.google.picker.Response.ACTION];
        if (action === window.google.picker.Action.PICKED) {
          const docs = data[window.google.picker.Response.DOCUMENTS];
          const file = docs && docs[0];
          if (file && file.id) resolve(file.id);
          else reject(new Error("Picker returned no file"));
        } else if (action === window.google.picker.Action.CANCEL) {
          reject(new Error("Picker cancelled"));
        }
      })
      .build();
    picker.setVisible(true);
  });
}
