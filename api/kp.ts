// Vercel serverless function — proxy to NOAA SWPC for the current Kp index.
//
// NOAA's space-weather endpoint doesn't ship a CORS header, so the frontend
// can't hit it directly. This proxy fetches the 1-minute planetary K index
// feed, returns the most recent observation, and adds an aggressive cache
// header so we don't hammer NOAA. Kp only changes on a 3-hour cadence so
// 10-minute caching is more than fine.
//
// Response shape:
//   { kp: number, observedAt: string, source: "noaa-swpc" }
//
// Use case: iter 9 aurora bands are driven by a Kp value. Without a live feed
// the renderer defaults Kp=3 and the founder twiddles a slider. With this
// route, /api/kp gives the actual current Kp so the aurora model matches
// what's happening right now in the geomagnetic field.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const NOAA_FEED = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";

interface NoaaRow {
  time_tag: string;
  kp_index: number;
  estimated_kp: number;
  kp: string;
}

interface KpResponse {
  kp: number;
  observedAt: string;
  source: string;
}

let cache: { value: KpResponse; expires: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  // Serve cached if fresh.
  if (cache && cache.expires > Date.now()) {
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
    res.status(200).json(cache.value);
    return;
  }

  try {
    const resp = await fetch(NOAA_FEED);
    if (!resp.ok) {
      res.status(502).json({ error: `NOAA feed status ${resp.status}` });
      return;
    }
    const rows = (await resp.json()) as NoaaRow[];
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(502).json({ error: "Empty NOAA feed response" });
      return;
    }
    // Most-recent observation is the last row.
    const latest = rows[rows.length - 1]!;
    const kp = typeof latest.kp_index === "number"
      ? latest.kp_index
      : typeof latest.estimated_kp === "number"
        ? latest.estimated_kp
        : parseFloat(latest.kp ?? "0");
    const value: KpResponse = {
      kp: Number.isFinite(kp) ? Math.max(0, Math.min(9, kp)) : 0,
      observedAt: latest.time_tag,
      source: "noaa-swpc",
    };
    cache = { value, expires: Date.now() + CACHE_TTL_MS };
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
    res.status(200).json(value);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "unknown fetch error",
    });
  }
}
