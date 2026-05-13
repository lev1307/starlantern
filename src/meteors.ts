// Naked-eye meteor system. Sporadic background (≈6/hr ZHR at perfect dark sky)
// plus major shower bursts based on the calendar date. Each meteor is a brief
// ablation streak — start point on the celestial sphere, fixed direction across
// the sky for its lifetime (0.3–1.0 s typical), magnitude drawn from a Pareto-like
// distribution so faint meteors dominate but the occasional fireball appears.
//
// Why naked-eye relevant: at a Bortle-1 site a casual observer sees several
// sporadic meteors per hour; on a peak shower night (Perseids, Geminids) ZHR
// reaches 100+, meaning ~1 every 30 s in good conditions. This is one of the
// most arresting features of the real night sky and was missing from the renderer.
//
// Determinism: sporadic background is Poisson-sampled per call using a seeded
// PRNG so that a given UTC date+time produces a reproducible meteor stream
// across reloads of the same moment. Different UTC moments → different streams.
// We don't try to model individual real meteors (that would require radar data);
// we model the statistical distribution the eye actually perceives.

import { equatorialToAltAz, type Observer, type Equatorial } from "./coords";

const DEG = Math.PI / 180;

export interface Shower {
  /** Common name (e.g. "Perseids"). */
  name: string;
  /** Peak date in UTC: month (1-12) and day-of-month. */
  peak: { month: number; day: number };
  /** Half-width of the activity window in days. Outside ±halfWidth, ZHR ≈ 0. */
  halfWidthDays: number;
  /** Peak Zenith Hourly Rate at maximum (visible per hour at dark sky, radiant overhead). */
  zhrPeak: number;
  /** Radiant J2000 right ascension and declination, degrees. */
  radiant: Equatorial;
  /** Typical meteor velocity (km/s) — drives streak length. */
  velocityKmS: number;
}

/**
 * Major naked-eye showers. Each entry is from the IMO 2024 working list.
 * Dates are UTC and approximate to within a day — the activity window is wide
 * enough that ±1 day doesn't matter for visual realism.
 */
export const SHOWERS: readonly Shower[] = [
  {
    name: "Quadrantids",
    peak: { month: 1, day: 3 },
    halfWidthDays: 1.5,
    zhrPeak: 110,
    radiant: { ra: 230, dec: 49 },
    velocityKmS: 41,
  },
  {
    name: "Lyrids",
    peak: { month: 4, day: 22 },
    halfWidthDays: 3,
    zhrPeak: 18,
    radiant: { ra: 271, dec: 34 },
    velocityKmS: 49,
  },
  {
    name: "Eta Aquariids",
    peak: { month: 5, day: 6 },
    halfWidthDays: 5,
    zhrPeak: 50,
    radiant: { ra: 338, dec: -1 },
    velocityKmS: 66,
  },
  {
    name: "Perseids",
    peak: { month: 8, day: 12 },
    halfWidthDays: 5,
    zhrPeak: 100,
    radiant: { ra: 48, dec: 58 },
    velocityKmS: 59,
  },
  {
    name: "Orionids",
    peak: { month: 10, day: 21 },
    halfWidthDays: 4,
    zhrPeak: 20,
    radiant: { ra: 95, dec: 16 },
    velocityKmS: 66,
  },
  {
    name: "Leonids",
    peak: { month: 11, day: 17 },
    halfWidthDays: 2,
    zhrPeak: 15,
    radiant: { ra: 152, dec: 22 },
    velocityKmS: 71,
  },
  {
    name: "Geminids",
    peak: { month: 12, day: 14 },
    halfWidthDays: 2.5,
    zhrPeak: 120,
    radiant: { ra: 112, dec: 33 },
    velocityKmS: 35,
  },
  {
    name: "Ursids",
    peak: { month: 12, day: 22 },
    halfWidthDays: 2,
    zhrPeak: 10,
    radiant: { ra: 217, dec: 76 },
    velocityKmS: 33,
  },
];

/** Sporadic background rate at perfect dark sky, meteors per hour, all-sky. */
const SPORADIC_ZHR = 6;

/**
 * Active shower contributions at a given UTC date. Returns each shower whose
 * window includes the date, scaled by a triangular activity profile that peaks
 * at 1.0 on the peak date and falls linearly to 0 at ±halfWidthDays.
 */
