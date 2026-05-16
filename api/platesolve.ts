// Vercel serverless function — proxy to nova.astrometry.net.
//
// Browsers can't call nova.astrometry.net directly (no CORS). This proxy:
//   - holds ASTROMETRY_API_KEY (server-side env var, never sent to clients)
//   - manages session login + caches it ~30 min
//   - per-IP token-bucket rate limit so a leaked URL can't drain the API key
//   - structured JSON logs (one line per request, parseable by Vercel/Logflare)
//   - exposes two routes via the catch-all path:
//       POST /api/platesolve/submit   (multipart image) → { subid }
//       GET  /api/platesolve/status?subid=N             → { state, jobid?, calibration? }
//
// Deploy: set ASTROMETRY_API_KEY in the Vercel project's environment variables
// (Settings → Environment Variables). Free key from nova.astrometry.net/api_help.
//
// NOTE: this runs in Vercel's Edge-compatible Node runtime. Buffer + fetch are
// both available. We use fetch's native multipart support via FormData.
//
// Rate limit note: the bucket lives in module-scope memory, which is per-instance.
// Vercel may spin up multiple instances under load, so the *effective* limit is
// (RATE_PER_MIN × instance_count). Good enough for v1; move to Upstash Redis if
// you need a true global limit.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://nova.astrometry.net/api";
const KEY = process.env["ASTROMETRY_API_KEY"];

// --- Rate limit (per-IP token bucket) ------------------------------------
const RATE_PER_MIN = Number(process.env["PLATESOLVE_RATE_PER_MIN"] ?? 10);
const BUCKET_CAP = RATE_PER_MIN; // burst = sustained
const REFILL_PER_MS = RATE_PER_MIN / 60_000;
interface Bucket {
  tokens: number;
  last: number;
}
const buckets = new Map<string, Bucket>();

function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0]!.trim();
  if (Array.isArray(xff)) return xff[0]!.split(",")[0]!.trim();
  return (req.socket?.remoteAddress as string) || "unknown";
}

function rateLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: BUCKET_CAP, last: now };
    buckets.set(ip, b);
  }
  // Refill
  b.tokens = Math.min(BUCKET_CAP, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;
  if (b.tokens < 1) return { ok: false, remaining: 0 };
  b.tokens -= 1;
  return { ok: true, remaining: Math.floor(b.tokens) };
}

// Periodically forget stale buckets so the map doesn't grow forever.
// Module-scope timers in Vercel get cleaned up when the instance shuts down.
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      const cutoff = Date.now() - 10 * 60_000;
      for (const [ip, b] of buckets) if (b.last < cutoff) buckets.delete(ip);
    },
    5 * 60_000,
  );
}

// --- Structured logging ---------------------------------------------------
type LogFields = Record<string, string | number | boolean | null>;
function log(level: "info" | "warn" | "error", event: string, f: LogFields) {
  // JSON one-line — readable in Vercel logs, parseable by Logflare/Datadog/etc.
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...f,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

// --- Session cache --------------------------------------------------------
interface CachedSession {
  session: string;
  expires: number;
}
let sessionCache: CachedSession | null = null;

async function getSession(): Promise<string> {
  if (sessionCache && sessionCache.expires > Date.now())
    return sessionCache.session;
  if (!KEY) throw new Error("ASTROMETRY_API_KEY not configured on server");
  const body = new URLSearchParams();
  body.set("request-json", JSON.stringify({ apikey: KEY }));
  const r = await fetch(`${API_BASE}/login`, { method: "POST", body });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  const j = (await r.json()) as { status: string; session?: string };
  if (j.status !== "success" || !j.session) {
    throw new Error(`login rejected: ${JSON.stringify(j)}`);
  }
  sessionCache = { session: j.session, expires: Date.now() + 25 * 60_000 };
  log("info", "session.refresh", { expires_in_ms: 25 * 60_000 });
  return j.session;
}

async function submit(
  req: VercelRequest,
  res: VercelResponse,
  ip: string,
): Promise<void> {
  const t0 = Date.now();
  const session = await getSession();
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);

  const upload = new FormData();
  upload.set(
    "request-json",
    JSON.stringify({
      session,
      allow_commercial_use: "d",
      allow_modifications: "d",
      publicly_visible: "n",
      scale_units: "degwidth",
      scale_type: "ul",
      scale_lower: 1,
      scale_upper: 90,
      parity: 2,
    }),
  );
  upload.set("file", new Blob([raw], { type: "image/jpeg" }), "capture.jpg");
  const r = await fetch(`${API_BASE}/upload`, { method: "POST", body: upload });
  if (!r.ok) {
    log("error", "submit.upload_failed", {
      ip,
      status: r.status,
      bytes: raw.length,
      ms: Date.now() - t0,
    });
    res.status(502).json({ error: `astrometry upload failed: ${r.status}` });
    return;
  }
  const j = (await r.json()) as {
    status: string;
    subid?: number;
    errormessage?: string;
  };
  if (j.status !== "success" || j.subid == null) {
    log("warn", "submit.rejected", {
      ip,
      reason: j.errormessage ?? "unknown",
      ms: Date.now() - t0,
    });
    res
      .status(502)
      .json({
        error: `astrometry upload rejected: ${j.errormessage ?? "unknown"}`,
      });
    return;
  }
  log("info", "submit.ok", {
    ip,
    subid: j.subid,
    bytes: raw.length,
    ms: Date.now() - t0,
  });
  res.status(200).json({ subid: j.subid });
}

