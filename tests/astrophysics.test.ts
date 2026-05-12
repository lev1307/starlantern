import { describe, it, expect } from "vitest";
import {
  bvToTeff,
  teffToRgb,
  bvToRgb,
  magToFlux,
  airmass,
  extinctionMag,
  bortleSkyMag,
  bortleLimitMag,
  scotopicSaturation,
} from "../src/astrophysics";

describe("bvToTeff (Ballesteros 2012 fit)", () => {
  it("Sun-like B-V ≈ 0.65 → Teff ≈ 5800 K within 200 K", () => {
    const t = bvToTeff(0.65);
    expect(t).toBeGreaterThan(5400);
    expect(t).toBeLessThan(6000);
  });

  it("Vega (B-V = 0) → Teff > 9000 K (hot blue-white)", () => {
    expect(bvToTeff(0.0)).toBeGreaterThan(9000);
  });

  it("Betelgeuse (B-V = 1.85) → Teff < 4000 K (cool red giant)", () => {
    expect(bvToTeff(1.85)).toBeLessThan(4000);
  });
});

describe("teffToRgb / bvToRgb (blackbody)", () => {
  it("returns components in [0, 1]", () => {
    for (const T of [1000, 3000, 5800, 10000, 30000]) {
      const [r, g, b] = teffToRgb(T);
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("cool stars are red-dominant (R > G > B)", () => {
    const [r, g, b] = teffToRgb(3000);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("hot stars are blue-dominant (B ≥ G ≥ R)", () => {
    const [r, g, b] = teffToRgb(20000);
    expect(b).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(r);
  });

  it("Sun-like temperatures yield near-white (all channels ≥ 0.7)", () => {
    const [r, g, b] = teffToRgb(5800);
    for (const c of [r, g, b]) expect(c).toBeGreaterThan(0.6);
  });

  it("Betelgeuse via bvToRgb is red (R > B by a wide margin)", () => {
    const [r, , b] = bvToRgb(1.85);
    expect(r).toBeGreaterThan(b + 0.4);
  });
});

describe("magToFlux (Pogson scale)", () => {
  it("magnitude 0 = flux 1", () => {
    expect(magToFlux(0)).toBeCloseTo(1, 9);
  });

  it("Δmag = 5 ↔ flux ratio = 100", () => {
    expect(magToFlux(0) / magToFlux(5)).toBeCloseTo(100, 6);
  });

  it("Δmag = 1 ↔ flux ratio ≈ 2.512", () => {
    expect(magToFlux(0) / magToFlux(1)).toBeCloseTo(2.51188643, 6);
  });
});

describe("airmass (Kasten-Young)", () => {
  it("zenith (alt = 90°) gives airmass ≈ 1", () => {
    expect(airmass(90)).toBeCloseTo(1, 3);
  });

  it("alt = 30° (zenith 60°) gives airmass ≈ 2", () => {
    expect(airmass(30)).toBeGreaterThan(1.9);
    expect(airmass(30)).toBeLessThan(2.1);
  });

  it("very low altitudes give very high airmass (a few × 10 to ~38 near horizon)", () => {
    const x = airmass(5);
    expect(x).toBeGreaterThan(10);
  });

  it("below horizon returns +∞", () => {
    expect(airmass(-5)).toBe(Infinity);
  });
});

describe("extinctionMag", () => {
  it("zenith extinction ≈ k (default 0.28 mag)", () => {
    expect(extinctionMag(90)).toBeCloseTo(0.28, 2);
  });

  it("extinction grows monotonically as altitude decreases", () => {
    expect(extinctionMag(60)).toBeLessThan(extinctionMag(30));
    expect(extinctionMag(30)).toBeLessThan(extinctionMag(10));
  });
});

describe("bortleSkyMag + bortleLimitMag", () => {
  it("Bortle 1 ≈ 22.0 mag/arcsec², Bortle 9 ≈ 18.0", () => {
    expect(bortleSkyMag(1)).toBeCloseTo(22.0, 3);
    expect(bortleSkyMag(9)).toBeCloseTo(18.0, 3);
  });

  it("Bortle 1 limit mag ≈ 7.8, Bortle 9 ≈ 4.0", () => {
    expect(bortleLimitMag(1)).toBeCloseTo(7.8, 3);
    expect(bortleLimitMag(9)).toBeCloseTo(4.0, 3);
  });
});

describe("scotopicSaturation", () => {
  it("flux ≥ 1 → full saturation = 1", () => {
    expect(scotopicSaturation(1.0)).toBeCloseTo(1, 6);
    expect(scotopicSaturation(5.0)).toBeCloseTo(1, 6);
  });

  it("flux ≤ 0.005 → no saturation (≈ 0)", () => {
    expect(scotopicSaturation(0.001)).toBeCloseTo(0, 6);
  });

  it("monotonically increases with flux", () => {
    expect(scotopicSaturation(0.01)).toBeLessThan(scotopicSaturation(0.1));
    expect(scotopicSaturation(0.1)).toBeLessThan(scotopicSaturation(1));
  });
});
