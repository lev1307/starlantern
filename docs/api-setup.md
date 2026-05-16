# API key setup

The plate-solve "Lock to sky" button needs an [astrometry.net Nova](https://nova.astrometry.net/api_help) free API key. Without it, every other feature still works (stars, planets, moon, ISS, meteors, DSOs, aurora, twilight) — only the camera-driven sky lock fails.

## One-time setup (~10 minutes)

1. **Sign up at [nova.astrometry.net](https://nova.astrometry.net/)** — free account, no credit card.
2. **Copy your API key** from [nova.astrometry.net/api_help](https://nova.astrometry.net/api_help). It's a 16-character string under "API Key".
3. **Open the Vercel project dashboard** → `Settings` → `Environment Variables`.
4. **Add a new variable:**
   - Name: `ASTROMETRY_API_KEY`
   - Value: *(paste your key)*
   - Environments: check **Production**, **Preview**, and **Development**
5. **Redeploy** — either push any commit, or in the Vercel dashboard click `Deployments` → latest deployment → `…` → `Redeploy`.

## Verifying

After redeploy, click `Lock to sky (plate-solve)` in the app:

- Without the key: HUD shows `plate-solve unavailable — astrometry.net API key not configured on the server`.
- With the key: HUD shows `opening camera…` → `capturing (stacking 8 frames)…` → `uploading…` → `solving…` → `LOCKED — RA …°, Dec …°` (typically 30-90 seconds for a clear-sky shot).

## Why we proxy through Vercel

Browsers can't call nova.astrometry.net directly (no CORS headers). Our `api/platesolve.ts` Vercel serverless function:

- Holds the key server-side (never sent to clients)
- Manages the astrometry.net session token (cached ~30 min)
- Forwards multipart image uploads
- Polls for solve status

See [`api/platesolve.ts`](../api/platesolve.ts) for the implementation.

## Free-tier limits

The free Nova key allows ~25 solves per minute and unlimited per day. Plenty for personal use; if traffic ever exceeds that we'd switch to a paid tier or self-hosted index files (port deferred — see backlog).
