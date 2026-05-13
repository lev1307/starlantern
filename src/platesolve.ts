// Client for the astrometry.net Nova plate-solver, via a Vercel proxy.
//
// Why a proxy: the public API at https://nova.astrometry.net/api/ does not send
// CORS headers, so a browser cannot call it directly. The proxy at /api/platesolve
// (see api/platesolve.ts) holds the server-side API key, forwards multipart
// uploads, and streams polling results back.
//
// The proxy returns a unified JSON envelope. We only need three operations:
//   POST /api/platesolve/submit  body = multipart image  →  { subid }
//   GET  /api/platesolve/status?subid=N                  →  { state, jobid?, calibration? }
//
// Where calibration is the WCS-decomposed pose:
//   { ra: deg, dec: deg, radius: deg, pixscale: arcsec/px,
//     orientation: deg (image-up angle from north, +CCW), parity: 'pos'|'neg' }
//
// We turn the calibration into a body→world quaternion (camera→ENU at observer time).

import { DEG, equatorialToAltAz, type Observer } from "./coords";
import { fromAxisAngle, multiply, type Quat } from "./quaternion";

export interface Calibration {
  ra: number;
  dec: number;
  radius: number;
  pixscale: number;
  orientation: number;
  parity: "pos" | "neg";
}

export interface SolveResult {
  calibration: Calibration;
  /** Camera optical-axis pose, body→world (ENU), at the moment of capture. */
  qCameraWorld: Quat;
  /** Captured-frame angular size in degrees (long edge). */
  fovDeg: number;
  /** Wall-clock ms at which the capture was taken (echoed from the request). */
  utcMs: number;
}

export interface PlateSolverOpts {
  /** Override the proxy base URL. Defaults to same-origin /api/platesolve. */
  baseUrl?: string;
  /** Optional hint: approximate FOV in degrees, narrows astrometry.net search. */
  fovHintDeg?: number;
  /** Optional hint: approximate RA/Dec at scene centre. */
  centerHint?: { raDeg: number; decDeg: number; radiusDeg: number };
}

interface StatusResponse {
  state: "queued" | "solving" | "success" | "failure";
  jobid?: number;
  calibration?: Calibration;
  message?: string;
}

const cache = new Map<string, SolveResult>();

async function blobHash(blob: Blob): Promise<string> {
  if (typeof crypto?.subtle?.digest !== "function") {
    // Fallback: weak hash on size+slice.
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    return `${blob.size}-${Array.from(head).join("-")}`;
  }
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert an astrometry.net calibration + capture time + observer location
 * into a body→world (camera→ENU) quaternion at the moment of capture.
 *
 * Frame conventions (locked, matches coords.ts):
 *   - World frame: ENU. +X east, +Y up, +Z south.
 *   - Body frame: camera optical-axis along the +look direction, image-up along +y_cam.
 *   - The WCS calibration gives the (RA, Dec) the optical axis points at, plus an
 *     in-plane rotation `orientation` (image-up angle from celestial north, +CCW).
 */
export function calibrationToQuat(
  cal: Calibration,
  observer: Observer,
  utcMs: number,
): Quat {
  // 1. Where is the optical-axis pointing in altaz, at this time/place?
  const altaz = equatorialToAltAz(
    { ra: cal.ra, dec: cal.dec },
    observer,
    new Date(utcMs),
  );
  const az = altaz.azDeg * DEG;
  const alt = altaz.altDeg * DEG;

  // 2. Build a quaternion that rotates the camera's optical axis (+look) to that altaz.
  //    Using yaw-pitch composition:
  //      q_yaw   rotates +look (-Z in three.js convention) to azimuth az around +Y (up).
  //      q_pitch rotates the now-horizontal look-vector to altitude alt around the
  //              east-axis after yawing.
  //    We work in our ENU frame: identity look = -Z (north). +yaw around +Y rotates -Z → +X (east) at +90°.
  const qYaw = fromAxisAngle([0, 1, 0], -az); // -az because we measure az N→E and a +Y rotation maps -Z→+X
  // After yaw, the "east-of-look" axis is the rotated +X. Rotating by +alt around it tilts look upward.
  const eastAfterYaw: [number, number, number] = [
    Math.cos(az),
    0,
    -Math.sin(az),
  ];
  const qPitch = fromAxisAngle(eastAfterYaw, alt);
  // Then in-plane image-up rotation around the line of sight.
  const lookAxis: [number, number, number] = [
    Math.cos(alt) * Math.sin(az),
    Math.sin(alt),
    -Math.cos(alt) * Math.cos(az),
  ];
  const parity = cal.parity === "neg" ? -1 : 1;
  const qRoll = fromAxisAngle(lookAxis, parity * cal.orientation * DEG);

  return multiply(multiply(qRoll, qPitch), qYaw);
}

export class PlateSolver {
  private baseUrl: string;
  private opts: PlateSolverOpts;

  constructor(opts: PlateSolverOpts = {}) {
    this.baseUrl = opts.baseUrl ?? "/api/platesolve";
    this.opts = opts;
  }

  /**
   * Submit a captured image and poll until the solve finishes or fails.
   * Honors a content-hash cache so repeated solves of the same image are free.
   */
  async solve(
    imageBlob: Blob,
    observer: Observer,
    utcMs: number,
    progress?: (state: string) => void,
  ): Promise<SolveResult> {
    const hash = await blobHash(imageBlob);
    const cached = cache.get(hash);
    if (cached) {
      progress?.("cache-hit");
      return cached;
    }

    progress?.("uploading");
    const form = new FormData();
    form.append("image", imageBlob, "capture.jpg");
    if (this.opts.fovHintDeg != null)
      form.append("fovHintDeg", String(this.opts.fovHintDeg));
    if (this.opts.centerHint) {
      form.append("raHint", String(this.opts.centerHint.raDeg));
      form.append("decHint", String(this.opts.centerHint.decDeg));
      form.append("radiusHint", String(this.opts.centerHint.radiusDeg));
    }

    const submitRes = await fetch(`${this.baseUrl}/submit`, {
      method: "POST",
      body: form,
    });
    if (!submitRes.ok) throw new Error(`submit failed: ${submitRes.status}`);
    const { subid } = (await submitRes.json()) as { subid: number };

    // Poll. astrometry.net usually solves in 20–90 seconds.
    const tStart = Date.now();
    const timeoutMs = 5 * 60_000;
    let lastState = "";
    for (;;) {
      if (Date.now() - tStart > timeoutMs)
        throw new Error("plate-solve timed out");
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(`${this.baseUrl}/status?subid=${subid}`);
      if (!statusRes.ok) throw new Error(`status failed: ${statusRes.status}`);
      const status = (await statusRes.json()) as StatusResponse;
      if (status.state !== lastState) {
        lastState = status.state;
        progress?.(status.state);
      }
      if (status.state === "failure") {
        throw new Error(`plate-solve failed: ${status.message ?? "unknown"}`);
      }
      if (status.state === "success" && status.calibration) {
        const cal = status.calibration;
        const qCameraWorld = calibrationToQuat(cal, observer, utcMs);
        // FOV in degrees: pixscale (arcsec/px) × max(w,h) / 3600 — we don't have
        // pixel dims here, so estimate from radius (already half-FOV in deg).
        const fovDeg = cal.radius * 2;
        const result: SolveResult = {
          calibration: cal,
          qCameraWorld,
          fovDeg,
          utcMs,
        };
        cache.set(hash, result);
        return result;
      }
    }
  }
}
