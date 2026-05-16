// Cloudflare Worker: holds the Google OAuth client_secret and proxies the two
// token-endpoint calls the browser can't make directly (authorization-code
// exchange and refresh-token exchange). Everything else (Drive API reads,
// Drive Picker, etc.) is browser → Google directly with a Bearer token.
//
// Endpoints:
//   POST /exchange  { code, redirect_uri } -> Google's full token response JSON
//   POST /refresh   { refresh_token }      -> Google's full token response JSON
//
// Secrets/vars (set via wrangler):
//   GOOGLE_CLIENT_ID      — public, but kept server-side for convenience
//   GOOGLE_CLIENT_SECRET  — wrangler secret put GOOGLE_CLIENT_SECRET
//   ALLOWED_ORIGINS       — JSON array string, e.g. '["https://x.github.io","http://localhost:8000"]'

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const cors = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, cors);
    }
    if (!allowed.has(origin)) {
      return json({ error: "origin_not_allowed" }, 403, cors);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/exchange") return await exchange(request, env, cors);
      if (url.pathname === "/refresh")  return await refresh(request, env, cors);
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      return json({ error: "internal", message: e.message }, 500, cors);
    }
  },
};

async function exchange(request, env, cors) {
  const body = await request.json();
  if (!body.code || !body.redirect_uri) {
    return json({ error: "invalid_request", message: "code and redirect_uri are required" }, 400, cors);
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code: body.code,
    redirect_uri: body.redirect_uri,
    grant_type: "authorization_code",
  });
  return await proxyToGoogle(params, cors);
}

async function refresh(request, env, cors) {
  const body = await request.json();
  if (!body.refresh_token) {
    return json({ error: "invalid_request", message: "refresh_token is required" }, 400, cors);
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: body.refresh_token,
    grant_type: "refresh_token",
  });
  return await proxyToGoogle(params, cors);
}

async function proxyToGoogle(params, cors) {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function parseAllowedOrigins(raw) {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function corsHeaders(origin, allowed) {
  if (!allowed.has(origin)) {
    return { "Vary": "Origin" };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
