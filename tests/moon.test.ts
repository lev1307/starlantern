import { describe, it, expect } from "vitest";
import { moonPosition, sunPosition } from "../src/moon";

describe("sunPosition (Meeus low-precision)", () => {
  it("returns RA in [0, 360) and Dec in [-23.5, 23.5]", () => {
    const sun = sunPosition(new Date(Date.UTC(2024, 5, 15, 12)));
    expect(sun.raDeg).toBeGreaterThanOrEqual(0);
    expect(sun.raDeg).toBeLessThan(360);
    expect(sun.decDeg).toBeGreaterThan(-24);
    expect(sun.decDeg).toBeLessThan(24);
  });

  it("summer solstice 2024-06-20 ≈ Dec +23.4°", () => {
    const sun = sunPosition(new Date(Date.UTC(2024, 5, 20, 20, 51)));
    expect(sun.decDeg).toBeGreaterThan(23.0);
    expect(sun.decDeg).toBeLessThan(23.6);
  });

  it("winter solstice 2024-12-21 ≈ Dec -23.4°", () => {
    const sun = sunPosition(new Date(Date.UTC(2024, 11, 21, 9, 21)));
    expect(sun.decDeg).toBeLessThan(-23.0);
    expect(sun.decDeg).toBeGreaterThan(-23.6);
  });

  it("Earth-Sun distance is ≈ 1 AU year-round (varies by ±2%)", () => {
    for (const day of [10, 100, 200, 300]) {
      const sun = sunPosition(new Date(Date.UTC(2024, 0, day)));
      expect(sun.distanceAu).toBeGreaterThan(0.98);
      expect(sun.distanceAu).toBeLessThan(1.02);
    }
  });
});

describe("moonPosition (Meeus low-precision)", () => {
  it("returns valid RA / Dec / distance / diameter / illumination", () => {
    const m = moonPosition(new Date(Date.UTC(2024, 5, 15, 0)));
    expect(m.raDeg).toBeGreaterThanOrEqual(0);
    expect(m.raDeg).toBeLessThan(360);
    expect(m.decDeg).toBeGreaterThan(-90);
    expect(m.decDeg).toBeLessThan(90);
    expect(m.distanceKm).toBeGreaterThan(300_000);
    expect(m.distanceKm).toBeLessThan(450_000);
    expect(m.diameterDeg).toBeGreaterThan(0.4);
    expect(m.diameterDeg).toBeLessThan(0.7);
    expect(m.illumination).toBeGreaterThanOrEqual(0);
    expect(m.illumination).toBeLessThanOrEqual(1);
  });

  it("average daily RA motion over a sidereal month ≈ 13.18°/day", () => {
    // Mean is robust; instantaneous can be 8–17°/day depending on orbit geometry.
    let cumulative = 0;
    for (let d = 0; d < 27; d++) {
      const a = moonPosition(new Date(Date.UTC(2024, 0, 1 + d))).raDeg;
      const b = moonPosition(new Date(Date.UTC(2024, 0, 2 + d))).raDeg;
      let dRa = b - a;
      if (dRa < -180) dRa += 360;
      if (dRa > 180) dRa -= 360;
      cumulative += dRa;
    }
    const mean = cumulative / 27;
    expect(mean).toBeGreaterThan(12.5);
    expect(mean).toBeLessThan(14.0);
  });

  it("phase cycle: ~29.5-day synodic period reflected in illumination going up and down", () => {
    const samples: number[] = [];
    for (let d = 0; d < 30; d++) {
      samples.push(
        moonPosition(new Date(Date.UTC(2024, 0, 1 + d))).illumination,
      );
    }
    const minIllum = Math.min(...samples);
    const maxIllum = Math.max(...samples);
    expect(maxIllum).toBeGreaterThan(0.9);
    expect(minIllum).toBeLessThan(0.1);
  });

  it("magnitude is in a sensible range (-13 to +1)", () => {
    const m = moonPosition(new Date(Date.UTC(2024, 5, 15, 0)));
    expect(m.mag).toBeGreaterThan(-13);
    expect(m.mag).toBeLessThan(2);
  });

  it("bright-limb angle is finite and in (-180, 180]", () => {
    for (const d of [0, 7, 15, 22]) {
      const m = moonPosition(new Date(Date.UTC(2024, 0, 1 + d)));
      expect(Number.isFinite(m.brightLimbAngleDeg)).toBe(true);
      expect(m.brightLimbAngleDeg).toBeGreaterThan(-180.01);
      expect(m.brightLimbAngleDeg).toBeLessThanOrEqual(180.01);
    }
  });
});