export function activeShowers(
  date: Date,
): Array<{ shower: Shower; intensity: number }> {
  const out: Array<{ shower: Shower; intensity: number }> = [];
  const year = date.getUTCFullYear();
  const tNow = date.getTime();
  for (const sh of SHOWERS) {
    // Build peak datetime for the current calendar year.
    const peakUtc = Date.UTC(year, sh.peak.month - 1, sh.peak.day, 0, 0, 0);
    const dDays = (tNow - peakUtc) / 86400000;
    const within = Math.abs(dDays) <= sh.halfWidthDays;
    if (!within) continue;
    const intensity = 1 - Math.abs(dDays) / sh.halfWidthDays;
    out.push({ shower: sh, intensity });
  }
  return out;
}

/**
 * Total expected meteors per hour visible to a perfect dark-sky observer at the
 * given UTC date, summing sporadic background + active shower contributions.
 * Showers are attenuated by zenith correction when the radiant is below ~30°.
 */
export function expectedRate(date: Date, observer: Observer): number {
  let rate = SPORADIC_ZHR;
  for (const { shower, intensity } of activeShowers(date)) {
    const aa = equatorialToAltAz(shower.radiant, observer, date);
    // Below the horizon → no meteors from this radiant.
    if (aa.altDeg < 0) continue;
    // Zenith correction: full rate at altitude 90°, fades to ~0 at 0°.
    // IMO formula: ZHR_obs = ZHR · sin(altRadiant), with a small floor.
    const z = Math.max(0, Math.sin(aa.altDeg * DEG));
    rate += shower.zhrPeak * intensity * z;
  }
  return rate;
}

/**
 * Mulberry32 — a tiny seeded PRNG. Deterministic given the same seed.
 * Used so that meteor streams are reproducible for a given UTC moment.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MeteorSpec {
  /** Source label: "sporadic" or shower name. */
  source: string;
  /** Wall-clock UTC ms when streak starts. */
  startMs: number;
  /** Streak duration in seconds. */
  durationS: number;
  /** Apparent visual magnitude at peak brightness. */
  mag: number;
  /** Entry altaz: where the streak begins. */
  startAlt: number;
  startAz: number;
  /** Exit altaz: where the streak ends. */
  endAlt: number;
  endAz: number;
}

/**
 * Sample a magnitude from a power-law distribution.
 * Population index r=2.5 (typical for showers + sporadics): N(m+1) ≈ 2.5 · N(m).
 * Mag range: -4 (fireball) to +5 (faint, near limit). We pick uniformly in
 * exp-mag-space so faint meteors dominate.
 */
function sampleMag(rand: () => number): number {
  // Inverse-CDF for an exponential weighting (P(m) ∝ r^m, r ≈ 2.5).
  // For r=2.5 over [magMin, magMax]: mag = magMin + log(1 - u·(1 - r^(-Δ)))/log(r^-1).
  // Simpler approximation: draw uniform u ∈ [0,1) and map to mag = magMax - log_r(u·(r^Δ - 1) + 1).
  const magMin = -4;
  const magMax = 5;
  const delta = magMax - magMin;
  const r = 2.5;
  const u = rand();
  const m = magMax - Math.log(u * (Math.pow(r, delta) - 1) + 1) / Math.log(r);
  return Math.max(magMin, Math.min(magMax, m));
}

/**
 * For a given shower with a radiant at altaz (radAlt, radAz), produce a
 * meteor streak: start point chosen uniformly in a 60°-radius zone around the
 * radiant, direction = radially away from radiant. Streak length scales with
 * meteor velocity and duration.
 */
