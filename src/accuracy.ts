// Pointing-accuracy readout — the product's central claim, made visible.
//
// Every mainstream sky app drifts 5–20° on magnetometer noise and shows the user
// nothing. This one plate-solves, fuses through an EKF, and states its own
// pointing uncertainty live. That readout is both the honest disclosure and the
// demo: a label that stays pinned at arcminutes while a compass-only app slides.
//
// Two different numbers live here, and they must not be confused:
//
//   PREDICTED uncertainty — the EKF's own 1-σ attitude covariance, available
//   every frame. Grows between plate-solves as gyro noise integrates. This is
//   what the badge shows continuously.
//
//   MEASURED drift — the angular correction the next plate-solve actually
//   applies (the EKF innovation), divided by the time since the previous solve.
//   Only available at solve instants, and it is the number worth quoting in a
//   launch post, because it is ground truth rather than the filter's self-report.
//
// A filter that is overconfident reports a small σ while accumulating real
// error; comparing the two is how we catch that. Keep them separate.

const DEG_PER_RAD = 180 / Math.PI;
const ARCMIN_PER_RAD = DEG_PER_RAD * 60;

/** σ at or below this (degrees) counts as a hard lock. Matches the auto-relock trigger. */
export const LOCKED_MAX_DEG = 0.1;
/** Above this (degrees) we are no better than a bare compass and say so. */
export const DRIFTING_MAX_DEG = 1.0;

export type LockState = "idle" | "solving" | "locked" | "drifting" | "lost";

export interface AccuracyInput {
  /** A plate-solve is in flight right now. */
  solving: boolean;
  /** A plate-solve has succeeded and the EKF is driving the camera. */
  hasFix: boolean;
  /** EKF total attitude 1-σ in radians, or null when the EKF isn't running. */
  sigmaRad: number | null;
  /** Seconds since the last successful solve, or null if there has never been one. */
  secsSinceSolve: number | null;
  /** Measured drift rate in °/min from the last re-solve, or null if unknown. */
  measuredDriftDegPerMin: number | null;
}

export interface AccuracyReadout {
  state: LockState;
  /** Short all-caps state word for the badge. */
  label: string;
  /** Primary number, pre-formatted with its unit. */
  value: string;
  /** Secondary line: age of the fix and measured drift when known. */
  detail: string;
}

/**
 * Format an angle at the precision a human can act on: arcminutes while we are
 * in the regime the product claims, degrees once we have left it. Sub-arcminute
 * values keep one decimal so a fresh lock reads "0.2′" rather than a flat "0′".
 */
export function formatAngle(rad: number): string {
  if (!Number.isFinite(rad) || rad < 0) return "—";
  const deg = rad * DEG_PER_RAD;
  if (deg < 1) {
    const arcmin = rad * ARCMIN_PER_RAD;
    return `${arcmin < 10 ? arcmin.toFixed(1) : arcmin.toFixed(0)}′`;
  }
  return `${deg < 10 ? deg.toFixed(2) : deg.toFixed(1)}°`;
}

/** Classify pointing quality from the EKF's own 1-σ. */
export function classify(input: AccuracyInput): LockState {
  if (input.solving) return "solving";
  if (!input.hasFix || input.sigmaRad == null) return "idle";
  const deg = input.sigmaRad * DEG_PER_RAD;
  if (deg <= LOCKED_MAX_DEG) return "locked";
  if (deg <= DRIFTING_MAX_DEG) return "drifting";
  return "lost";
}

function formatAge(secs: number): string {
  if (secs < 60) return `${Math.floor(secs)} s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h`;
}

/** Build the full badge readout from current state. Pure — trivially testable. */
export function readout(input: AccuracyInput): AccuracyReadout {
  const state = classify(input);

  if (state === "solving") {
    return { state, label: "SOLVING", value: "…", detail: "plate-solving now" };
  }
  if (state === "idle") {
    return {
      state,
      label: "NO LOCK",
      value: "—",
      detail: "compass only — tap Lock to sky",
    };
  }

  const value = formatAngle(input.sigmaRad!);
  const parts: string[] = [];
  if (input.secsSinceSolve != null) {
    parts.push(`fix ${formatAge(input.secsSinceSolve)} ago`);
  }
  if (input.measuredDriftDegPerMin != null) {
    parts.push(`${input.measuredDriftDegPerMin.toFixed(2)}°/min measured`);
  }

  const label =
    state === "locked" ? "LOCKED" : state === "drifting" ? "DRIFTING" : "LOST";
  return { state, label, value, detail: parts.join(" · ") || "—" };
}

/**
 * Tracks the four numbers that constitute "it works": time-to-first-lock,
 * measured drift between solves, solve count and success rate.
 *
 * Measured drift uses the EKF innovation at each re-solve — how far the filter
 * had actually wandered since the previous fix — so it is independent of the
 * filter's own confidence.
 */
export class AccuracyStats {
  private firstAttemptMs: number | null = null;
  private firstLockMs: number | null = null;
  private lastSolveMs: number | null = null;
  private attempts = 0;
  private successes = 0;
  private driftSamples: number[] = [];

  /** Call when a solve attempt begins. */
  noteAttempt(tMs: number): void {
    this.attempts += 1;
    if (this.firstAttemptMs == null) this.firstAttemptMs = tMs;
  }

  /**
   * Call on a successful solve. innovationRad is the angular correction the
   * filter applied; it is only meaningful as drift if a previous fix existed.
   */
  noteSuccess(tMs: number, innovationRad: number | null): void {
    this.successes += 1;
    if (this.firstLockMs == null) this.firstLockMs = tMs;
    if (this.lastSolveMs != null && innovationRad != null) {
      const mins = (tMs - this.lastSolveMs) / 60_000;
      // Ignore near-instant re-solves; dividing by a tiny interval explodes.
      if (mins > 1 / 60) {
        this.driftSamples.push((innovationRad * DEG_PER_RAD) / mins);
        if (this.driftSamples.length > 20) this.driftSamples.shift();
      }
    }
    this.lastSolveMs = tMs;
  }

  /** Seconds from the first solve attempt to the first successful lock. */
  timeToFirstLockSec(): number | null {
    if (this.firstAttemptMs == null || this.firstLockMs == null) return null;
    return (this.firstLockMs - this.firstAttemptMs) / 1000;
  }

  /** Median measured drift in °/min across re-solves, or null before the second solve. */
  medianDriftDegPerMin(): number | null {
    if (this.driftSamples.length === 0) return null;
    const s = [...this.driftSamples].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  }

  /** Most recent measured drift in °/min, or null before the second solve. */
  lastDriftDegPerMin(): number | null {
    return this.driftSamples.length ? this.driftSamples.at(-1)! : null;
  }

  secsSinceSolve(nowMs: number): number | null {
    return this.lastSolveMs == null ? null : (nowMs - this.lastSolveMs) / 1000;
  }

  successRate(): number | null {
    return this.attempts === 0 ? null : this.successes / this.attempts;
  }

  get solveCount(): number {
    return this.successes;
  }

  /** Snapshot for telemetry and for quoting in the launch post. */
  summary(): {
    attempts: number;
    successes: number;
    successRate: number | null;
    timeToFirstLockSec: number | null;
    medianDriftDegPerMin: number | null;
  } {
    return {
      attempts: this.attempts,
      successes: this.successes,
      successRate: this.successRate(),
      timeToFirstLockSec: this.timeToFirstLockSec(),
      medianDriftDegPerMin: this.medianDriftDegPerMin(),
    };
  }
}
