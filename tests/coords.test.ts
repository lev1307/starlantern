import { describe, it, expect } from "vitest";
import {
  dateToJulian,
  gmstDeg,
  equatorialToAltAz,
  geodeticToEcef,
  altAzToVector,
} from "../src/coords";

describe("dateToJulian", () => {
  it("matches J2000.0 epoch (2000-01-01 12:00:00 UTC = JD 2451545.0)", () => {
    const j2000 = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
    expect(dateToJulian(j2000)).toBeCloseTo(2451545.0, 6);
  });

  it("matches the Unix epoch (1970-01-01 00:00:00 UTC = JD 2440587.5)", () => {
    const epoch = new Date(Date.UTC(1970, 0, 1, 0, 0, 0));
    expect(dateToJulian(epoch)).toBeCloseTo(2440587.5, 6);
  });
});

describe("gmstDeg", () => {
  it("at J2000.0 is approximately 280.4606° (=18h 41m 50.5s)", () => {
    const j2000 = dateToJulian(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)));
    expect(gmstDeg(j2000)).toBeCloseTo(280.46061837, 2);
  });

  it("advances ~360.98° per day (sidereal day ≈ 23h56m04s)", () => {
    const t0 = dateToJulian(new Date(Date.UTC(2024, 5, 15, 0, 0, 0)));
    const t1 = t0 + 1;
    const drift = (((gmstDeg(t1) - gmstDeg(t0)) % 360) + 360) % 360;
    expect(drift).toBeCloseTo(360.98564736629 % 360, 3);
  });
});

describe("equatorialToAltAz — known anchor stars", () => {
  // Polaris J2000: α = 02h 31m 49.09s, δ = +89°15'50.8"
  const POLARIS = { ra: 37.95456, dec: 89.26411 };

  it("Polaris seen from the North Pole sits ~at the zenith", () => {
    const observer = { latDeg: 90, lonDeg: 0 };
    const date = new Date(Date.UTC(2024, 5, 15, 22, 0, 0));
    const { altDeg } = equatorialToAltAz(POLARIS, observer, date);
    // Polaris is 0.74° off the celestial pole → alt = 89.26° from the geo pole.
    expect(altDeg).toBeCloseTo(89.264, 2);
  });

  it("Polaris altitude from observer at lat L is ≈ L (within ~1°)", () => {
    const date = new Date(Date.UTC(2024, 5, 15, 22, 0, 0));
    for (const lat of [10, 30, 45, 60, 80]) {
      const { altDeg, azDeg } = equatorialToAltAz(
        POLARIS,
        { latDeg: lat, lonDeg: 0 },
        date,
      );
      // |alt − lat| ≤ 1° (Polaris is ~0.74° off pole; allow 1° margin).
      expect(Math.abs(altDeg - lat)).toBeLessThan(1.0);
      // Az should be near North (0° or 360°) within ±5°.
      const azFromNorth = Math.min(azDeg, 360 - azDeg);
      expect(azFromNorth).toBeLessThan(5);
    }
  });

  it("a star on the celestial equator at RA=LST is on the meridian (az ≈ 180° from N-hemisphere observer)", () => {
    // Pick lat=40°N, lon=0, find the LST and use a star at that RA, dec=0.
    const date = new Date(Date.UTC(2024, 5, 15, 22, 0, 0));
    const jd = dateToJulian(date);
    const lstDeg = gmstDeg(jd); // lon=0
    const { altDeg, azDeg } = equatorialToAltAz(
      { ra: lstDeg, dec: 0 },
      { latDeg: 40, lonDeg: 0 },
      date,
    );
    // dec=0 star on the meridian from lat=40°N: alt = 90 - 40 = 50°, az = 180°.
    expect(altDeg).toBeCloseTo(50, 1);
    expect(azDeg).toBeCloseTo(180, 1);
  });

  it("altitude of zenith-pointing star (dec = lat, HA = 0) is exactly 90°", () => {
    const date = new Date(Date.UTC(2024, 5, 15, 22, 0, 0));
    const jd = dateToJulian(date);
    const lst = gmstDeg(jd);
    const { altDeg } = equatorialToAltAz(
      { ra: lst, dec: 47.5 },
      { latDeg: 47.5, lonDeg: 0 },
      date,
    );
    expect(altDeg).toBeCloseTo(90, 3);
  });
});

describe("geodeticToEcef", () => {
  it("(0,0,0) lies on WGS84 equator: |r| = a = 6378137", () => {
    const [x, y, z] = geodeticToEcef(0, 0, 0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(6378137, 0);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("North Pole has z ≈ b (polar radius) and x=y=0", () => {
    const [x, y, z] = geodeticToEcef(90, 0, 0);
    const b = 6356752.3142; // WGS84 polar semi-axis
    expect(z).toBeCloseTo(b, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });
});

describe("altAzToVector", () => {
  it("zenith → +Y", () => {
    const [x, y, z] = altAzToVector(90, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("north horizon → -Z", () => {
    const [x, y, z] = altAzToVector(0, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1, 6);
  });

  it("east horizon → +X", () => {
    const [x, y, z] = altAzToVector(0, 90);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("south horizon → +Z", () => {
    const [x, y, z] = altAzToVector(0, 180);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it("vectors are unit length", () => {
    for (const alt of [-30, 0, 15, 45, 80]) {
      for (const az of [0, 47, 123, 200, 359]) {
        const [x, y, z] = altAzToVector(alt, az);
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
      }
    }
  });
});
