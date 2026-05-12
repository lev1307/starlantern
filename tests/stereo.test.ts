import { describe, it, expect } from "vitest";
import { barrelDistort, eyeBarrelSample, eyeOffsets } from "../src/stereo-math";

describe("barrelDistort", () => {
  it("zero distortion → identity", () => {
    const [x, y] = barrelDistort(0.3, -0.2, 0, 0);
    expect(x).toBeCloseTo(0.3, 9);
    expect(y).toBeCloseTo(-0.2, 9);
  });

  it("centre point stays at centre regardless of k", () => {
    const [x, y] = barrelDistort(0, 0, 0.5, 0.1);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it("positive k1 stretches outward (pre-distorts for pincushion lens)", () => {
    const [x, y] = barrelDistort(0.3, 0, 0.3, 0);
    expect(Math.abs(x)).toBeGreaterThan(0.3);
    expect(y).toBe(0);
  });

  it("negative k1 contracts inward", () => {
    const [x] = barrelDistort(0.3, 0, -0.3, 0);
    expect(Math.abs(x)).toBeLessThan(0.3);
  });

  it("factor is symmetric in the radial direction", () => {
    const [x1] = barrelDistort(0.3, 0.4, 0.2, 0.05);
    const [x2] = barrelDistort(-0.3, -0.4, 0.2, 0.05);
    expect(x1).toBeCloseTo(-x2, 9);
  });
});

describe("eyeBarrelSample", () => {
  it("classifies left/right halves correctly", () => {
    expect(eyeBarrelSample(0.25, 0.5, 0, 0).eye).toBe("left");
    expect(eyeBarrelSample(0.75, 0.5, 0, 0).eye).toBe("right");
  });

  it("centre of each half maps to (0.5, 0.5) of the source RT half", () => {
    const left = eyeBarrelSample(0.25, 0.5, 0.3, 0.05);
    expect(left.srcU).toBeCloseTo(0.5, 9);
    expect(left.srcV).toBeCloseTo(0.5, 9);
    const right = eyeBarrelSample(0.75, 0.5, 0.3, 0.05);
    expect(right.srcU).toBeCloseTo(0.5, 9);
    expect(right.srcV).toBeCloseTo(0.5, 9);
  });

  it("corners with large k1 fall outside source (returns NaN srcU/srcV)", () => {
    const out = eyeBarrelSample(0.01, 0.01, 1.5, 0); // far corner, large k1
    expect(Number.isNaN(out.srcU)).toBe(true);
    expect(Number.isNaN(out.srcV)).toBe(true);
  });

  it("with k1=k2=0, srcU/srcV exactly equal the half-eye UV", () => {
    const out = eyeBarrelSample(0.4, 0.6, 0, 0);
    // halfU = 0.4 * 2 = 0.8, halfV = 0.6
    expect(out.srcU).toBeCloseTo(0.8, 9);
    expect(out.srcV).toBeCloseTo(0.6, 9);
  });
});

describe("eyeOffsets", () => {
  it("default 64 mm IPD splits ±32 mm", () => {
    const { leftX, rightX } = eyeOffsets(0.064);
    expect(leftX).toBeCloseTo(-0.032, 9);
    expect(rightX).toBeCloseTo(0.032, 9);
  });

  it("zero IPD → both eyes at the origin", () => {
    const { leftX, rightX } = eyeOffsets(0);
    expect(leftX).toBeCloseTo(0, 9);
    expect(rightX).toBeCloseTo(0, 9);
  });
});
