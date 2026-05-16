# tv-recs OAuth Worker

Cloudflare Worker that holds the Google OAuth `client_secret` and proxies the two token-endpoint calls the browser can't make directly:

- `POST /exchange` — authorization-code → access_token + refresh_token
- `POST /refresh` — refresh_token → new access_token

Everything else (Drive reads/writes, Drive Picker, sign-in redirect) happens browser ↔ Google directly with a Bearer token. The Worker is only on the auth path.

## Deploy

One-time setup:

```sh
# 1. Sign up at cloudflare.com (free, no card required).
# 2. Install wrangler:
npm install -g wrangler        # or: bun install -g wrangler

# 3. Authenticate (opens a browser tab):
wrangler login

# 4. Set the client_secret as a wrangler secret (not in wrangler.toml):
cd code/worker
wrangler secret put GOOGLE_CLIENT_SECRET
# Paste the client_secret from Google Cloud Console → Credentials → "TV Recs Web"
# (the field next to Client ID; click "Show secret" if hidden).

# 5. Deploy:
wrangler deploy
# Wrangler prints the deployed URL, e.g.:
#   https://tv-recs-oauth.<your-subdomain>.workers.dev
```

Copy that URL — it's the `WORKER_URL` value for `code/config.js`.

## Updating

Edit `src/worker.js`, then re-run `wrangler deploy`. No GitHub push step.

## Adding/removing allowed origins

Edit `ALLOWED_ORIGINS` in `wrangler.toml`, then `wrangler deploy`. The array is JSON-encoded as a string because Cloudflare Workers vars are strings.