async function status(
  req: VercelRequest,
  res: VercelResponse,
  ip: string,
): Promise<void> {
  const t0 = Date.now();
  const subid = req.query["subid"];
  if (!subid || Array.isArray(subid)) {
    res.status(400).json({ error: "subid required" });
    return;
  }

  const subResp = await fetch(`${API_BASE}/submissions/${subid}`);
  if (!subResp.ok) {
    log("error", "status.submission_lookup_failed", {
      ip,
      subid: String(subid),
      status: subResp.status,
    });
    res
      .status(502)
      .json({ error: `submission lookup failed: ${subResp.status}` });
    return;
  }
  const sub = (await subResp.json()) as {
    jobs?: (number | null)[];
    processing_finished?: string;
  };
  const jobid = sub.jobs?.find((id): id is number => id != null);
  if (jobid == null) {
    res.status(200).json({ state: "queued" });
    return;
  }

  const jobResp = await fetch(`${API_BASE}/jobs/${jobid}`);
  if (!jobResp.ok) {
    log("error", "status.job_lookup_failed", {
      ip,
      jobid,
      status: jobResp.status,
    });
    res.status(502).json({ error: `job lookup failed: ${jobResp.status}` });
    return;
  }
  const job = (await jobResp.json()) as {
    status: "solving" | "success" | "failure";
  };

  if (job.status === "solving") {
    res.status(200).json({ state: "solving", jobid });
    return;
  }
  if (job.status === "failure") {
    log("info", "status.failure", { ip, jobid, ms: Date.now() - t0 });
    res
      .status(200)
      .json({
        state: "failure",
        jobid,
        message: "astrometry.net could not solve this image",
      });
    return;
  }

  // success — fetch calibration
  const calResp = await fetch(`${API_BASE}/jobs/${jobid}/calibration`);
  if (!calResp.ok) {
    log("error", "status.calibration_failed", {
      ip,
      jobid,
      status: calResp.status,
    });
    res
      .status(502)
      .json({ error: `calibration fetch failed: ${calResp.status}` });
    return;
  }
  const cal = await calResp.json();
  log("info", "status.success", { ip, jobid, ms: Date.now() - t0 });
  res.status(200).json({ state: "success", jobid, calibration: cal });
}

// Vercel single-file routing: the path after /api/platesolve is in req.url's tail.
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const ip = clientIp(req);
  const url = req.url ?? "";

  // Rate-limit only mutating routes; status polls happen rapidly and should not
  // count against the cap.
  if (req.method === "POST" && url.includes("/submit")) {
    const rl = rateLimit(ip);
    res.setHeader("X-RateLimit-Limit", String(RATE_PER_MIN));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    if (!rl.ok) {
      log("warn", "rate_limited", { ip, route: "submit" });
      res.status(429).json({
        error: "rate limit exceeded",
        retry_after_seconds: Math.ceil(60 / RATE_PER_MIN),
      });
      return;
    }
  }

  try {
    if (req.method === "POST" && url.includes("/submit"))
      return submit(req, res, ip);
    if (req.method === "GET" && url.includes("/status"))
      return status(req, res, ip);
    res.status(404).json({ error: "route not found" });
  } catch (err) {
    log("error", "handler_exception", {
      ip,
      url,
      method: req.method ?? "unknown",
      message: err instanceof Error ? err.message : String(err),
    });
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
}

export const config = {
  api: { bodyParser: false }, // we read raw body for multipart forwarding
};
