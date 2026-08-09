import { describe, it, expect } from "vitest";
import {
  AccuracyStats,
  classify,
  formatAngle,
  readout,
  LOCKED_MAX_DEG,
  DRIFTING_MAX_DEG,
} from "../src/accuracy";

const DEG = Math.PI / 180;
const ARCMIN = DEG / 60;

describe("formatAngle", () => {
  it("shows arcminutes below one degree", () => {
    expect(formatAngle(0.2 * ARCMIN)).toBe("0.2′");
    expect(formatAngle(5 * ARCMIN)).toBe("5.0′");
  });

  it("drops the decimal for large arcminute values", () => {
    expect(formatAngle(30 * ARCMIN)).toBe("30′");
  });

  it("switches to degrees at and above one degree", () => {
    expect(formatAngle(1.5 * DEG)).toBe("1.50°");
    expect(formatAngle(12 * DEG)).toBe("12.0°");
  });

  it("returns a placeholder for nonsense input", () => {
    expect(formatAngle(NaN)).toBe("—");
    expect(formatAngle(-1)).toBe("—");
  });

  it("is continuous across the degree boundary", () => {
    // Just under 1° reads in arcmin, just over reads in degrees — no gap.
    expect(formatAngle(0.999 * DEG)).toBe("60′");
    expect(formatAngle(1.001 * DEG)).toBe("1.00°");
  });
});

describe("classify", () => {
  const base = {
    solving: false,
    hasFix: true,
    sigmaRad: 0.05 * DEG,
    secsSinceSolve: 10,
    measuredDriftDegPerMin: null,
  };

  it("reports solving while a plate-solve is in flight", () => {
    expect(classify({ ...base, solving: true })).toBe("solving");
  });

  it("reports idle with no fix", () => {
    expect(classify({ ...base, hasFix: false })).toBe("idle");
    expect(classify({ ...base, sigmaRad: null })).toBe("idle");
  });

  it("reports locked inside the claimed regime", () => {
    expect(classify({ ...base, sigmaRad: 0.5 * ARCMIN })).toBe("locked");
    expect(classify({ ...base, sigmaRad: LOCKED_MAX_DEG * DEG })).toBe(
      "locked",
    );
  });

  it("reports drifting between the lock and lost thresholds", () => {
    expect(classify({ ...base, sigmaRad: 0.5 * DEG })).toBe("drifting");
    expect(classify({ ...base, sigmaRad: DRIFTING_MAX_DEG * DEG })).toBe(
      "drifting",
    );
  });

  it("reports lost once we are no better than a compass", () => {
    // The competitor regime the product exists to beat: 5–20°.
    expect(classify({ ...base, sigmaRad: 5 * DEG })).toBe("lost");
  });
});

describe("readout", () => {
  it("tells an unlocked user what to do", () => {
    const r = readout({
      solving: false,
      hasFix: false,
      sigmaRad: null,
      secsSinceSolve: null,
      measuredDriftDegPerMin: null,
    });
    expect(r.state).toBe("idle");
    expect(r.label).toBe("NO LOCK");
    expect(r.detail).toMatch(/Lock to sky/);
  });

  it("surfaces fix age and measured drift when locked", () => {
    const r = readout({
      solving: false,
      hasFix: true,
      sigmaRad: 0.3 * ARCMIN,
      secsSinceSolve: 42,
      measuredDriftDegPerMin: 0.031,
    });
    expect(r.label).toBe("LOCKED");
    expect(r.value).toBe("0.3′");
    expect(r.detail).toContain("42 s ago");
    expect(r.detail).toContain("0.03°/min");
  });

  it("renders fix age in minutes and hours as it grows", () => {
    const at = (secs: number) =>
      readout({
        solving: false,
        hasFix: true,
        sigmaRad: 0.5 * DEG,
        secsSinceSolve: secs,
        measuredDriftDegPerMin: null,
      }).detail;
    expect(at(90)).toContain("1 min");
    expect(at(7200)).toContain("2 h");
  });
});

describe("AccuracyStats", () => {
  it("measures time to first lock from the first attempt", () => {
    const s = new AccuracyStats();
    expect(s.timeToFirstLockSec()).toBeNull();
    s.noteAttempt(1_000);
    s.noteSuccess(19_000, null);
    expect(s.timeToFirstLockSec()).toBeCloseTo(18, 6);
  });

  it("does not report drift until a second solve exists", () => {
    const s = new AccuracyStats();
    s.noteAttempt(0);
    s.noteSuccess(0, null);
    expect(s.lastDriftDegPerMin()).toBeNull();
    expect(s.medianDriftDegPerMin()).toBeNull();
  });

  it("derives drift rate from the innovation and the interval", () => {
    const s = new AccuracyStats();
    s.noteAttempt(0);
    s.noteSuccess(0, null);
    // Two minutes later the next fix corrects by 0.1° → 0.05°/min.
    s.noteAttempt(120_000);
    s.noteSuccess(120_000, 0.1 * DEG);
    expect(s.lastDriftDegPerMin()).toBeCloseTo(0.05, 6);
  });

  it("ignores near-instant re-solves that would explode the rate", () => {
    const s = new AccuracyStats();
    s.noteSuccess(0, null);
    s.noteSuccess(100, 0.1 * DEG); // 100 ms later
    expect(s.lastDriftDegPerMin()).toBeNull();
  });

  it("takes the median across re-solves so one bad fix cannot dominate", () => {
    const s = new AccuracyStats();
    s.noteSuccess(0, null);
    // 0.1, 0.2 and a 5°/min outlier, each one minute apart.
    s.noteSuccess(60_000, 0.1 * DEG);
    s.noteSuccess(120_000, 0.2 * DEG);
    s.noteSuccess(180_000, 5 * DEG);
    expect(s.medianDriftDegPerMin()).toBeCloseTo(0.2, 6);
  });

  it("tracks solve success rate across failed attempts", () => {
    const s = new AccuracyStats();
    s.noteAttempt(0);
    s.noteAttempt(1000);
    s.noteAttempt(2000);
    s.noteSuccess(2000, null);
    expect(s.successRate()).toBeCloseTo(1 / 3, 6);
    expect(s.solveCount).toBe(1);
  });

  it("caps the drift-sample window so old fixes age out", () => {
    const s = new AccuracyStats();
    s.noteSuccess(0, null);
    // 25 samples at 1°/min, then 20 at 0.1°/min — the window holds 20, so the
    // median must reflect only the recent, better ones.
    for (let i = 1; i <= 25; i++) s.noteSuccess(i * 60_000, 1 * DEG);
    for (let i = 26; i <= 45; i++) s.noteSuccess(i * 60_000, 0.1 * DEG);
    expect(s.medianDriftDegPerMin()).toBeCloseTo(0.1, 6);
  });

  it("summarises the numbers the launch post quotes", () => {
    const s = new AccuracyStats();
    s.noteAttempt(0);
    s.noteSuccess(5_000, null);
    s.noteAttempt(65_000);
    s.noteSuccess(65_000, 0.05 * DEG);
    const summary = s.summary();
    expect(summary.attempts).toBe(2);
    expect(summary.successes).toBe(2);
    expect(summary.successRate).toBe(1);
    expect(summary.timeToFirstLockSec).toBeCloseTo(5, 6);
    expect(summary.medianDriftDegPerMin).toBeCloseTo(0.05, 6);
  });
});
