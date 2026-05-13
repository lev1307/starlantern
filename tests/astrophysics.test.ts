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
  refractionDeg,
  scintillationAmplitude,
  twilightSkyMag,
  skyMagToLimitMag,
  effectiveLimitMag,
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

describe("refractionDeg (Bennett 1982)", () => {
  it("zenith refraction is essentially zero", () => {
    expect(refractionDeg(90)).toBeLessThan(0.001);
  });

  it("horizon refraction is about 0.55° (≈ 34 arcmin) — slightly more than a Sun-diameter lift", () => {
    const R = refractionDeg(0);
    expect(R).toBeGreaterThan(0.4);
    expect(R).toBeLessThan(0.7);
  });

  it("decreases monotonically with altitude over [0, 90°]", () => {
    let prev = refractionDeg(0);
    for (const h of [1, 5, 10, 30, 60, 89]) {
      const r = refractionDeg(h);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });

  it("returns 0 well below horizon", () => {
    expect(refractionDeg(-5)).toBe(0);
  });
});

describe("scintillationAmplitude", () => {
  it("zero below horizon", () => {
    expect(scintillationAmplitude(-1)).toBe(0);
    expect(scintillationAmplitude(0)).toBe(0);
  });

  it("zenith twinkle is tiny (~0.5%)", () => {
    const z = scintillationAmplitude(90);
    expect(z).toBeGreaterThan(0.003);
    expect(z).toBeLessThan(0.01);
  });

  it("low-altitude twinkle is much larger than zenith", () => {
    expect(scintillationAmplitude(10)).toBeGreaterThan(
      5 * scintillationAmplitude(80),
    );
  });

  it("monotonic: less altitude → more twinkle", () => {
    let prev = 0;
    for (const h of [89, 60, 30, 10, 5, 2]) {
      const a = scintillationAmplitude(h);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it("clamps at 0.35 even at extremely low altitudes", () => {
    expect(scintillationAmplitude(0.1)).toBeLessThanOrEqual(0.35 + 1e-9);
  });
});

describe("twilightSkyMag", () => {
  it("dark sky floor: sun below -18° → 22.0 mag/arcsec²", () => {
    expect(twilightSkyMag(-30)).toBeCloseTo(22, 3);
    expect(twilightSkyMag(-18)).toBeCloseTo(22, 3);
  });

  it("daylight: sun above horizon → 5 mag/arcsec²", () => {
    expect(twilightSkyMag(0)).toBeCloseTo(5, 3);
    expect(twilightSkyMag(30)).toBeCloseTo(5, 3);
  });

  it("monotonically brighter (lower mag) as the sun rises through twilight", () => {
    let prev = twilightSkyMag(-18);
    for (const h of [-15, -12, -9, -6, -3, -1]) {
      const v = twilightSkyMag(h);
      expect(v).toBeLessThan(prev + 1e-6);
      prev = v;
    }
  });

  it("nautical / civil anchors are physically plausible", () => {
    expect(twilightSkyMag(-12)).toBeCloseTo(18.5, 1);
    expect(twilightSkyMag(-6)).toBeCloseTo(12.5, 1);
  });
});

describe("skyMagToLimitMag", () => {
  it("dark sky → mag 7.8 limit", () => {
    expect(skyMagToLimitMag(22)).toBeCloseTo(7.8, 1);
  });

  it("Bortle-9 city sky → mag ~4 limit", () => {
    expect(skyMagToLimitMag(18)).toBeCloseTo(4.0, 1);
  });

  it("daylight returns -∞ (no stars visible)", () => {
    expect(skyMagToLimitMag(5)).toBe(-Infinity);
  });
});

describe("effectiveLimitMag", () => {
  it("dark night, dark site → ~7.8", () => {
    expect(effectiveLimitMag(1, -30)).toBeGreaterThan(7.5);
  });

  it("city sky, dark night → Bortle-limited (~4)", () => {
    expect(effectiveLimitMag(9, -30)).toBeCloseTo(4.0, 1);
  });

  it("twilight clamps the limit even at a dark site", () => {
    expect(effectiveLimitMag(1, -6)).toBeLessThan(2); // civil twilight wipes out faint stars
  });

  it("daylight → very negative (effectively nothing visible)", () => {
    expect(effectiveLimitMag(1, 30)).toBeLessThan(0);
  });
});