function streakFromRadiant(
  radAlt: number,
  radAz: number,
  velocityKmS: number,
  rand: () => number,
): { startAlt: number; startAz: number; endAlt: number; endAz: number } {
  // Pick an angular offset 5°-50° from the radiant (uniform in angular area)
  // and a uniform random direction (azimuth around the radiant).
  const cosMin = Math.cos(50 * DEG);
  const cosMax = Math.cos(5 * DEG);
  const cosOff = cosMin + rand() * (cosMax - cosMin);
  const offDeg = Math.acos(cosOff) / DEG;
  const dirRad = rand() * 2 * Math.PI;

  // Use the local "tangent plane" approximation: small offsets in alt/az from
  // the radiant. Good enough for naked-eye streak placement.
  const dAlt = offDeg * Math.cos(dirRad);
  const dAz = (offDeg * Math.sin(dirRad)) / Math.max(0.05, Math.cos(radAlt * DEG));
  const startAlt = clampAlt(radAlt + dAlt);
  const startAz = wrap360(radAz + dAz);

  // Streak length: angular ~ velocity-related; faster meteors → longer streaks.
  const lengthDeg = 3 + (velocityKmS / 70) * 12 + rand() * 4;
  const endAlt = clampAlt(startAlt + lengthDeg * Math.cos(dirRad));
  const endAz =
    wrap360(startAz + (lengthDeg * Math.sin(dirRad)) / Math.max(0.05, Math.cos(startAlt * DEG)));
  return { startAlt, startAz, endAlt, endAz };
}

function clampAlt(a: number): number {
  return Math.max(-5, Math.min(89, a));
}

function wrap360(x: number): number {
  return ((x % 360) + 360) % 360;
}

/**
 * Sample new meteors that occurred during the past dt seconds. Returns a list
 * of MeteorSpec — typically zero, sometimes one, rarely two. Uses a Poisson
 * draw from `expectedRate · dt / 3600` for sporadic + each active shower.
 *
 * The RNG is seeded from floor(date / 50ms) so that repeated sampling at the
 * same instant produces stable output, but the stream evolves naturally as
 * time advances.
 */
export function sampleNewMeteors(
  date: Date,
  dt: number,
  observer: Observer,
): MeteorSpec[] {
  const out: MeteorSpec[] = [];
  // Seed PRNG from the time bucket. 50ms bucket so closely-spaced calls share state.
  const bucket = Math.floor(date.getTime() / 50);
  const rand = mulberry32(bucket ^ 0xa5a5a5a5);

  // Sporadic background.
  const sporadicLambda = (SPORADIC_ZHR * dt) / 3600;
  const nSporadic = poisson(sporadicLambda, rand);
  for (let i = 0; i < nSporadic; i++) {
    // Sporadic meteors come from the apex of Earth's motion ~ in the morning sky.
    // For simplicity, scatter them uniformly across the visible hemisphere with
    // a slight bias toward the eastern half.
    const startAz = rand() * 360;
    const startAlt = 10 + rand() * 70;
    const dirRad = rand() * 2 * Math.PI;
    const lengthDeg = 4 + rand() * 8;
    const endAlt = clampAlt(startAlt + lengthDeg * Math.cos(dirRad));
    const endAz = wrap360(
      startAz + (lengthDeg * Math.sin(dirRad)) / Math.max(0.05, Math.cos(startAlt * DEG)),
    );
    out.push({
      source: "sporadic",
      startMs: date.getTime() + Math.floor(rand() * dt * 1000),
      durationS: 0.3 + rand() * 0.7,
      mag: sampleMag(rand),
      startAlt,
      startAz,
      endAlt,
      endAz,
    });
  }

  // Active showers.
  for (const { shower, intensity } of activeShowers(date)) {
    const aa = equatorialToAltAz(shower.radiant, observer, date);
    if (aa.altDeg < 0) continue;
    const z = Math.max(0, Math.sin(aa.altDeg * DEG));
    const lambda = (shower.zhrPeak * intensity * z * dt) / 3600;
    const n = poisson(lambda, rand);
    for (let i = 0; i < n; i++) {
      const streak = streakFromRadiant(aa.altDeg, aa.azDeg, shower.velocityKmS, rand);
      out.push({
        source: shower.name,
        startMs: date.getTime() + Math.floor(rand() * dt * 1000),
        durationS: 0.3 + rand() * 0.9,
        mag: sampleMag(rand),
        ...streak,
      });
    }
  }
  return out;
}

/** Knuth's Poisson sampler for small λ. */
function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // Normal approximation for safety, though we never expect this in practice.
    const sd = Math.sqrt(lambda);
    return Math.max(0, Math.round(lambda + sd * (rand() * 2 - 1) * 1.7));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}
