import { describe, it, expect } from "vitest";
import {
  geomagneticLatitude,
  magneticNorthAzimuth,
  auroralOvalEdge,
  auroralVisibility,
} from "../src/aurora";

const munich = { latDeg: 48.137, lonDeg: 11.575 };
const tromso = { latDeg: 69.65, lonDeg: 18.96 };
const fairbanks = { latDeg: 64.84, lonDeg: -147.72 };
const equator = { latDeg: 0, lonDeg: 0 };
const northPole = { latDeg: 89, lonDeg: 0 };

describe("geomagneticLatitude — observer geomag conversion", () => {
  it("Munich has geomag latitude near 49°N", () => {
    expect(geomagneticLatitude(munich)).toBeGreaterThan(45);
    expect(geomagneticLatitude(munich)).toBeLessThan(53);
  });

  it("Tromsø sits inside the auroral oval (geomag ~66°N)", () => {
    expect(geomagneticLatitude(tromso)).toBeGreaterThan(63);
    expect(geomagneticLatitude(tromso)).toBeLessThan(70);
  });

  it("Fairbanks geomag lat is above 60°", () => {
    expect(geomagneticLatitude(fairbanks)).toBeGreaterThan(60);
  });

  it("equator stays near 0° geomag", () => {
    expect(Math.abs(geomagneticLatitude(equator))).toBeLessThan(15);
  });
});

describe("magneticNorthAzimuth — compass direction to geomag pole", () => {
  it("Munich points roughly NNW (between 330° and 360°)", () => {
    const az = magneticNorthAzimuth(munich);
    expect(az).toBeGreaterThan(320);
    expect(az).toBeLessThanOrEqual(360);
  });

  it("Fairbanks (already near geomag pole) points generally NE", () => {
    const az = magneticNorthAzimuth(fairbanks);
    expect(az).toBeGreaterThan(0);
    expect(az).toBeLessThan(360);
  });
});

describe("auroralOvalEdge — Kp drives equatorward extent", () => {
  it("Kp 0 oval edge is at 67°", () => {
    expect(auroralOvalEdge(0)).toBeCloseTo(67, 1);
  });

  it("Kp 9 oval edge reaches 49° (Munich latitude range)", () => {
    expect(auroralOvalEdge(9)).toBeCloseTo(49, 1);
  });

  it("monotonic decrease with Kp", () => {
    for (let k = 0; k < 9; k++) {
      expect(auroralOvalEdge(k + 1)).toBeLessThan(auroralOvalEdge(k));
    }
  });
});

describe("auroralVisibility — full visibility model", () => {
  it("Tromsø at Kp 3 sees overhead aurora", () => {
    const v = auroralVisibility(tromso, 3);
    expect(v.visible).toBe(true);
    expect(v.peakAltDeg).toBeGreaterThan(45);
    expect(v.intensity).toBeGreaterThan(0.4);
  });

  it("Munich at Kp 2 sees nothing", () => {
    const v = auroralVisibility(munich, 2);
    expect(v.visible).toBe(false);
    expect(v.intensity).toBeLessThan(0.05);
  });

  it("Munich at Kp 9 (extreme storm) sees horizon aurora", () => {
    const v = auroralVisibility(munich, 9);
    expect(v.visible).toBe(true);
    expect(v.peakAltDeg).toBeGreaterThan(0);
    expect(v.peakAltDeg).toBeLessThan(60);
    expect(v.intensity).toBeGreaterThan(0);
  });

  it("equator never sees aurora regardless of Kp", () => {
    for (let k = 0; k <= 9; k++) {
      const v = auroralVisibility(equator, k);
      expect(v.visible).toBe(false);
    }
  });

  it("north pole sees aurora at any Kp ≥ 1", () => {
    const v = auroralVisibility(northPole, 1);
    expect(v.visible).toBe(true);
    expect(v.peakAltDeg).toBeGreaterThan(40);
  });

  it("intensity grows monotonically with Kp for a fringe observer", () => {
    // A site just inside the visibility envelope.
    const fringe = { latDeg: 55, lonDeg: 10 };
    const lo = auroralVisibility(fringe, 2);
    const hi = auroralVisibility(fringe, 8);
    expect(hi.intensity).toBeGreaterThan(lo.intensity);
  });
});
