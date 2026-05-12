// Vercel serverless function — proxy to nova.astrometry.net.
//
// Browsers can't call nova.astrometry.net directly (no CORS). This proxy:
//   - holds ASTROMETRY_API_KEY (server-side env var, never sent to clients)
//   - manages session login + caches it ~30 min
//   - exposes two routes via the catch-all path:
//       POST /api/platesolve/submit   (multipart image) → { subid }
//       GET  /api/platesolve/status?subid=N             → { state, jobid?, calibration? }
//
// Deploy: set ASTROMETRY_API_KEY in the Vercel project's environment variables
// (Settings → Environment Variables). Free key from nova.astrometry.net/api_help.
//
// NOTE: this runs in Vercel's Edge-compatible Node runtime. Buffer + fetch are
// both available. We use fetch's native multipart support via FormData.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://nova.astrometry.net/api";
const KEY = process.env["ASTROMETRY_API_KEY"];

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
  return j.session;
}

async function submit(req: VercelRequest, res: VercelResponse): Promise<void> {
  const session = await getSession();
  // The body is multipart from the browser. We need to repackage it with astrometry's
  // own multipart layout: { request-json: "...", file: <image bytes> }.
  // Vercel exposes the raw body via req on the Node runtime when bodyParser disabled,
  // but multipart parsing is non-trivial. Easiest path: re-read the incoming buffer.
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);

  // The proxy strips off the client's multipart and forwards just the file bytes.
  // For simplicity we treat the entire raw body as the image (the client builds a
  // single-part form). Extracting the file from multipart parsing is left to a
  // proper Vercel multipart adapter when we add hints/extra fields.
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
    res.status(502).json({ error: `astrometry upload failed: ${r.status}` });
    return;
  }
  const j = (await r.json()) as {
    status: string;
    subid?: number;
    errormessage?: string;
  };
  if (j.status !== "success" || j.subid == null) {
    res
      .status(502)
      .json({
        error: `astrometry upload rejected: ${j.errormessage ?? "unknown"}`,
      });
    return;
  }
  res.status(200).json({ subid: j.subid });
}

async function status(req: VercelRequest, res: VercelResponse): Promise<void> {
  const subid = req.query["subid"];
  if (!subid || Array.isArray(subid)) {
    res.status(400).json({ error: "subid required" });
    return;
  }

  const subResp = await fetch(`${API_BASE}/submissions/${subid}`);
  if (!subResp.ok) {
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
    res
      .status(502)
      .json({ error: `calibration fetch failed: ${calResp.status}` });
    return;
  }
  const cal = await calResp.json();
  res.status(200).json({ state: "success", jobid, calibration: cal });
}

// Vercel single-file routing: the path after /api/platesolve is in req.url's tail.
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    const url = req.url ?? "";
    if (req.method === "POST" && url.includes("/submit"))
      return submit(req, res);
    if (req.method === "GET" && url.includes("/status"))
      return status(req, res);
    res.status(404).json({ error: "route not found" });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
}

export const config = {
  api: { bodyParser: false }, // we read raw body for multipart forwarding
};
