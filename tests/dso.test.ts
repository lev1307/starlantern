import { describe, it, expect } from "vitest";
import { NAKED_EYE_DSO } from "../src/dso";

describe("NAKED_EYE_DSO — catalog sanity", () => {
  it("contains the iconic Messier showpieces", () => {
    const ids = NAKED_EYE_DSO.map((d) => d.id);
    for (const must of ["M31", "M42", "M45", "M44"]) {
      expect(ids).toContain(must);
    }
  });

  it("every object has plausible coordinates, magnitude, and size", () => {
    for (const d of NAKED_EYE_DSO) {
      expect(d.pos.ra).toBeGreaterThanOrEqual(0);
      expect(d.pos.ra).toBeLessThan(360);
      expect(d.pos.dec).toBeGreaterThanOrEqual(-90);
      expect(d.pos.dec).toBeLessThanOrEqual(90);
      // Naked-eye showpieces: mag should be brighter than ~6.
      expect(d.mag).toBeLessThanOrEqual(6);
      // Angular sizes are degrees, all under 15° for these objects.
      expect(d.majorDeg).toBeGreaterThan(0);
      expect(d.majorDeg).toBeLessThan(15);
      expect(d.minorDeg).toBeGreaterThan(0);
      expect(d.minorDeg).toBeLessThanOrEqual(d.majorDeg + 0.01);
      // Color components are in [0,1] linear-sRGB.
      for (const c of d.color) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(["galaxy", "nebula", "cluster"]).toContain(d.kind);
    }
  });

  it("M31 is a yellow-ish elongated galaxy near RA 10°, Dec 41°", () => {
    const m31 = NAKED_EYE_DSO.find((d) => d.id === "M31")!;
    expect(m31.kind).toBe("galaxy");
    expect(m31.pos.ra).toBeCloseTo(10.68, 1);
    expect(m31.pos.dec).toBeCloseTo(41.27, 1);
    expect(m31.majorDeg).toBeGreaterThan(m31.minorDeg); // elongated
    // Yellow-ish: R component >= B component.
    expect(m31.color[0]).toBeGreaterThanOrEqual(m31.color[2]);
  });

  it("M42 is a reddish nebula in Orion (Dec near -5°)", () => {
    const m42 = NAKED_EYE_DSO.find((d) => d.id === "M42")!;
    expect(m42.kind).toBe("nebula");
    expect(m42.pos.dec).toBeLessThan(0);
    expect(m42.pos.dec).toBeGreaterThan(-10);
    // Red-tinted: R > G and R > B.
    expect(m42.color[0]).toBeGreaterThan(m42.color[1]);
    expect(m42.color[0]).toBeGreaterThan(m42.color[2]);
  });

  it("M45 Pleiades is a blue cluster near Dec 24°", () => {
    const m45 = NAKED_EYE_DSO.find((d) => d.id === "M45")!;
    expect(m45.kind).toBe("cluster");
    expect(m45.pos.dec).toBeCloseTo(24.12, 1);
    // Blue-tinted: B > R.
    expect(m45.color[2]).toBeGreaterThan(m45.color[0]);
  });

  it("LMC and SMC are at deep southern declinations", () => {
    const lmc = NAKED_EYE_DSO.find((d) => d.id === "LMC")!;
    const smc = NAKED_EYE_DSO.find((d) => d.id === "SMC")!;
    expect(lmc.pos.dec).toBeLessThan(-65);
    expect(smc.pos.dec).toBeLessThan(-65);
  });
});
