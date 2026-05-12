import { describe, it, expect } from "vitest";
import {
  equatorialToGalactic,
  milkyWayDensity,
  GALACTIC_CENTRE_EQ,
} from "../src/galactic";

describe("equatorialToGalactic", () => {
  it("galactic centre (RA 266.4°, Dec -28.9°) → (l ≈ 0°, b ≈ 0°)", () => {
    const { lDeg, bDeg } = equatorialToGalactic(
      GALACTIC_CENTRE_EQ.raDeg,
      GALACTIC_CENTRE_EQ.decDeg,
    );
    // Normalize l to [-180, 180] for proximity check.
    const lNorm = ((((lDeg + 180) % 360) + 360) % 360) - 180;
    expect(Math.abs(lNorm)).toBeLessThan(0.5);
    expect(Math.abs(bDeg)).toBeLessThan(0.5);
  });

  it("galactic north pole (RA 192.86°, Dec 27.13°) → b ≈ +90°", () => {
    const { bDeg } = equatorialToGalactic(192.85948, 27.12825);
    expect(bDeg).toBeGreaterThan(89.5);
  });

  it("galactic south pole → b ≈ -90°", () => {
    // South pole is RA = GNP_RA + 180° (≈ 12.86°), Dec = -GNP_Dec.
    const { bDeg } = equatorialToGalactic(12.85948, -27.12825);
    expect(bDeg).toBeLessThan(-89.5);
  });

  it("returns l in [0, 360) and b in [-90, 90]", () => {
    for (let ra = 0; ra < 360; ra += 30) {
      for (let dec = -80; dec <= 80; dec += 20) {
        const { lDeg, bDeg } = equatorialToGalactic(ra, dec);
        expect(lDeg).toBeGreaterThanOrEqual(0);
        expect(lDeg).toBeLessThan(360);
        expect(bDeg).toBeGreaterThanOrEqual(-90);
        expect(bDeg).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe("milkyWayDensity", () => {
  it("peaks near (l=0, b=0) — galactic centre direction", () => {
    expect(milkyWayDensity(0, 0)).toBeGreaterThan(0.4);
  });

  it("drops fast off the galactic plane (b = 30° dim, b = 60° invisible)", () => {
    const onPlane = milkyWayDensity(0, 0);
    expect(milkyWayDensity(0, 30) / onPlane).toBeLessThan(0.01);
    expect(milkyWayDensity(0, 60)).toBeLessThan(0.001);
  });

  it("anticentre (l=180°, b=0) is dimmer than centre but still > 0", () => {
    const c = milkyWayDensity(0, 0);
    const ac = milkyWayDensity(180, 0);
    expect(ac).toBeLessThan(c);
    expect(ac).toBeGreaterThan(0);
  });

  it("density is non-negative everywhere", () => {
    for (let l = 0; l < 360; l += 10) {
      for (let b = -90; b <= 90; b += 10) {
        expect(milkyWayDensity(l, b)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
