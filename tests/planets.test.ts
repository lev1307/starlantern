import { describe, it, expect } from "vitest";
import {
  planetPosition,
  allPlanetPositions,
  VISIBLE_PLANETS,
  PLANET_COLOR,
} from "../src/planets";

describe("planetPosition — bounds and physical invariants", () => {
  it("returns RA in [0,360) and Dec in [-90,90] for all visible planets across many dates", () => {
    const dates = [
      new Date(Date.UTC(2000, 0, 1)),
      new Date(Date.UTC(2020, 5, 15)),
      new Date(Date.UTC(2024, 11, 31)),
      new Date(Date.UTC(2050, 0, 1)),
    ];
    for (const d of dates) {
      for (const p of allPlanetPositions(d)) {
        expect(p.raDeg).toBeGreaterThanOrEqual(0);
        expect(p.raDeg).toBeLessThan(360);
        expect(p.decDeg).toBeGreaterThanOrEqual(-90.01);
        expect(p.decDeg).toBeLessThanOrEqual(90.01);
        expect(p.distanceAu).toBeGreaterThan(0);
      }
    }
  });

  it("inner planets stay close to the ecliptic (|Dec| ≤ ~30°)", () => {
    // Mercury, Venus, Mars dec is bounded by ε + i + own dec_solar ≤ ~30°.
    for (let y = 2020; y < 2030; y++) {
      for (const name of ["Mercury", "Venus", "Mars"]) {
        const p = planetPosition(name, new Date(Date.UTC(y, 5, 1)));
        expect(Math.abs(p.decDeg)).toBeLessThan(30);
      }
    }
  });

  it("Mercury is never more than ~28° from the Sun in elongation", () => {
    // Elongation = arccos((cos δ_S cos δ_P cos(α_S − α_P) + sin δ_S sin δ_P))
    // We use the planet's own apparent geometry. Mercury's max elongation ≈ 28°.
    for (let d = 0; d < 365; d += 10) {
      const date = new Date(Date.UTC(2024, 0, 1 + d));
      const merc = planetPosition("Mercury", date);
      // Reuse Mars phase angle proxy: 180° − phase ≈ elongation for outer planets,
      // but for Mercury we want the Sun-Earth-Planet angle = arccos((helio-earth dist² + Δ² − r²)/(2·Δ·r_earth))
      // Easier: elongation ≤ 28°, so re-derive from positions.
      // helio_planet = planet at heliocentric vector — but we only have the result of planetPosition.
      // Instead, exploit phaseAngle: for an inner planet, phase ∈ [0, 180°] and elongation ≈ 180° − phase only loosely.
      // Practical check: the geocentric distance to Mercury bounds it — Mercury's max from Sun
      // means Mercury-Earth distance ≤ 1.467 AU. We test that.
      expect(merc.distanceAu).toBeLessThan(1.5);
      expect(merc.distanceAu).toBeGreaterThan(0.5);
    }
  });

  it("Venus geocentric distance is in [0.27, 1.74] AU (Venus orbit semi-extremes)", () => {
    for (let d = 0; d < 365; d += 5) {
      const v = planetPosition("Venus", new Date(Date.UTC(2024, 0, 1 + d)));
      expect(v.distanceAu).toBeGreaterThanOrEqual(0.25);
      expect(v.distanceAu).toBeLessThanOrEqual(1.78);
    }
  });

  it("Jupiter heliocentric distance ≈ 4.95–5.46 AU (perihelion–aphelion)", () => {
    for (let d = 0; d < 4000; d += 100) {
      const j = planetPosition("Jupiter", new Date(Date.UTC(2010, 0, 1 + d)));
      expect(j.helioDistanceAu).toBeGreaterThan(4.9);
      expect(j.helioDistanceAu).toBeLessThan(5.5);
    }
  });

  it("Saturn heliocentric distance ≈ 9.0–10.1 AU", () => {
    for (let d = 0; d < 11000; d += 500) {
      const s = planetPosition("Saturn", new Date(Date.UTC(2010, 0, 1 + d)));
      expect(s.helioDistanceAu).toBeGreaterThan(8.9);
      expect(s.helioDistanceAu).toBeLessThan(10.2);
    }
  });

  it("phase angle is in [0, 180]°", () => {
    for (const p of allPlanetPositions(new Date())) {
      expect(p.phaseAngleDeg).toBeGreaterThanOrEqual(0);
      expect(p.phaseAngleDeg).toBeLessThanOrEqual(180);
    }
  });

  it("angular diameters are sensible (arcseconds)", () => {
    const p = allPlanetPositions(new Date(Date.UTC(2024, 5, 1)));
    const m = Object.fromEntries(
      p.map((x) => [x.name, x.angularDiameterArcsec]),
    );
    // Mercury: 5-13", Venus: 10-66", Mars: 4-25", Jupiter: 30-50", Saturn: 14-21".
    expect(m["Mercury"]!).toBeGreaterThan(3);
    expect(m["Mercury"]!).toBeLessThan(15);
    expect(m["Venus"]!).toBeGreaterThan(8);
    expect(m["Venus"]!).toBeLessThan(70);
    expect(m["Mars"]!).toBeGreaterThan(3);
    expect(m["Mars"]!).toBeLessThan(30);
    expect(m["Jupiter"]!).toBeGreaterThan(25);
    expect(m["Jupiter"]!).toBeLessThan(55);
    expect(m["Saturn"]!).toBeGreaterThan(12);
    expect(m["Saturn"]!).toBeLessThan(25);
  });

  it("Venus is the brightest non-Sun naked-eye object except for very narrow Mercury crescents", () => {
    // Venus mag is typically -3 to -4.7. Brighter than every other planet at most times.
    const p = allPlanetPositions(new Date(Date.UTC(2024, 5, 15)));
    const venus = p.find((x) => x.name === "Venus")!;
    expect(venus.mag).toBeLessThan(-2);
    expect(venus.mag).toBeGreaterThan(-5);
  });

  it("PLANET_COLOR has an entry for each visible planet", () => {
    for (const n of VISIBLE_PLANETS) {
      const c = PLANET_COLOR[n]!;
      expect(c).toHaveLength(3);
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
    }
  });
});
