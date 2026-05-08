// AUTH-1, AUTH-2, AUTH-3, AUTH-4, AUTH-5, AUTH-6
//
// Spec deviation (documented in README): scope is drive.file (not drive),
// combined with the Drive Picker. The Picker grants the app drive.file
// access to the single file the user picks; subsequent Drive API calls
// from this client_id can access that file but nothing else.

const TOKEN_KEY = "tvrecs.token"; // AUTH-3
const SCOPE = "https://www.googleapis.com/auth/drive.file"; // AUTH-2 (deviation)
const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";

let tokenClient = null;
let _config = null;
let onTokenChange = null;
let pendingTokenRequest = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.addEventListener("load", () => {
      s.dataset.loaded = "true";
      resolve();
    });
    s.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(s);
  });
}

export async function init({ config, onTokenChange: cb }) {
  _config = config;
  onTokenChange = cb;

  // Use Google Identity Services per the spec note ("Use GIS, not gapi.auth2").
  await loadScript(GIS_SRC);
  // The Drive Picker library lives under gapi; load it too.
  await loadScript(GAPI_SRC);
  await new Promise((resolve) => window.gapi.load("picker", resolve));

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: config.GOOGLE_CLIENT_ID, // AUTH-2
    scope: SCOPE,                       // AUTH-2
    callback: handleTokenResponse,
  });
}

function handleTokenResponse(resp) {
  if (resp.error) {
    if (pendingTokenRequest) {
      pendingTokenRequest.reject(new Error(resp.error_description || resp.error));
      pendingTokenRequest = null;
    }
    return;
  }
  localStorage.setItem(TOKEN_KEY, resp.access_token); // AUTH-3
  if (onTokenChange) onTokenChange(resp.access_token);
  if (pendingTokenRequest) {
    pendingTokenRequest.resolve(resp.access_token);
    pendingTokenRequest = null;
  }
}

export function getStoredToken() {
  // AUTH-4: subsequent loads use the stored token without re-prompting.
  return localStorage.getItem(TOKEN_KEY);
}

export function requestToken() {
  // AUTH-2: triggers the Google OAuth 2.0 flow via GIS.
  return new Promise((resolve, reject) => {
    pendingTokenRequest = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

// AUTH-5 enhancement: silent token refresh.
// The default empty prompt asks GIS to use the user's existing Google session
// to mint a fresh access token without UI. If the user is no longer signed
// into Google (or has revoked the grant), the callback fires with an error
// and the caller falls back to the interactive Reconnect flow.
export function requestTokenSilently() {
  return new Promise((resolve, reject) => {
    if (pendingTokenRequest) {
      reject(new Error("Another token request is already in flight"));
      return;
    }
    pendingTokenRequest = { resolve, reject };
    try {
      tokenClient.requestAccessToken({ prompt: "" });
    } catch (e) {
      pendingTokenRequest = null;
      reject(e);
    }
  });
}

export function clearToken() {
  // AUTH-5 (on auth failure) and AUTH-6 (on user sign-out).
  localStorage.removeItem(TOKEN_KEY);
  if (onTokenChange) onTokenChange(null);
}

export function pickFile() {
  // Drive Picker (deviation from AUTH-2's drive scope fallback). Returns
  // the picked file's ID. The act of picking the file via this app's
  // OAuth token grants the app drive.file access to that file.
  return new Promise((resolve, reject) => {
    const token = getStoredToken();
    if (!token) {
      const e = new Error("No access token; sign in first");
      e.kind = "auth";
      reject(e);
      return;
    }
    const view = new window.google.picker.View(window.google.picker.ViewId.DOCS);
    // No MIME filter — some Drive files report unexpected types (e.g. octet-stream
    // for files uploaded from a desktop client) and would be hidden by a strict
    // application/json filter. The user sees their full Drive and picks the file.
    // App ID is the numeric project number — the prefix of the OAuth client_id.
    // Required for the Picker to bind the drive.file grant to this app.
    const appId = String(_config.GOOGLE_CLIENT_ID).split("-")[0];
    const origin = window.location.protocol + "//" + window.location.host;
    const picker = new window.google.picker.PickerBuilder()
      .setAppId(appId)
      .setOAuthToken(token)
      .setDeveloperKey(_config.GOOGLE_API_KEY)
      .setOrigin(origin) // ties drive.file grant to this origin
      .addView(view)
      .setTitle("Select your tv-recommendations.json file")
      .setCallback((data) => {
        const action = data[window.google.picker.Response.ACTION];
        if (action === window.google.picker.Action.PICKED) {
          const docs = data[window.google.picker.Response.DOCUMENTS];
          const file = docs && docs[0];
          if (file && file.id) {
            resolve(file.id);
          } else {
            reject(new Error("Picker returned no file"));
          }
        } else if (action === window.google.picker.Action.CANCEL) {
          reject(new Error("Picker cancelled"));
        }
      })
      .build();
    picker.setVisible(true);
  });
}
